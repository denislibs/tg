// Undo/redo фоторедактора как чистые редьюсеры (тестируются без React/canvas).
// В истории — только откатываемые действия: штрих и добавление/удаление текста
// (Enhance/Crop параметрические, сбрасываются кнопкой). redoStack хранит данные,
// нужные для ПОВТОРА прямого действия, которое сняло undo.
import { pushHistory } from './editorMath'
import type { Stroke, TextBlock } from './sceneRender'

export type HistoryItem =
  | { type: 'stroke' }
  | { type: 'text-add'; id: number }
  | { type: 'text-remove'; block: TextBlock }

export type RedoItem =
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'text-add'; block: TextBlock }
  | { type: 'text-remove'; id: number }

export interface EditHistoryState {
  history: HistoryItem[]
  redoStack: RedoItem[]
  strokes: Stroke[]
  texts: TextBlock[]
}

// Откат верхнего действия; снятое кладём в redoStack для возможного повтора.
export function applyUndo(s: EditHistoryState): EditHistoryState {
  const item = s.history[s.history.length - 1]
  if (!item) return s
  const history = s.history.slice(0, -1)
  if (item.type === 'stroke') {
    const stroke = s.strokes[s.strokes.length - 1]
    return {
      history,
      strokes: s.strokes.slice(0, -1),
      texts: s.texts,
      redoStack: stroke ? [...s.redoStack, { type: 'stroke', stroke }] : s.redoStack,
    }
  }
  if (item.type === 'text-add') {
    const block = s.texts.find((b) => b.id === item.id)
    return {
      history,
      strokes: s.strokes,
      texts: s.texts.filter((b) => b.id !== item.id),
      redoStack: block ? [...s.redoStack, { type: 'text-add', block }] : s.redoStack,
    }
  }
  // text-remove: undo возвращает удалённый ранее блок
  return {
    history,
    strokes: s.strokes,
    texts: [...s.texts, item.block],
    redoStack: [...s.redoStack, { type: 'text-remove', id: item.block.id }],
  }
}

// Повтор верхнего снятого действия; возвращаем его обратно в history.
export function applyRedo(s: EditHistoryState): EditHistoryState {
  const item = s.redoStack[s.redoStack.length - 1]
  if (!item) return s
  const redoStack = s.redoStack.slice(0, -1)
  if (item.type === 'stroke') {
    return {
      redoStack,
      texts: s.texts,
      strokes: [...s.strokes, item.stroke],
      history: pushHistory(s.history, { type: 'stroke' }),
    }
  }
  if (item.type === 'text-add') {
    return {
      redoStack,
      strokes: s.strokes,
      texts: [...s.texts, item.block],
      history: pushHistory(s.history, { type: 'text-add', id: item.block.id }),
    }
  }
  // text-remove redo: снова удаляем блок
  const block = s.texts.find((b) => b.id === item.id)
  return {
    redoStack,
    strokes: s.strokes,
    texts: s.texts.filter((b) => b.id !== item.id),
    history: block ? pushHistory(s.history, { type: 'text-remove', block }) : s.history,
  }
}
