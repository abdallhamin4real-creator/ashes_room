import * as THREE from 'three'
import type { Physics } from '../engine/physics'
import { RAPIER } from '../engine/physics'
import { createUSP } from './weapon'

export type InteractableKind = 'clue' | 'door' | 'weapon'
export type Interactable = {
  id: string
  kind: InteractableKind
  position: THREE.Vector3
  mesh: THREE.Object3D
  label: string
  used: boolean
}

const ROOM = { width: 16, depth: 10, height: 5.6 }
const FLOOR = new THREE.Color('#353432')
const PLASTER = new THREE.Color('#4a4741')
const PLASTER_DARK = new THREE.Color('#302f2c')
const WOOD = new THREE.Color('#3a2922')
const METAL = new THREE.Color('#464746')
const RUST = new THREE.Color('#6a4031')

// Compatibility exports kept for the starter's pure level tests and unused drone module.
export type Island = { x: number; z: number; top: number; r: number; cores: number; decor?: boolean }
export type DroneRoute = { center: THREE.Vector3; radius: number; phase: number; dir: 1 | -1 }
export const ISLANDS: Island[] = [
  { x: 0, z: 0, top: 0, r: 7, cores: 2, decor: true },
  { x: 15, z: 3, top: 1.5, r: 4, cores: 2, decor: true },
  { x: 24, z: -8, top: 3.2, r: 3.5, cores: 2 },
  { x: 14, z: -19, top: 4.8, r: 4.5, cores: 2, decor: true },
]
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function planStones(a: Island, b: Island): { x: number; z: number; top: number }[] {
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz)
  const gap = d - a.r - b.r, dy = b.top - a.top
  let n = 0
  while ((gap - n * 1.8) / (n + 1) > 2.3 || Math.abs(dy) / (n + 1) > 1.05) n += 1
  const g = (gap - n * 1.8) / (n + 1)
  return Array.from({ length: n }, (_, index) => {
    const i = index + 1, along = a.r + g * i + 1.8 * (i - 0.5)
    return { x: a.x + (dx / d) * along, z: a.z + (dz / d) * along, top: a.top + (dy * i) / (n + 1) }
  })
}

/** One closed room: distressed plaster, heavy furniture, a locked door and two inspectable clues. */
export class World {
  readonly scene = new THREE.Scene()
  readonly sun: THREE.DirectionalLight
  readonly spawn = new THREE.Vector3(0, 1.18, 2.7)
  readonly interactables: Interactable[] = []
  private readonly dust: THREE.Points
  private readonly dustPositions: Float32Array
  private door!: { group: THREE.Group; collider: RAPIER.Collider; opened: boolean; progress: number }
  private readonly windowLight: THREE.PointLight
  private readonly lampLight: THREE.PointLight
  private readonly flickerSeed = Math.random() * 100
  private weaponItem?: Interactable

  constructor(private readonly physics: Physics, shadowMapSize: number) {
    this.scene.background = new THREE.Color('#101112')
    this.scene.fog = new THREE.FogExp2('#111213', 0.032)

    this.scene.add(new THREE.HemisphereLight('#b3bdc2', '#211f1b', 0.55))
    this.sun = new THREE.DirectionalLight('#b7c6ca', 1.55)
    this.sun.position.set(-7, 8, 5)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    this.sun.shadow.camera.left = -12
    this.sun.shadow.camera.right = 12
    this.sun.shadow.camera.top = 10
    this.sun.shadow.camera.bottom = -8
    this.sun.shadow.camera.near = 0.5
    this.sun.shadow.camera.far = 35
    this.sun.shadow.bias = -0.0005
    this.sun.shadow.normalBias = 0.035
    this.scene.add(this.sun, this.sun.target)

    this.windowLight = new THREE.PointLight('#90a9b7', 6.5, 13, 2)
    this.windowLight.position.set(-6.9, 3.2, -0.4)
    this.windowLight.castShadow = true
    this.windowLight.shadow.mapSize.set(Math.min(1024, shadowMapSize), Math.min(1024, shadowMapSize))
    this.scene.add(this.windowLight)

    this.lampLight = new THREE.PointLight('#c58c58', 5.2, 7, 2)
    this.lampLight.position.set(3.1, 2.4, 0.9)
    this.scene.add(this.lampLight)

    this.addRoomShell()
    this.addWindow()
    this.addDoor()
    this.addFurniture()
    this.addClues()
    this.addWeapon()
    this.dust = this.addDust()
    this.dustPositions = dustPositions(this.dust.geometry)
  }

  /** The closest usable object, used for the single-button interaction loop. */
  nearest(position: THREE.Vector3, radius = 1.55): Interactable | undefined {
    let best: Interactable | undefined
    let bestDistance = radius * radius
    for (const item of this.interactables) {
      if (item.used) continue
      const distance = item.position.distanceToSquared(position)
      if (distance < bestDistance) {
        best = item
        bestDistance = distance
      }
    }
    return best
  }

  objective(position: THREE.Vector3): THREE.Vector3 | undefined {
    const item = this.nearest(position, 99)
    return item?.position
  }

  /** Mark a clue as inspected, or open the door once all clues are found. */
  interact(item: Interactable): boolean {
    if (item.used) return false
    if (item.kind === 'clue') {
      item.used = true
      item.mesh.visible = false
      return true
    }
    if (item.kind === 'weapon') {
      item.used = true
      item.mesh.visible = false
      return true
    }
    if (!this.interactables.filter(x => x.kind === 'clue').every(x => x.used)) return false
    item.used = true
    this.door.opened = true
    return true
  }

  dropWeapon(position: THREE.Vector3): void {
    if (!this.weaponItem) return
    this.weaponItem.position.copy(position)
    this.weaponItem.mesh.position.copy(position)
    this.weaponItem.mesh.rotation.set(0.12, position.y * 0.7, -0.18)
    this.weaponItem.mesh.visible = true
    this.weaponItem.used = false
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.sun.position.set(focus.x - 7, focus.y + 8, focus.z + 5)
    this.sun.target.position.copy(focus)
    this.lampLight.intensity = 4.95 + Math.sin(this.flickerSeed + performance.now() * 0.004) * 0.22 + Math.sin(performance.now() * 0.011) * 0.08
    this.windowLight.intensity = 6.2 + Math.sin(this.flickerSeed * 1.7 + performance.now() * 0.0008) * 0.18

    if (this.door.opened) {
      this.door.progress = Math.min(1, this.door.progress + dt * 1.35)
      const ease = THREE.MathUtils.smootherstep(this.door.progress, 0, 1)
      this.door.group.rotation.y = -ease * Math.PI * 0.48
    }

    const positions = this.dust.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < positions.count; i += 1) {
      const y = this.dustPositions[i * 3 + 1] + dt * (0.018 + (i % 5) * 0.004)
      const nextY = y > 5.2 ? 0.35 : y
      positions.setY(i, nextY)
      positions.setX(i, this.dustPositions[i * 3] + Math.sin(performance.now() * 0.0002 + i) * 0.008)
    }
    positions.needsUpdate = true
  }

  private addRoomShell(): void {
    const floor = box(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(ROOM.width, 0.4, ROOM.depth), FLOOR, 0.98)
    floor.receiveShadow = true
    this.scene.add(floor)
    this.physics.addStaticBox(floor.position, new THREE.Vector3(ROOM.width, 0.4, ROOM.depth))

    // Three walls leave the camera inside the room while the ceiling stays visually present.
    this.addWall(new THREE.Vector3(-8.2, 2.8, 0), new THREE.Vector3(0.4, 5.6, 10.4), PLASTER)
    this.addWall(new THREE.Vector3(8.2, 2.8, 0), new THREE.Vector3(0.4, 5.6, 10.4), PLASTER_DARK)
    this.addWall(new THREE.Vector3(-5.15, 2.8, -5.2), new THREE.Vector3(5.9, 5.6, 0.4), PLASTER_DARK)
    this.addWall(new THREE.Vector3(5.15, 2.8, -5.2), new THREE.Vector3(5.9, 5.6, 0.4), PLASTER_DARK)
    const ceiling = box(new THREE.Vector3(0, 5.72, 0), new THREE.Vector3(16.4, 0.3, 10.4), new THREE.Color('#171717'), 1)
    ceiling.receiveShadow = true
    this.scene.add(ceiling)
    this.physics.addStaticBox(ceiling.position, new THREE.Vector3(16.4, 0.3, 10.4))

    // Deep seams and irregular plaster slabs break the pristine primitive silhouette.
    for (const z of [-4.65, -1.9, 1.3, 4.55]) {
      const seam = box(new THREE.Vector3(-8.01, 2.8, z), new THREE.Vector3(0.025, 5.1, 0.045), new THREE.Color('#171615'), 1)
      this.scene.add(seam)
    }
    for (const z of [-4.5, -1.1, 2.5]) {
      const seam = box(new THREE.Vector3(8.01, 2.8, z), new THREE.Vector3(0.025, 5.1, 0.045), new THREE.Color('#141313'), 1)
      this.scene.add(seam)
    }
    this.addCracks()
  }

  private addWall(center: THREE.Vector3, size: THREE.Vector3, materialColor: THREE.Color): void {
    const wall = box(center, size, materialColor, 0.95)
    wall.receiveShadow = true
    this.scene.add(wall)
    this.physics.addStaticBox(center, size)
  }

  private addWindow(): void {
    const frameMat = mat(new THREE.Color('#171819'), 0.72, 0.22)
    const glassMat = new THREE.MeshStandardMaterial({ color: '#8da6ad', roughness: 0.18, metalness: 0.05, emissive: '#35434a', emissiveIntensity: 0.4 })
    const frame = new THREE.Group()
    frame.position.set(-7.96, 3.25, -0.15)
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 2.1), glassMat)
    pane.rotation.y = Math.PI / 2
    pane.castShadow = false
    frame.add(pane)
    for (const z of [-1.15, 0.85]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.25, 0.12), frameMat)
      bar.rotation.y = Math.PI / 2
      bar.position.z = z
      frame.add(bar)
    }
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.25, 0.12), frameMat)
    mullion.rotation.y = Math.PI / 2
    mullion.position.x = 0
    frame.add(mullion)
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 3.5), frameMat)
    top.rotation.y = Math.PI / 2
    top.position.y = 1.08
    frame.add(top)
    const bottom = top.clone()
    bottom.position.y = -1.08
    frame.add(bottom)
    this.scene.add(frame)
  }

  private addDoor(): void {
    const group = new THREE.Group()
    group.position.set(0, 1.8, -5.0)
    const doorMat = mat(WOOD, 0.9, 0.02)
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.6, 0.18), doorMat)
    panel.castShadow = true
    panel.receiveShadow = true
    group.add(panel)
    const planks = new THREE.Mesh(new THREE.BoxGeometry(2.02, 3.4, 0.028), new THREE.MeshStandardMaterial({ color: '#4a3127', roughness: 0.98 }))
    planks.position.z = -0.11
    group.add(planks)
    for (const x of [-0.62, 0.62]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.18, 0.06), mat(RUST, 0.76, 0.55))
      brace.position.set(x, 0, -0.17)
      group.add(brace)
    }
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshStandardMaterial({ color: '#8f7352', roughness: 0.44, metalness: 0.72 }))
    handle.position.set(0.7, -0.1, -0.22)
    group.add(handle)
    this.scene.add(group)
    const collider = this.physics.addStaticBox(new THREE.Vector3(0, 1.8, -5.0), new THREE.Vector3(2.2, 3.6, 0.24))
    this.door = { group, collider, opened: false, progress: 0 }
    this.interactables.push({ id: 'door', kind: 'door', position: new THREE.Vector3(0, 1.0, -4.25), mesh: group, label: 'الباب', used: false })
  }

  private addFurniture(): void {
    const table = new THREE.Group()
    table.position.set(2.75, 0, 0.55)
    const topMat = mat(WOOD, 0.96, 0.02)
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.18, 1.1), topMat)
    top.position.y = 1.05
    top.castShadow = true
    top.receiveShadow = true
    table.add(top)
    for (const x of [-1.1, 1.1]) for (const z of [-0.35, 0.35]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), mat(new THREE.Color('#2b211b'), 0.98, 0))
      leg.position.set(x, 0.52, z)
      leg.castShadow = true
      table.add(leg)
    }
    this.scene.add(table)
    this.physics.addStaticBox(new THREE.Vector3(2.75, 1.05, 0.55), new THREE.Vector3(2.75, 0.18, 1.1))

    const cabinet = new THREE.Group()
    cabinet.position.set(-4.75, 1.25, -3.05)
    const cabinetBody = new THREE.Mesh(new THREE.BoxGeometry(1.65, 2.5, 0.62), mat(new THREE.Color('#302725'), 0.92, 0.03))
    cabinetBody.castShadow = true
    cabinetBody.receiveShadow = true
    cabinet.add(cabinetBody)
    for (const y of [0.42, -0.38]) {
      const drawer = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.58, 0.07), mat(new THREE.Color('#4c332b'), 0.96, 0.02))
      drawer.position.set(0, y, -0.35)
      drawer.castShadow = true
      cabinet.add(drawer)
      const pull = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.05), mat(new THREE.Color('#9a7e55'), 0.42, 0.78))
      pull.position.set(0, y, -0.4)
      cabinet.add(pull)
    }
    this.scene.add(cabinet)
    this.physics.addStaticBox(new THREE.Vector3(-4.75, 1.25, -3.05), new THREE.Vector3(1.65, 2.5, 0.62))

    this.addCrate(new THREE.Vector3(-2.85, 0.45, 1.6), new THREE.Vector3(0.9, 0.9, 0.9), 0.2)
    this.addCrate(new THREE.Vector3(-1.95, 1.28, 1.65), new THREE.Vector3(0.7, 0.7, 0.7), -0.13)
    this.addChair(new THREE.Vector3(4.55, 0.55, 1.65), 0.18)
    this.addChair(new THREE.Vector3(4.75, 0.55, 2.8), -0.34)
    this.addLamp()
  }

  private addCrate(position: THREE.Vector3, size: THREE.Vector3, yaw: number): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat(new THREE.Color('#4a3328'), 0.94, 0.02))
    mesh.position.copy(position)
    mesh.rotation.y = yaw
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.scene.add(mesh)
    const rot = new THREE.Quaternion().setFromEuler(mesh.rotation)
    this.physics.addDynamic(mesh, RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setRotation(rot).setFriction(0.92), 2.5)
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.8, 0.035, 0.035), mat(new THREE.Color('#71503d'), 0.98, 0))
    stripe.position.y = size.y * 0.15
    stripe.rotation.z = 0.16
    mesh.add(stripe)
  }

  private addChair(position: THREE.Vector3, yaw: number): void {
    const group = new THREE.Group()
    group.position.copy(position)
    group.rotation.y = yaw
    const wood = mat(new THREE.Color('#3b2a22'), 0.96, 0.01)
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.13, 0.9), wood)
    seat.position.y = 0.55
    group.add(seat)
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.15, 0.12), wood)
    back.position.set(0, 1.05, 0.39)
    group.add(back)
    for (const x of [-0.32, 0.32]) for (const z of [-0.32, 0.32]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.55, 0.11), wood)
      leg.position.set(x, 0.27, z)
      group.add(leg)
    }
    group.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.castShadow = true; obj.receiveShadow = true } })
    this.scene.add(group)
    this.physics.addStaticBox(position.clone().setY(position.y + 0.55), new THREE.Vector3(0.9, 0.13, 0.9), new THREE.Quaternion().setFromEuler(group.rotation))
  }

  private addLamp(): void {
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 1.7, 10), mat(METAL, 0.55, 0.68))
    stand.position.set(3.1, 0.85, 0.9)
    stand.castShadow = true
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.48, 0.48, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#7b5d43', roughness: 0.8, metalness: 0.02, side: THREE.DoubleSide }))
    shade.position.set(3.1, 1.8, 0.9)
    shade.castShadow = true
    this.scene.add(stand, shade)
  }

  private addClues(): void {
    const paperMat = new THREE.MeshStandardMaterial({ color: '#b4aa96', roughness: 0.9, metalness: 0 })
    const paperOne = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42), paperMat)
    paperOne.rotation.x = -Math.PI / 2
    paperOne.rotation.z = -0.15
    paperOne.position.set(2.72, 1.16, 0.52)
    paperOne.castShadow = true
    this.scene.add(paperOne)
    this.interactables.push({ id: 'note', kind: 'clue', position: new THREE.Vector3(2.72, 1.35, 0.52), mesh: paperOne, label: 'ورقة ممزقة', used: false })

    const photo = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.035, 0.42), new THREE.MeshStandardMaterial({ color: '#928778', roughness: 0.94, metalness: 0 }))
    photo.position.set(-4.75, 2.56, -3.18)
    photo.rotation.x = -0.08
    photo.castShadow = true
    this.scene.add(photo)
    this.interactables.push({ id: 'photo', kind: 'clue', position: new THREE.Vector3(-4.75, 2.1, -2.78), mesh: photo, label: 'صورة باهتة', used: false })
  }

  private addWeapon(): void {
    const mesh = createUSP()
    mesh.position.set(-1.15, 0.18, -0.15)
    mesh.rotation.set(0.12, -0.5, -0.18)
    mesh.scale.setScalar(0.92)
    this.scene.add(mesh)
    this.weaponItem = { id: 'usp', kind: 'weapon', position: mesh.position.clone(), mesh, label: 'USP', used: false }
    this.interactables.push(this.weaponItem)
  }

  private addCracks(): void {
    const crackMat = new THREE.LineBasicMaterial({ color: '#141312', transparent: true, opacity: 0.7 })
    const lines = [
      [[-7.98, 4.0, -3.7], [-7.98, 3.4, -3.3], [-7.98, 3.0, -3.5], [-7.98, 2.45, -3.0]],
      [[7.98, 1.4, -3.8], [7.98, 1.7, -3.3], [7.98, 1.2, -2.9], [7.98, 0.7, -2.4]],
      [[-3.4, 5.5, -5.02], [-2.7, 5.2, -5.02], [-2.3, 5.45, -5.02]],
    ]
    for (const points of lines) {
      const geo = new THREE.BufferGeometry().setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
      this.scene.add(new THREE.Line(geo, crackMat))
    }
  }

  private addDust(): THREE.Points {
    const count = 180
    const positions = new Float32Array(count * 3)
    const random = seeded(1187)
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (random() - 0.5) * 15
      positions[i * 3 + 1] = 0.45 + random() * 4.7
      positions[i * 3 + 2] = (random() - 0.5) * 9
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#a9a49a', size: 0.018, transparent: true, opacity: 0.22, depthWrite: false }))
    points.renderOrder = 2
    this.scene.add(points)
    return points
  }
}

function mat(color: THREE.Color, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

function box(position: THREE.Vector3, size: THREE.Vector3, color: THREE.Color, roughness: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat(color, roughness, 0.01))
  mesh.position.copy(position)
  return mesh
}

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function dustPositions(geometry: THREE.BufferGeometry): Float32Array {
  const attr = geometry.attributes.position as THREE.BufferAttribute
  return new Float32Array(attr.array as ArrayLike<number>)
}
