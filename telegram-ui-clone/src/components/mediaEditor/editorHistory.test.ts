// Undo/redo фоторедактора: undo→redo восстанавливает состояние; любое новое
// действие обнуляет ветку повтора (в MediaEditor redoStack чистится на новом
// штрихе/тексте — здесь проверяем сам инвариант редьюсеров).
import { describe, it, expect } from 'vitest'
import { applyUndo, applyRedo, type EditHistoryState } from './editorHistory'
import type { Stroke, TextBlock } from './sceneRender'

const stroke = (n: number): Stroke => ({ color: '#fff', size: 4, points: [{ x: n, y: n }] })
const block = (id: number): TextBlock => ({ id, x: 0, y: 0, text: `t${id}`, color: '#fff', size: 32, style: 'normal' })

const empty = (): EditHistoryState => ({ history: [], redoStack: [], strokes: [], texts: [] })

describe('editorHistory — штрихи', () => {
  it('undo снимает штрих в redoStack, redo его восстанавливает', () => {
    const s0: EditHistoryState = { history: [{ type: 'stroke' }], redoStack: [], strokes: [stroke(1)], texts: [] }
    const undone = applyUndo(s0)
    expect(undone.strokes).toHaveLength(0)
    expect(undone.history).toHaveLength(0)
    expect(undone.redoStack).toHaveLength(1)

    const redone = applyRedo(undone)
    expect(redone.strokes).toEqual([stroke(1)])
    expect(redone.history).toEqual([{ type: 'stroke' }])
    expect(redone.redoStack).toHaveLength(0)
  })
})

describe('editorHistory — добавление/удаление текста', () => {
  it('text-add: undo убирает блок, redo возвращает', () => {
    const s0: EditHistoryState = { history: [{ type: 'text-add', id: 7 }], redoStack: [], strokes: [], texts: [block(7)] }
    const undone = applyUndo(s0)
    expect(undone.texts).toHaveLength(0)
    const redone = applyRedo(undone)
    expect(redone.texts).toEqual([block(7)])
    expect(redone.history).toEqual([{ type: 'text-add', id: 7 }])
  })

  it('text-remove: undo возвращает блок, redo снова удаляет', () => {
    const s0: EditHistoryState = { history: [{ type: 'text-remove', block: block(3) }], redoStack: [], strokes: [], texts: [] }
    const undone = applyUndo(s0)
    expect(undone.texts).toEqual([block(3)])
    const redone = applyRedo(undone)
    expect(redone.texts).toHaveLength(0)
    expect(redone.history).toEqual([{ type: 'text-remove', block: block(3) }])
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
