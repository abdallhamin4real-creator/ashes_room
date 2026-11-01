import { afterEach, describe, expect, it, vi } from 'vitest'
import { Ui } from '../src/ui/ui'

afterEach(() => vi.unstubAllGlobals())
describe('menu confirmation', () => {
  it('confirms the new focus when direction and confirm arrive together', () => {
    const previous = { click: vi.fn() }
    const next = { click: vi.fn() }
    const document = { activeElement: previous }
    vi.stubGlobal('document', document)
    const ui = Object.assign(Object.create(Ui.prototype), {
      screen: 'settings', lastMethod: 'gamepad', navRepeat: 0,
      input: { method: 'gamepad', move: { x: 0, y: -1 }, consume: (action: string) => action === 'confirm' },
      moveFocus: () => { document.activeElement = next },
    }) as Ui
    ui.frame(1 / 60)
    expect(previous.click).not.toHaveBeenCalled()
    expect(next.click).toHaveBeenCalledOnce()
  })
})
