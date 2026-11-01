import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CONFIG } from './config'
import { tuning } from './tuning'
import { createMuzzleFlash, createUSP } from './weapon'

export type PlayerIntent = { moveX: number; moveY: number; sprint: boolean; jumpPressed: boolean; jumpHeld: boolean; dashPressed: boolean }
export type PlayerEvent = { type: 'jump' } | { type: 'land'; impact: number } | { type: 'dash' }

const P = CONFIG.player
const UP = new THREE.Vector3(0, 1, 0)

/** A grounded humanoid controller using Rapier's kinematic character controller. */
export class Player {
  readonly root = new THREE.Group()
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  readonly velocity = new THREE.Vector3()
  grounded = false
  facing = 0
  private readonly controller: RAPIER.KinematicCharacterController
  private readonly model = new THREE.Group()
  private readonly shadow: THREE.Mesh
  private mixer?: THREE.AnimationMixer
  private idleAction?: THREE.AnimationAction
  private walkAction?: THREE.AnimationAction
  private readonly weaponRoot = new THREE.Group()
  private readonly muzzleFlash = createMuzzleFlash()
  private weaponAnimation: 'idle' | 'pickup' | 'throw' | 'reload' | 'fire' = 'idle'
  private weaponAnimationTime = 0
  private readonly weaponBase = new THREE.Vector3(0.34, 0.14, -0.4)
  private coyote = 0
  private jumpBuffer = 0
  private jumping = false
  private dashTime = 0
  private dashCooldown = 0
  private runCycle = 0
  readonly safe = new THREE.Vector3()

  constructor(private readonly physics: Physics, spawn: THREE.Vector3, _legacyMovers: unknown[] = []) {
    const world = physics.world
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z))
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(P.halfHeight, P.radius).setFriction(0), this.body)
    this.controller = world.createCharacterController(0.02)
    this.controller.enableAutostep(0.28, 0.2, false)
    this.controller.enableSnapToGround(0.3)
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(42))
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(35))
    this.controller.setApplyImpulsesToDynamicBodies(true)
    this.safe.copy(spawn)
    this.root.position.copy(spawn)
    this.buildProceduralModel()
    this.weaponRoot.add(createUSP())
    this.muzzleFlash.position.set(0, 0, -0.72)
    this.weaponRoot.add(this.muzzleFlash)
    this.weaponRoot.position.copy(this.weaponBase)
    this.weaponRoot.visible = false
    this.root.add(this.model)
    physics.bind(this.body, this.root)

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(P.radius * 1.55, 32),
      new THREE.MeshBasicMaterial({ color: '#050505', transparent: true, opacity: 0.38, depthWrite: false }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.renderOrder = 1
  }

  get shadowMesh(): THREE.Mesh { return this.shadow }
  get position(): THREE.Vector3 { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y, t.z) }
  get dashing(): boolean { return this.dashTime > 0 }
  get weaponEquipped(): boolean { return this.weaponRoot.visible }

  /** Replace the procedural fallback with a generated GLB while preserving collider dimensions. */
  replaceModel(asset: THREE.Object3D, clips: THREE.AnimationClip[] = []): void {
    this.model.clear()
    this.model.add(this.weaponRoot)
    asset.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true
        obj.receiveShadow = true
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
        materials.forEach(material => { if ('roughness' in material) (material as THREE.MeshStandardMaterial).roughness = Math.max(0.52, (material as THREE.MeshStandardMaterial).roughness ?? 0.8) })
      }
    })
    const bounds = new THREE.Box3().setFromObject(asset)
    const size = bounds.getSize(new THREE.Vector3())
    const scale = 1.8 / Math.max(0.01, size.y)
    asset.scale.setScalar(scale)
    const scaledBounds = new THREE.Box3().setFromObject(asset)
    const center = scaledBounds.getCenter(new THREE.Vector3())
    asset.position.set(-center.x, -center.y, -center.z)
    this.model.add(asset)
    if (clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(asset)
      const idle = clips.find(clip => /standing|idle/i.test(clip.name)) ?? clips[0]
      const walk = clips.find(clip => /walk/i.test(clip.name))
      this.idleAction = this.mixer.clipAction(idle)
      this.idleAction.play()
      if (walk) {
        this.walkAction = this.mixer.clipAction(walk)
        this.walkAction.play()
        this.walkAction.weight = 0
      }
    }
  }

  equipWeapon(): void {
    this.weaponRoot.visible = true
    this.playWeaponAnimation('pickup')
  }

  unequipWeapon(): void {
    this.weaponRoot.visible = false
    this.weaponAnimation = 'idle'
    this.muzzleFlash.visible = false
  }

  playWeaponAnimation(animation: 'pickup' | 'throw' | 'reload' | 'fire'): void {
    this.weaponAnimation = animation
    this.weaponAnimationTime = animation === 'reload' ? 1.25 : animation === 'pickup' ? 0.55 : animation === 'throw' ? 0.42 : 0.16
    if (animation === 'fire') this.muzzleFlash.visible = true
  }

  step(dt: number, intent: PlayerIntent, cameraYaw: number, events: PlayerEvent[]): void {
    const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw))
    const right = new THREE.Vector3().crossVectors(forward, UP)
    const wish = new THREE.Vector3().addScaledVector(right, intent.moveX).addScaledVector(forward, intent.moveY)
    const wishLen = Math.min(1, wish.length())
    if (wishLen > 0.01) wish.normalize()

    this.coyote = this.grounded ? P.coyoteTime : Math.max(0, this.coyote - dt)
    this.jumpBuffer = intent.jumpPressed ? P.jumpBuffer : Math.max(0, this.jumpBuffer - dt)
    this.dashCooldown = Math.max(0, this.dashCooldown - dt)

    const jumpReady = this.jumpBuffer > 0 && this.coyote > 0
    if (jumpReady) this.dashTime = 0
    if (intent.dashPressed && this.dashCooldown <= 0 && !jumpReady) {
      tuning.activate('dash')
      const dir = wishLen > 0.01 ? wish : new THREE.Vector3(-Math.sin(this.facing), 0, -Math.cos(this.facing))
      this.facing = Math.atan2(-dir.x, -dir.z)
      this.velocity.set(dir.x * P.dashSpeed, Math.max(this.velocity.y, 0), dir.z * P.dashSpeed)
      this.dashTime = P.dashTime
      this.dashCooldown = P.dashCooldown
      events.push({ type: 'dash' })
    }

    if (this.dashTime > 0) {
      this.dashTime -= dt
      this.velocity.y = Math.max(this.velocity.y, 0)
    } else {
      const speed = (intent.sprint ? P.sprintSpeed : P.walkSpeed) * wishLen
      const control = this.grounded ? 1 : P.airControl
      const target = wish.clone().multiplyScalar(speed)
      const horizontal = new THREE.Vector3(this.velocity.x, 0, this.velocity.z)
      const blend = wishLen > 0.01
        ? 1 - Math.exp(-P.acceleration * control * dt)
        : 1 - Math.exp(-P.stopDamping * control * dt)
      horizontal.lerp(target, blend)
      if (wishLen <= 0.01 && horizontal.lengthSq() < 0.0025) horizontal.set(0, 0, 0)
      this.velocity.x = horizontal.x
      this.velocity.z = horizontal.z
      if (jumpReady) {
        tuning.activate('jump')
        this.velocity.y = P.jumpSpeed
        this.jumping = true
        this.jumpBuffer = 0
        this.coyote = 0
        this.grounded = false
        events.push({ type: 'jump' })
      }
      const rising = this.velocity.y > 0
      this.velocity.y = Math.max(P.maxFall, this.velocity.y + (rising && this.jumping && !intent.jumpHeld ? P.lowJumpGravity : P.gravity) * dt)
    }

    if (wishLen > 0.1 && this.dashTime <= 0) this.facing = dampAngle(this.facing, Math.atan2(-wish.x, -wish.z), P.turnSpeed, dt)
    const desired = this.velocity.clone().multiplyScalar(dt)
    this.controller.computeColliderMovement(this.collider, desired)
    const moved = this.controller.computedMovement()
    const wasGrounded = this.grounded
    this.grounded = this.controller.computedGrounded()
    if (this.velocity.y > 0 && moved.y < desired.y - 1e-3) this.velocity.y = 0
    if (this.grounded) {
      if (!wasGrounded && this.velocity.y < -3) events.push({ type: 'land', impact: Math.min(1, -this.velocity.y / 18) })
      if (this.velocity.y < 0) this.velocity.y = -1
      this.jumping = false
      if (this.position.y > 0.6) this.safe.copy(this.position)
    }
    const cur = this.body.translation()
    this.body.setNextKinematicTranslation({ x: cur.x + moved.x, y: cur.y + moved.y, z: cur.z + moved.z })
  }

  teleport(to: THREE.Vector3): void {
    this.body.setTranslation(to, true)
    this.body.setNextKinematicTranslation(to)
    this.velocity.set(0, 0, 0)
    this.grounded = false
    this.root.position.copy(to)
    this.physics.snap(this.body)
  }

  animate(frameSeconds: number, time: number, invulnerable: boolean, ground: number | null): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.z)
    this.mixer?.update(frameSeconds)
    this.animateWeapon(frameSeconds)
    if (this.walkAction && this.idleAction) {
      const walkWeight = THREE.MathUtils.clamp(speed / P.walkSpeed, 0, 1)
      this.walkAction.weight = walkWeight
      this.idleAction.weight = 1 - walkWeight
      // Keep footfalls proportional to real ground speed so the survivor does not skate.
      this.walkAction.timeScale = THREE.MathUtils.clamp(speed / P.walkSpeed, 0.65, 1.65)
    }
    this.model.rotation.y = this.facing
    if (this.grounded && speed > 0.35) this.runCycle += frameSeconds * speed * 1.9
    const bob = this.grounded ? Math.abs(Math.sin(this.runCycle)) * 0.045 * Math.min(1, speed / 3.2) : 0
    this.model.position.y = bob
    this.model.rotation.x = -Math.min(0.11, speed / 50) * (this.dashing ? 1.5 : 1)
    this.model.visible = !invulnerable || Math.floor(time * 16) % 2 === 0
    if (ground === null) this.shadow.visible = false
    else {
      const feet = this.root.position.y - P.halfHeight - P.radius
      const height = Math.max(0, feet - ground)
      this.shadow.visible = height < 10
      this.shadow.position.set(this.root.position.x, ground + 0.03, this.root.position.z)
      const k = THREE.MathUtils.clamp(1 - height / 10, 0.28, 1)
      this.shadow.scale.setScalar(k)
      ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.38 * k
    }
  }

  private animateWeapon(frameSeconds: number): void {
    if (!this.weaponRoot.visible) return
    const duration = this.weaponAnimation === 'reload' ? 1.25 : this.weaponAnimation === 'pickup' ? 0.55 : this.weaponAnimation === 'throw' ? 0.42 : 0.16
    const progress = THREE.MathUtils.clamp(1 - this.weaponAnimationTime / duration, 0, 1)
    this.weaponRoot.position.copy(this.weaponBase)
    this.muzzleFlash.visible = this.weaponAnimation === 'fire' && progress < 0.28
    if (this.weaponAnimation === 'pickup') {
      const ease = THREE.MathUtils.smootherstep(progress, 0, 1)
      this.weaponRoot.position.y -= (1 - ease) * 0.62
      this.weaponRoot.rotation.z = (1 - ease) * -0.8
    } else if (this.weaponAnimation === 'throw') {
      this.weaponRoot.position.z += progress * 0.42
      this.weaponRoot.rotation.x = progress * 1.8
    } else if (this.weaponAnimation === 'reload') {
      this.weaponRoot.position.x += Math.sin(progress * Math.PI) * 0.1
      this.weaponRoot.rotation.z = Math.sin(progress * Math.PI) * 0.55
    } else if (this.weaponAnimation === 'fire') {
      this.weaponRoot.position.z -= Math.sin(progress * Math.PI) * 0.1
    }
    this.weaponAnimationTime = Math.max(0, this.weaponAnimationTime - frameSeconds)
    if (this.weaponAnimationTime === 0) {
      this.weaponAnimation = 'idle'
      this.weaponRoot.position.copy(this.weaponBase)
      this.weaponRoot.rotation.set(0, 0, 0)
      this.muzzleFlash.visible = false
    }
  }

  private buildProceduralModel(): void {
    const skin = new THREE.MeshStandardMaterial({ color: '#80685c', roughness: 0.9, metalness: 0 })
    const jacket = new THREE.MeshStandardMaterial({ color: '#313332', roughness: 0.96, metalness: 0.02 })
    const shirt = new THREE.MeshStandardMaterial({ color: '#4b4641', roughness: 0.98 })
    const trousers = new THREE.MeshStandardMaterial({ color: '#202322', roughness: 0.98 })
    const boot = new THREE.MeshStandardMaterial({ color: '#171817', roughness: 0.8, metalness: 0.04 })
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), skin)
    head.position.y = 0.73
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 12), skin)
    neck.position.y = 0.48
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.32), jacket)
    torso.position.y = 0.12
    torso.rotation.z = -0.02
    const undershirt = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.34), shirt)
    undershirt.position.set(0, 0.15, -0.17)
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.285, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), new THREE.MeshStandardMaterial({ color: '#171817', roughness: 0.96 }))
    hair.position.y = 0.82
    for (const x of [-0.22, 0.22]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.47, 5, 10), jacket)
      arm.position.set(x, 0.16, 0)
      arm.rotation.z = x < 0 ? -0.14 : 0.14
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), skin)
      hand.position.set(x * 1.08, -0.14, 0)
      this.addVisual(arm, hand)
    }
    for (const x of [-0.16, 0.16]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 5, 10), trousers)
      leg.position.set(x, -0.48, 0)
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.13, 0.42), boot)
      shoe.position.set(x, -0.83, -0.07)
      this.addVisual(leg, shoe)
    }
    this.addVisual(head, neck, torso, undershirt, hair)
  }

  private addVisual(...objects: THREE.Object3D[]): void {
    for (const object of objects) {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true }
      this.model.add(object)
    }
  }
}

function dampAngle(from: number, to: number, lambda: number, dt: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return from + delta * (1 - Math.exp(-lambda * dt))
}
