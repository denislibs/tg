// ПИН (backlogs/frontend/lottie-no-wasm-fallback.md, «медиаредактор — потеря
// тяжелее», часть 1 задачи «фолбэк без WASM SIMD»): без декодера lottie-стикер
// не должен быть добавляемым в медиаредактор вовсе — иначе он молча пропадает
// из сохранённого экспорта (`stickerAssets.ts`/`sceneRender.ts`). Ячейка гасится
// и клик по ней не зовёт onPick; статичный (webp/png) стикер этим не затронут.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'

vi.mock('@environment/webAssemblySimdSupport', () => ({ default: false }))

vi.mock('../StickerMedia', () => ({
  default: () => null,
  loadStickerContent: vi.fn(),
}))

const { panelStub } = vi.hoisted(() => ({
  panelStub: {
    recent: [] as unknown[],
    faved: [] as unknown[],
    sets: [] as unknown[],
    loaded: true,
    markUsed: vi.fn(),
  },
}))
vi.mock('../../core/hooks/useStickers', () => ({ useStickersPanel: () => panelStub }))

import StickerPicker from './StickerPicker'
import { makeSticker } from '../../core/stickers/testSticker'

afterEach(() => {
  cleanup()
  panelStub.markUsed.mockClear()
})

describe('StickerPicker: гейт lottie без WASM SIMD (@environment/webAssemblySimdSupport = false)', () => {
  it('lottie-ячейка недоступна: погашена, есть подсказка, клик не добавляет слой', () => {
    const lottie = makeSticker({ id: 501, mime: 'application/x-tgsticker' })
    panelStub.faved = [lottie]
    const onPick = vi.fn()

    const { container } = render(<StickerPicker onPick={onPick} />)
    const cell = container.querySelector('[title]') as HTMLElement
    expect(cell).not.toBeNull()
    expect(cell.getAttribute('title')).toMatch(/not supported/i)

    fireEvent.click(cell)
    expect(onPick).not.toHaveBeenCalled()
    expect(panelStub.markUsed).not.toHaveBeenCalled()
  })

  it('статичная (webp) ячейка не затронута: без подсказки, клик добавляет слой', () => {
    const webp = makeSticker({ id: 502, mime: 'image/webp' })
    panelStub.faved = [webp]
    const onPick = vi.fn()

    const { container } = render(<StickerPicker onPick={onPick} />)
    const cells = container.querySelectorAll('.stickerCell, [class*="stickerCell"]')
    const cell = Array.from(cells).find((el) => !el.className.includes('stickerCat')) as HTMLElement
    expect(cell).toBeTruthy()
    expect(cell.getAttribute('title')).toBeNull()

    fireEvent.click(cell)
    expect(onPick).toHaveBeenCalledWith(webp)
    expect(panelStub.markUsed).toHaveBeenCalledWith(webp)
  })
})
