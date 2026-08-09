import { describe, expect, it } from 'vitest'
import { DialogsPlaceholder, detachRowProgress } from './dialogsPlaceholder'

// tweb dialogsPlaceholder.ts:169-176 — DURATION 150, DELAY 15 на строку;
// строки за пределами availableLength стартуют с задержкой последней доступной.
describe('detachRowProgress', () => {
  it('строка 0 начинается сразу, к 150мс полностью стёрта', () => {
    expect(detachRowProgress({ elapsed: 0, row: 0, availableLength: 5, length: 5 })).toBeCloseTo(0)
    expect(detachRowProgress({ elapsed: 150, row: 0, availableLength: 5, length: 5 })).toBeCloseTo(1)
  })
  it('строка 2 ждёт свой каскад 30мс', () => {
    expect(detachRowProgress({ elapsed: 30, row: 2, availableLength: 5, length: 5 })).toBeCloseTo(0)
    expect(detachRowProgress({ elapsed: 30 + 75, row: 2, availableLength: 5, length: 5 })).toBeCloseTo(0.5)
  })
  it('строки за availableLength стартуют вместе с последней доступной', () => {
    const a = detachRowProgress({ elapsed: 100, row: 7, availableLength: 3, length: 9 })
    const b = detachRowProgress({ elapsed: 100, row: 8, availableLength: 3, length: 9 })
    expect(a).toBeCloseTo(b)
  })
})

// В happy-dom нет 2d-контекста и у элементов нулевой rect, поэтому здесь проверяется
// только жизненный цикл: скелетон не должен навсегда запереть скролл списка, даже
// если рисовать было нечем.
describe('DialogsPlaceholder', () => {
  it('attach кладёт канвас и блокирует скролл, detach снимает и возвращает его', () => {
    const container = document.createElement('div')
    document.body.append(container)

    const placeholder = new DialogsPlaceholder()
    placeholder.attach({ container, blockScrollable: container })
    expect(container.querySelector('canvas.dialogs-placeholder-canvas')).not.toBe(null)
    expect(container.style.overflowY).toBe('hidden')

    placeholder.detach(5)
    expect(container.querySelector('canvas.dialogs-placeholder-canvas')).toBe(null)
    expect(container.style.overflowY).toBe('')

    container.remove()
  })
})
