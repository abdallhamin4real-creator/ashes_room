import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { initPhysics, Physics } from '../src/engine/physics'
import { Player, type PlayerEvent, type PlayerIntent } from '../src/game/player'
import { CONFIG } from '../src/game/config'

let physics: Physics
let player: Player
let events: PlayerEvent[]
const neutral: PlayerIntent = { moveX: 0, moveY: 0, sprint: false, jumpPressed: false, jumpHeld: false, dashPressed: false }
function step(intent: Partial<PlayerIntent> = {}): void { player.step(1 / 60, { ...neutral, ...intent }, 0, events) }
const jumps = () => events.filter(e => e.type === 'jump')

beforeEach(async () => {
  await initPhysics()
  physics = new Physics()
  player = new Player(physics, new THREE.Vector3(0, 5, 0), [])
  events = []
})
afterEach(() => physics.dispose())

describe('jump and dash priority', () => {
  it('jumps immediately when A and dash arrive together on the ground', () => {
    player.grounded = true
    step({ jumpPressed: true, jumpHeld: true, dashPressed: true })
    expect(events).toEqual([{ type: 'jump' }])
    expect(player.dashing).toBe(false)
    expect(player.velocity.y).toBeCloseTo(CONFIG.player.jumpSpeed + CONFIG.player.gravity / 60)
    // Suppressed dash must not spend its cooldown.
    step({ dashPressed: true })
    expect(player.dashing).toBe(true)
  })
  it('interrupts an active dash with a valid grounded jump', () => {
    player.grounded = true; step({ dashPressed: true })
    expect(player.dashing).toBe(true)
    player.grounded = true; step({ jumpPressed: true, jumpHeld: true })
    expect(jumps()).toHaveLength(1)
    expect(player.dashing).toBe(false)
    expect(player.velocity.y).toBeGreaterThan(0)
    // Cancelling the active dash must not reset its cooldown.
    step({ dashPressed: true })
    expect(events.filter(e => e.type === 'dash')).toHaveLength(1)
  })
  it('accepts a jump in the final valid coyote step', () => {
    player.grounded = true; step()
    for (let i = 0; i < 6; i++) step()
    step({ jumpPressed: true, jumpHeld: true })
    expect(jumps()).toHaveLength(1)
  })
  it('does not add an air jump once the coyote window has expired', () => {
    player.grounded = true; step()
    for (let i = 0; i < 8; i++) step()
    step({ jumpPressed: true, jumpHeld: true, dashPressed: true })
    expect(jumps()).toHaveLength(0)
    expect(player.dashing).toBe(true)
  })
  it('keeps a pre-landing jump buffered and cancels dash when landing permits it', () => {
    step({ dashPressed: true, jumpPressed: true })
    expect(jumps()).toHaveLength(0)
    step(); step()
    player.grounded = true; step()
    expect(jumps()).toHaveLength(1)
    expect(player.dashing).toBe(false)
  })
  it('does not jump on a much later landing after buffered input expires', () => {
    step({ jumpPressed: true, dashPressed: true })
    for (let i = 0; i < 30; i++) step()
    player.grounded = true; step()
    expect(jumps()).toHaveLength(0)
  })
  it('does not repeat jump just because A remains held at landing', () => {
    player.grounded = true; step({ jumpPressed: true, jumpHeld: true })
    for (let i = 0; i < 30; i++) step({ jumpHeld: true })
    player.grounded = true; step({ jumpHeld: true })
    expect(jumps()).toHaveLength(1)
  })
  it('keeps short-press jump gravity after interrupting dash', () => {
    player.grounded = true; step({ dashPressed: true })
    player.grounded = true; step({ jumpPressed: true, jumpHeld: false })
    expect(player.velocity.y).toBeCloseTo(CONFIG.player.jumpSpeed + CONFIG.player.lowJumpGravity / 60)
  })
})
