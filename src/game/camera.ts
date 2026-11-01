import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CONFIG } from './config'

const C = CONFIG.camera

/** Third-person follow camera: the survivor stays framed in front of the camera with free orbit. */
export class FollowCamera {
  readonly camera = new THREE.PerspectiveCamera(C.fov, 1, 0.1, 80)
  yaw = 0
  pitch = 0.27
  private distance = C.distance
  private readonly focus = new THREE.Vector3()
  private shake = 0

  constructor(private readonly physics: Physics, private readonly exclude: RAPIER.Collider) {}

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount)
  }

  reset(target: THREE.Vector3, yaw = this.yaw): void {
    this.yaw = yaw
    this.focus.copy(target)
    this.distance = C.distance
    this.update(target, { x: 0, y: 0 }, 1, true)
  }

  update(target: THREE.Vector3, look: { x: number; y: number }, frameSeconds: number, snap = false, reducedMotion = false): void {
    if (this.camera.fov !== CONFIG.camera.fov) {
      this.camera.fov = CONFIG.camera.fov
      this.camera.updateProjectionMatrix()
    }
    // Free horizontal orbit around the survivor, with a restrained vertical range for a grounded third-person read.
    this.yaw = wrapAngle(this.yaw - look.x * 0.9)
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y * 0.5, CONFIG.camera.minPitch, CONFIG.camera.maxPitch)

    const aim = target.clone().add(new THREE.Vector3(0, C.height * 0.52, 0))
    if (snap) this.focus.copy(aim)
    else {
      const k = 1 - Math.exp(-C.follow * frameSeconds)
      const kv = 1 - Math.exp(-C.follow * 0.6 * frameSeconds)
      this.focus.x += (aim.x - this.focus.x) * k
      this.focus.z += (aim.z - this.focus.z) * k
      this.focus.y += (aim.y - this.focus.y) * kv
    }

    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
    let wanted = CONFIG.camera.distance
    const hit = this.physics.world.castRay(new RAPIER.Ray(this.focus, dir), CONFIG.camera.distance, true, undefined, undefined, this.exclude)
    if (hit) wanted = Math.max(3.4, hit.timeOfImpact - 0.35)
    this.distance = wanted < this.distance || snap ? wanted : THREE.MathUtils.damp(this.distance, wanted, 4, frameSeconds)

    this.camera.position.copy(this.focus).addScaledVector(dir, this.distance)
    this.camera.lookAt(this.focus)
    if (this.shake > 0 && !reducedMotion) {
      const s = this.shake * this.shake * 0.16
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s))
    }
    this.shake = Math.max(0, this.shake - frameSeconds * 2.5)
  }
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}
