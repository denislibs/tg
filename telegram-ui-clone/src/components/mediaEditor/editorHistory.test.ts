// Undo/redo фоторедактора: undo→redo восстанавливает состояние; любое новое
// действие обнуляет ветку повтора (в MediaEditor redoStack чистится на новом
// штрихе/тексте — здесь проверяем сам инвариант редьюсеров).
import { describe, it, expect } from 'vitest'
import { applyUndo, applyRedo, type EditHistoryState } from './editorHistory'
import type { BrushType, Stroke, TextBlock, StickerLayer } from './sceneRender'

const stroke = (n: number, brush: BrushType = 'pen'): Stroke =>
  ({ brush, color: '#fff', size: 4, points: [{ x: n, y: n }] })
const block = (id: number): TextBlock =>
  ({ id, x: 0, y: 0, text: `t${id}`, color: '#fff', size: 32, style: 'normal', font: 'roboto', align: 'left' })
const sticker = (id: number): StickerLayer =>
  ({ id, mediaId: id * 10, x: 100, y: 120, scale: 1, rotation: 0 })

const empty = (): EditHistoryState => ({ history: [], redoStack: [], strokes: [], texts: [], stickers: [] })

describe('editorHistory — штрихи', () => {
  it('undo снимает штрих в redoStack, redo его восстанавливает', () => {
    const s0: EditHistoryState = { history: [{ type: 'stroke' }], redoStack: [], strokes: [stroke(1)], texts: [], stickers: [] }
    const undone = applyUndo(s0)
    expect(undone.strokes).toHaveLength(0)
    expect(undone.history).toHaveLength(0)
    expect(undone.redoStack).toHaveLength(1)

    const redone = applyRedo(undone)
    expect(redone.strokes).toEqual([stroke(1)])
    expect(redone.history).toEqual([{ type: 'stroke' }])
    expect(redone.redoStack).toHaveLength(0)
  })

  it('undo/redo сохраняет тип кисти в штрихе', () => {
    const brushes: BrushType[] = ['pen', 'arrow', 'marker', 'neon', 'blur', 'eraser']
    const s0: EditHistoryState = {
      history: brushes.map(() => ({ type: 'stroke' } as const)),
      redoStack: [],
      strokes: brushes.map((b, i) => stroke(i, b)),
      texts: [],
      stickers: [],
    }
    // снять все штрихи
    let s = s0
    for (let i = 0; i < brushes.length; i++) s = applyUndo(s)
    expect(s.strokes).toHaveLength(0)
    // вернуть все — порядок и brush должны совпасть с исходными
    for (let i = 0; i < brushes.length; i++) s = applyRedo(s)
    expect(s.strokes.map((st) => st.brush)).toEqual(brushes)
    expect(s.strokes).toEqual(s0.strokes)
  })
})

describe('editorHistory — добавление/удаление текста', () => {
  it('text-add: undo убирает блок, redo возвращает', () => {
    const s0: EditHistoryState = { history: [{ type: 'text-add', id: 7 }], redoStack: [], strokes: [], texts: [block(7)], stickers: [] }
    const undone = applyUndo(s0)
    expect(undone.texts).toHaveLength(0)
    const redone = applyRedo(undone)
    expect(redone.texts).toEqual([block(7)])
    expect(redone.history).toEqual([{ type: 'text-add', id: 7 }])
  })

  it('text-remove: undo возвращает блок, redo снова удаляет', () => {
    const s0: EditHistoryState = { history: [{ type: 'text-remove', block: block(3) }], redoStack: [], strokes: [], texts: [], stickers: [] }
    const undone = applyUndo(s0)
    expect(undone.texts).toEqual([block(3)])
    const redone = applyRedo(undone)
    expect(redone.texts).toHaveLength(0)
    expect(redone.history).toEqual([{ type: 'text-remove', block: block(3) }])
  })

  it('undo/redo сохраняет font и align текст-блока', () => {
    const b: TextBlock = { id: 9, x: 5, y: 6, text: 'hi', color: '#fe4438', size: 40, style: 'background', font: 'chewy', align: 'center' }
    const s0: EditHistoryState = { history: [{ type: 'text-add', id: 9 }], redoStack: [], strokes: [], texts: [b], stickers: [] }
    const back = applyRedo(applyUndo(s0))
    expect(back.texts[0].font).toBe('chewy')
    expect(back.texts[0].align).toBe('center')
    expect(back.texts[0]).toEqual(b)
  })
})

describe('editorHistory — стикеры', () => {
  it('sticker-add: undo убирает слой в redoStack, redo его возвращает', () => {
    const s0: EditHistoryState = { history: [{ type: 'sticker-add', id: 5 }], redoStack: [], strokes: [], texts: [], stickers: [sticker(5)] }
    const undone = applyUndo(s0)
    expect(undone.stickers).toHaveLength(0)
    expect(undone.history).toHaveLength(0)
    expect(undone.redoStack).toHaveLength(1)

    const redone = applyRedo(undone)
    expect(redone.stickers).toEqual([sticker(5)])
    expect(redone.history).toEqual([{ type: 'sticker-add', id: 5 }])
    expect(redone.redoStack).toHaveLength(0)
  })

  it('sticker-remove: undo возвращает слой, redo снова удаляет', () => {
    const s0: EditHistoryState = { history: [{ type: 'sticker-remove', layer: sticker(3) }], redoStack: [], strokes: [], texts: [], stickers: [] }
    const undone = applyUndo(s0)
    expect(undone.stickers).toEqual([sticker(3)])
    const redone = applyRedo(undone)
    expect(redone.stickers).toHaveLength(0)
    expect(redone.history).toEqual([{ type: 'sticker-remove', layer: sticker(3) }])
  })

  it('undo/redo сохраняет трансформацию слоя (scale/rotation/mediaId)', () => {
    const L: StickerLayer = { id: 8, mediaId: 42, x: 30, y: 40, scale: 2.5, rotation: 0.7 }
    const s0: EditHistoryState = { history: [{ type: 'sticker-add', id: 8 }], redoStack: [], strokes: [], texts: [], stickers: [L] }
    const back = applyRedo(applyUndo(s0))
    expect(back.stickers[0]).toEqual(L)
  })

  it('стикеры проходят сквозь undo/redo текста/штриха без потерь', () => {
    const L = sticker(2)
    const s0: EditHistoryState = { history: [{ type: 'text-add', id: 1 }], redoStack: [], strokes: [], texts: [block(1)], stickers: [L] }
    const undone = applyUndo(s0)
    expect(undone.stickers).toEqual([L]) // текст-undo не трогает стикеры
    const redone = applyRedo(undone)
    expect(redone.stickers).toEqual([L])
  })
})

describe('editorHistory — граничные случаи', () => {
  it('undo/redo на пустых стеках — no-op (тот же объект)', () => {
    const s = empty()
    expect(applyUndo(s)).toBe(s)
    expect(applyRedo(s)).toBe(s)
  })

  it('серия undo восстанавливается серией redo в исходное состояние', () => {
    const start: EditHistoryState = {
      history: [{ type: 'stroke' }, { type: 'text-add', id: 1 }],
      redoStack: [],
      strokes: [stroke(9)],
      texts: [block(1)],
      stickers: [],
    }
    const s = applyUndo(applyUndo(start))
    expect(s.strokes).toHaveLength(0)
    expect(s.texts).toHaveLength(0)
    const back = applyRedo(applyRedo(s))
    expect(back.strokes).toEqual(start.strokes)
    expect(back.texts).toEqual(start.texts)
    expect(back.history).toEqual(start.history)
    expect(back.redoStack).toHaveLength(0)
  })
})
