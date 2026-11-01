import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { Input } from '../src/engine/input'
import { Game } from '../src/game/game'

let input: Input
let axes: number[]
let game: Game
let state: any
let hint: ReturnType<typeof vi.fn>

beforeEach(() => {
  axes = [0, 0, 0, 0]
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('document', { pointerLockElement: null })
  vi.stubGlobal('navigator', { getGamepads: () => [{ index: 0, id: 'pad', connected: true, axes, buttons: [] }] })
  input = new Input({} as HTMLCanvasElement)
  hint = vi.fn()
  // Exercise the real input, render and tutorial transition without constructing WebGL/physics.
  game = Object.create(Game.prototype)
  state = game
  Object.assign(state, {
    input, mode: 'playing', tutorial: 'look', tutorialLook: 0, time: 0,
    physics: { sync() {} }, player: { root: { position: new THREE.Vector3() }, animate() {} },
    cam: { update: vi.fn() }, run: { invulnerable: 0, timeLeft: 100 },
    cores: { animate() {} }, drones: { animate() {} }, fx: { update() {} },
    world: { update() {} }, renderer: { render() {} }, groundBelow: () => null,
    hooks: { hint },
  })
})
afterEach(() => { input.dispose(); vi.unstubAllGlobals() })
function frame(hz: number): void { input.update(1 / hz); game.render(0, 1 / hz) }

describe('look tutorial', () => {
  for (const hz of [30, 60, 120, 144]) {
    it(`advances with a diagonal right stick at ${hz} Hz`, () => {
      axes[2] = axes[3] = Math.SQRT1_2
      for (let i = 0; i < hz; i++) frame(hz)
      expect(hint).toHaveBeenCalledExactlyOnceWith('jump')
    })
    it(`advances with a single-axis right stick at ${hz} Hz, including low sensitivity`, () => {
      input.sensitivity = 0.25
      axes[2] = 0.5
      for (let i = 0; i < hz; i++) frame(hz)
      expect(hint).toHaveBeenCalledExactlyOnceWith('jump')
      expect(state.tutorial).toBe('jump')
    })
  }
  it('does not advance from stick drift within the dead zone', () => {
    axes[2] = 0.1
    for (let i = 0; i < 144; i++) frame(144)
    expect(hint).not.toHaveBeenCalled()
  })
  it('preserves mouse-sized look deltas and the delta passed to the camera', () => {
    input.look.x = 0.06
    game.render(0, 1 / 144)
    expect(hint).toHaveBeenCalledExactlyOnceWith('jump')
    expect(state.cam.update.mock.calls[0][1]).toEqual({ x: 0.06, y: 0 })
  })
  it('does not count movement in another hint or while paused', () => {
    state.tutorial = 'move'; axes[2] = 1
    frame(60)
    state.advanceTutorial('look'); hint.mockClear()
    axes[2] = 0; input.takeLook(); frame(144)
    expect(hint).not.toHaveBeenCalled()
    state.mode = 'paused'; axes[2] = 1
    for (let i = 0; i < 60; i++) frame(60)
    expect(hint).not.toHaveBeenCalled()
    expect(state.tutorialLook).toBe(0)
  })
  it('clears partial progress when entering a new tutorial stage', () => {
    input.look.x = 0.04; game.render(0, 1 / 60)
    expect(hint).not.toHaveBeenCalled()
    state.advanceTutorial('look'); hint.mockClear()
    input.look.x = 0.02; game.render(0, 1 / 60)
    expect(hint).not.toHaveBeenCalled()
  })
})
