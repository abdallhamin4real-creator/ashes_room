import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import { Physics, RAPIER } from '../engine/physics'
import type { Renderer } from '../engine/renderer'
import type { Quality } from '../engine/save'
import { FollowCamera } from './camera'
import { CONFIG } from './config'
import { tuning } from './tuning'
import { Player, type PlayerEvent } from './player'
import { collect, createRun, tick, type RunState } from './rules'
import { World } from './world'

export type Mode = 'attract' | 'playing' | 'paused' | 'ended'
export type Hint = 'move' | 'look' | 'jump' | 'dash' | 'cores'
export type Compass = { angle: number; distance: number; rise: number }
export type WeaponHud = { equipped: boolean; ammo: number; reserve: number; mode: 'idle' | 'pickup' | 'throw' | 'reload' | 'fire' }

export type GameHooks = {
  popup(text: string, screen: { x: number; y: number }, kind: 'score' | 'hurt'): void
  hurt(): void
  hint(hint: Hint | null): void
  tutorialDone(): void
  end(run: RunState): void
  weapon?(state: WeaponHud): void
}

/** Playable room scene: one survivor, physical furniture, two clues and a locked exit. */
export class Game {
  mode: Mode = 'attract'
  run: RunState
  reducedMotion = false
  private readonly physics: Physics
  private readonly world: World
  private readonly player: Player
  private readonly cam: FollowCamera
  private simTime = 0
  private time = 0
  private tutorial: Hint | null = null
  private tutorialLook = 0
  private tutorialStart = new THREE.Vector3()
  private readonly down = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  private ammo = 12
  private reserveAmmo = 36
  private reloadTimer = 0
  private pendingDropTimer = 0

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly hooks: GameHooks,
  ) {
    this.physics = new Physics(CONFIG.player.gravity)
    this.world = new World(this.physics, renderer.shadowMapSize)
    this.player = new Player(this.physics, this.world.spawn)
    this.cam = new FollowCamera(this.physics, this.player.collider)
    this.world.scene.add(this.player.root, this.player.shadowMesh)
    this.run = createRun(3)
    this.cam.reset(this.world.spawn, 0)
    this.notifyWeapon('idle')
  }

  get camera(): THREE.PerspectiveCamera { return this.cam.camera }
  get scene(): THREE.Scene { return this.world.scene }
  get playerModel(): Player { return this.player }

  start(tutorial: boolean): void {
    tuning.activate('run')
    this.player.teleport(this.world.spawn)
    this.player.facing = 0
    this.cam.reset(this.world.spawn, 0)
    this.ammo = 12
    this.reserveAmmo = 36
    this.reloadTimer = 0
    this.pendingDropTimer = 0
    this.player.unequipWeapon()
    this.notifyWeapon('idle')
    this.run = { ...createRun(3), timeLeft: CONFIG.run.seconds, unranked: tuning.unranked }
    this.mode = 'playing'
    this.input.endFrame()
    this.input.takeLook()
    this.tutorial = tutorial ? 'move' : 'cores'
    this.tutorialLook = 0
    this.tutorialStart.copy(this.world.spawn)
    this.hooks.hint(this.tutorial)
  }

  pause(): void { if (this.mode === 'playing') this.mode = 'paused' }
  resume(): void {
    if (this.mode !== 'paused') return
    this.mode = 'playing'
    this.input.endFrame()
    this.input.takeLook()
  }
  toTitle(): void { this.mode = 'attract'; this.hooks.hint(null) }

  setQuality(quality: Quality): void {
    this.renderer.applyQuality(quality)
    const size = this.renderer.shadowMapSize
    const shadow = this.world.sun.shadow
    shadow.map?.dispose()
    shadow.map = null
    shadow.mapSize.set(size, size)
    this.world.scene.traverse(obj => {
      const material = (obj as THREE.Mesh).material
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true
    })
  }

  step(dt: number): void {
    this.simTime += dt
    const jumpPressed = this.input.consume('jump')
    const dashPressed = this.input.consume('dash')
    const interactPressed = this.input.consume('interact')
    const firePressed = this.input.consume('fire')
    const reloadPressed = this.input.consume('reload')
    const dropPressed = this.input.consume('drop')
    const playing = this.mode === 'playing'
    const events: PlayerEvent[] = []

    if (playing) {
      this.player.step(dt, {
        moveX: this.input.move.x,
        moveY: this.input.move.y,
        sprint: this.input.held('sprint'),
        jumpPressed,
        jumpHeld: this.input.held('jump'),
        dashPressed,
      }, this.cam.yaw, events)
    }
    this.physics.step(dt)
    if (!playing) return

    if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt)
      if (this.reloadTimer === 0) {
        const loaded = Math.min(12 - this.ammo, this.reserveAmmo)
        this.ammo += loaded
        this.reserveAmmo -= loaded
        this.notifyWeapon('idle')
      }
    }
    if (this.pendingDropTimer > 0) {
      this.pendingDropTimer = Math.max(0, this.pendingDropTimer - dt)
      if (this.pendingDropTimer === 0) {
        this.world.dropWeapon(this.player.position.clone().setY(0.18))
        this.player.unequipWeapon()
        this.notifyWeapon('idle')
      }
    }

    this.run.unranked ||= tuning.unranked
    const pos = this.player.position
    for (const event of events) this.onPlayerEvent(event, pos)

    if (interactPressed) this.interact(pos)
    if (firePressed) this.fireWeapon()
    if (reloadPressed) this.reloadWeapon()
    if (dropPressed) this.dropWeapon()
    this.run = tick(this.run, dt)
    this.updateTutorial(pos)
    if (this.run.phase !== 'playing') {
      this.mode = 'ended'
      this.hooks.hint(null)
      this.audio.play('win')
      this.hooks.end(this.run)
    }
  }

  render(alpha: number, frameSeconds: number): void {
    this.time += frameSeconds
    this.physics.sync(alpha)
    const target = this.player.root.position
    if (this.mode === 'attract') {
      const t = this.time * 0.11
      this.cam.camera.position.set(10.6 + Math.sin(t) * 0.25, 4.8 + Math.sin(t * 0.7) * 0.08, 10.4 + Math.cos(t) * 0.3)
      this.cam.camera.lookAt(0, 1.55, -1.05)
    } else {
      const look = this.mode === 'playing' ? this.input.takeLook() : { x: 0, y: 0 }
      if (this.mode === 'playing' && this.tutorial === 'look') {
        this.tutorialLook += Math.abs(look.x) + Math.abs(look.y)
        if (this.tutorialLook > 0.05) this.advanceTutorial('jump')
      }
      this.cam.update(target, look, frameSeconds, false, this.reducedMotion)
    }
    this.player.animate(frameSeconds, this.time, false, this.groundBelow(target))
    this.world.update(frameSeconds, target)
    this.renderer.render(this.world.scene, this.cam.camera)
  }

  compass(): Compass | null {
    const pos = this.player.position
    const objective = this.world.objective(pos)
    if (!objective) return null
    const distance = objective.distanceTo(pos)
    const toObjective = Math.atan2(-(objective.x - pos.x), -(objective.z - pos.z))
    let angle = toObjective - this.cam.yaw
    angle = Math.atan2(Math.sin(angle), Math.cos(angle))
    return { angle, distance, rise: objective.y - pos.y }
  }

  private interact(pos: THREE.Vector3): void {
    const item = this.world.nearest(pos)
    if (!item) {
      this.hooks.popup('اقترب أكثر', this.project(pos.clone().setY(pos.y + 1)), 'hurt')
      return
    }
    if (item.kind === 'weapon') {
      if (!this.world.interact(item)) return
      this.player.equipWeapon()
      this.notifyWeapon('pickup')
      this.audio.play('pickup')
      this.hooks.popup('التقطت USP', this.project(item.position), 'score')
      return
    }
    if (item.kind === 'door' && this.run.collected < 2) {
      this.hooks.popup('الباب مقفل. افحص الغرفة أولاً.', this.project(item.position), 'hurt')
      this.audio.play('hurt')
      return
    }
    if (!this.world.interact(item)) return
    const result = collect(this.run)
    this.run = result.state
    this.audio.play('pickup')
    this.hooks.popup(item.kind === 'door' ? 'انفتح الباب' : item.label, this.project(item.position), 'score')
    if (this.tutorial === 'cores') {
      this.hooks.tutorialDone()
      this.hooks.hint(null)
      this.tutorial = null
    }
  }

  private fireWeapon(): void {
    if (!this.player.weaponEquipped || this.reloadTimer > 0 || this.pendingDropTimer > 0) return
    if (this.ammo <= 0) {
      this.reloadWeapon()
      return
    }
    this.ammo -= 1
    this.player.playWeaponAnimation('fire')
    this.audio.play('dash')
    this.cam.addShake(0.035)
    this.notifyWeapon('fire')
  }

  private reloadWeapon(): void {
    if (!this.player.weaponEquipped || this.reloadTimer > 0 || this.ammo >= 12 || this.reserveAmmo <= 0) return
    this.reloadTimer = 1.25
    this.player.playWeaponAnimation('reload')
    this.audio.play('pickup')
    this.notifyWeapon('reload')
  }

  private dropWeapon(): void {
    if (!this.player.weaponEquipped || this.pendingDropTimer > 0) return
    this.pendingDropTimer = 0.42
    this.player.playWeaponAnimation('throw')
    this.notifyWeapon('throw')
  }

  private notifyWeapon(mode: WeaponHud['mode']): void {
    this.hooks.weapon?.({ equipped: this.player.weaponEquipped, ammo: this.ammo, reserve: this.reserveAmmo, mode })
  }

  private onPlayerEvent(event: PlayerEvent, pos: THREE.Vector3): void {
    const feet = pos.clone().setY(pos.y - CONFIG.player.halfHeight - CONFIG.player.radius)
    if (event.type === 'jump') { this.audio.play('jump'); this.cam.addShake(0.08) }
    else if (event.type === 'land') { this.audio.play('land'); if (event.impact > 0.5) this.cam.addShake(event.impact * 0.22); void feet }
    else if (event.type === 'dash') this.audio.play('dash')
  }

  private updateTutorial(pos: THREE.Vector3): void {
    if (this.tutorial === 'move' && pos.distanceTo(this.tutorialStart) > 1.6) {
      this.advanceTutorial('cores')
    }
  }

  advanceTutorial(next: Hint | null): void {
    this.tutorial = next
    this.tutorialLook = 0
    this.hooks.hint(next)
  }

  private groundBelow(p: THREE.Vector3): number | null {
    this.down.origin = { x: p.x, y: p.y, z: p.z }
    const hit = this.physics.world.castRay(this.down, 16, true, undefined, undefined, this.player.collider)
    return hit ? p.y - hit.timeOfImpact : null
  }

  project(world: THREE.Vector3): { x: number; y: number } {
    const v = world.clone().project(this.cam.camera)
    const canvas = this.renderer.canvas
    return { x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight }
  }
}
