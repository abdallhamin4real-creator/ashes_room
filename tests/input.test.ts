import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Input } from '../src/engine/input'

let listeners: Map<string, Set<(event: any) => void>>
let pads: Array<Gamepad | null>
let input: Input
const canvas = {} as HTMLCanvasElement
function pad(index = 0): Gamepad {
  return { index, id: `pad-${index}`, connected: true, mapping: 'standard',
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  } as unknown as Gamepad
}
function button(p: Gamepad, index: number, down: boolean): void {
  (p.buttons as GamepadButton[])[index] = { pressed: down, touched: down, value: down ? 1 : 0 }
}
function emit(type: string, event: any = {}): void {
  for (const listener of listeners.get(type) ?? []) listener(event)
}
function key(type: string, code: string, typing = false): void {
  emit(type, { code, repeat: false, target: { matches: () => typing }, preventDefault: vi.fn() })
}
beforeEach(() => {
  listeners = new Map(); pads = [pad()]
  vi.stubGlobal('window', {
    addEventListener(type: string, listener: (event: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(listener)
    },
    removeEventListener(type: string, listener: (event: any) => void) { listeners.get(type)?.delete(listener) },
  })
  vi.stubGlobal('document', { pointerLockElement: null })
  vi.stubGlobal('navigator', { getGamepads: () => pads })
  input = new Input(canvas)
})
afterEach(() => { input.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('controller input', () => {
  it('maps D-pad movement without requiring the left stick', () => {
    button(pads[0]!, 13, true); button(pads[0]!, 15, true)
    input.update()
    expect(input.method).toBe('gamepad')
    expect(input.move.x).toBeCloseTo(Math.SQRT1_2)
    expect(input.move.y).toBeCloseTo(-Math.SQRT1_2)
  })
  for (const hz of [30, 60, 120, 144]) {
    it(`turns the camera at the same rate at ${hz} FPS`, () => {
      (pads[0]!.axes as number[])[2] = 1
      let yaw = 0
      for (let i = 0; i < hz; i++) { input.update(1 / hz); yaw += input.takeLook().x }
      expect(yaw).toBeCloseTo(2.7)
    })
  }

  it('recognizes each physical dash press even when another dash binding is held', () => {
    const p = pads[0]!
    button(p, 5, true); input.update(); expect(input.consume('dash')).toBe(true)
    button(p, 2, true); input.update(); expect(input.consume('dash')).toBe(true)
    input.update(); expect(input.consume('dash')).toBe(false); expect(input.held('dash')).toBe(true)
  })
  it('clears previous pad buttons after disconnect so reconnect presses work', () => {
    button(pads[0]!, 0, true); input.update(); expect(input.consume('confirm')).toBe(true)
    input.consume('jump'); pads = []; input.update()
    expect(input.held('jump')).toBe(false)
    pads = [pad()]; button(pads[0]!, 0, true); input.update()
    expect(input.consume('confirm')).toBe(true)
  })

  it('keeps standard pause, confirm, back and sprint bindings', () => {
    for (const b of [0, 1, 4, 9]) button(pads[0]!, b, true)
    input.update()
    for (const action of ['pause', 'confirm', 'back'] as const) {
      expect(input.consume(action)).toBe(true); expect(input.consume(action)).toBe(false)
    }
    expect(input.held('sprint')).toBe(true)
  })
  it('does not suppress a new pad at a reused index', () => {
    button(pads[0]!, 0, true); input.update(); input.consume('jump')
    const replacement = { ...pad(), id: 'replacement' } as Gamepad
    pads = [replacement]; button(replacement, 0, true); input.update()
    expect(input.consume('jump')).toBe(true)
  })
  it('resets button history on the disconnect event even between polls', () => {
    button(pads[0]!, 0, true); input.update(); input.consume('jump')
    emit('gamepaddisconnected', { gamepad: pads[0] }); input.update()
    expect(input.consume('jump')).toBe(true)
  })
})

describe('input lifecycle', () => {
  it('keeps analog movement, dead zone and diagonal normalization', () => {
    const axes = pads[0]!.axes as number[]
    axes[0] = 0.17; axes[1] = 0
    input.update(); expect(input.move.x).toBe(0)
    axes[0] = 0.3; axes[1] = -0.4
    input.update(); expect(input.move).toEqual({ x: 0.3, y: 0.4 })
    axes[0] = 1; axes[1] = -1
    input.update(); expect(input.move.x).toBeCloseTo(Math.SQRT1_2)
    expect(input.move.y).toBeCloseTo(Math.SQRT1_2)
  })
  it('preserves keyboard movement and released D-pad state', () => {
    button(pads[0]!, 13, true); input.update()
    expect(input.move.y).toBe(-1)
    button(pads[0]!, 13, false); input.update()
    expect(input.move.x).toBe(0); expect(input.move.y).toBe(0)
    key('keydown', 'KeyW'); input.update()
    expect(input.move.y).toBe(1)
  })
  it('does not retrigger the selected pad when an unrelated pad disconnects', () => {
    button(pads[0]!, 0, true); input.update(); input.consume('jump')
    emit('gamepaddisconnected', { gamepad: pad(1) }); input.update()
    expect(input.consume('jump')).toBe(false)
  })
  it('applies sensitivity and inversion without time-scaling touch look', () => {
    input.sensitivity = 2; input.invertY = true
    input.addTouchLook(10, 20); input.update(1 / 30)
    expect(input.takeLook()).toEqual({ x: 0.12, y: -0.24 })
    expect(input.takeLook().x).toBe(0)
    const axes = pads[0]!.axes as number[]
    axes[2] = 1; axes[3] = -1
    input.update(1 / 30)
    const look = input.takeLook()
    expect(look.x).toBeCloseTo(0.18); expect(look.y).toBeCloseTo(0.18)
  })

  it('buffers a keyboard tap until a fixed step consumes it', () => {
    key('keydown', 'Space'); key('keyup', 'Space'); input.update()
    expect(input.held('jump')).toBe(false); expect(input.consume('jump')).toBe(true)
    expect(input.consume('jump')).toBe(false)
  })
  it('keeps touch movement and one press per touch without repeats', () => {
    input.setTouchMove(0.4, 0.2); input.setTouchButton('jump', true); input.update()
    expect(input.move).toEqual({ x: 0.4, y: 0.2 }); expect(input.consume('jump')).toBe(true)
    input.update(); expect(input.consume('jump')).toBe(false); expect(input.held('jump')).toBe(true)
  })
})
