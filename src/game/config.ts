/**
 * Gameplay tuning retained from the starter so the physics and Tweak contract remain stable.
 * The room scene supplies the grounded, slower-feeling presentation around these values.
 */
export const DEFAULT_CONFIG = {
  run: {
    seconds: 150,
    lives: 3,
    invulnerable: 1.6,
    killY: -18,
  },
  score: {
    core: 100,
    comboWindow: 3.5,
    comboMax: 5,
    timeBonus: 25,
    lifeBonus: 500,
  },
  player: {
    radius: 0.42,
    halfHeight: 0.5,
    walkSpeed: 7,
    sprintSpeed: 11,
    acceleration: 60,
    stopDamping: 30,
    airControl: 0.45,
    jumpSpeed: 10.5,
    gravity: -30,
    lowJumpGravity: -58,
    maxFall: -40,
    coyoteTime: 0.12,
    jumpBuffer: 0.14,
    dashSpeed: 22,
    dashTime: 0.16,
    dashCooldown: 0.9,
    turnSpeed: 14,
  },
  camera: {
    distance: 6.8,
    height: 2.35,
    minPitch: -0.3,
    maxPitch: 0.8,
    follow: 14,
    fov: 62,
  },
  drones: {
    speed: 3.2,
    radius: 0.7,
    rageSpeed: 5,
    rageAt: 45,
  },
} as const

type MutableConfig<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends object ? MutableConfig<T[K]> : T[K] }
export const CONFIG: MutableConfig<typeof DEFAULT_CONFIG> = structuredClone(DEFAULT_CONFIG)
