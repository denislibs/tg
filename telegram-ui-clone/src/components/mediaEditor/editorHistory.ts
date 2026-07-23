// Undo/redo фоторедактора как чистые редьюсеры (тестируются без React/canvas).
// В истории — только откатываемые действия: штрих, добавление/удаление текста и
// добавление/удаление слоя-стикера (Enhance/Crop параметрические, сбрасываются
// кнопкой; перемещение/масштаб слоёв — live-мутации, отдельно не откатываются,
// как в tweb и как drag текста у нас). redoStack хранит данные, нужные для
// ПОВТОРА прямого действия, которое сняло undo.
import { pushHistory } from './editorMath'
import type { Stroke, TextBlock, StickerLayer } from './sceneRender'

export type HistoryItem =
  | { type: 'stroke' }
  | { type: 'text-add'; id: number }
  | { type: 'text-remove'; block: TextBlock }
  | { type: 'sticker-add'; id: number }
  | { type: 'sticker-remove'; layer: StickerLayer }

export type RedoItem =
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'text-add'; block: TextBlock }
  | { type: 'text-remove'; id: number }
  | { type: 'sticker-add'; layer: StickerLayer }
  | { type: 'sticker-remove'; id: number }

export interface EditHistoryState {
  history: HistoryItem[]
  redoStack: RedoItem[]
  strokes: Stroke[]
  texts: TextBlock[]
  stickers: StickerLayer[]
}

// Откат верхнего действия; снятое кладём в redoStack для возможного повтора.
export function applyUndo(s: EditHistoryState): EditHistoryState {
  const item = s.history[s.history.length - 1]
  if (!item) return s
  const history = s.history.slice(0, -1)
  const base = { history, strokes: s.strokes, texts: s.texts, stickers: s.stickers, redoStack: s.redoStack }
  if (item.type === 'stroke') {
    const stroke = s.strokes[s.strokes.length - 1]
    return {
      ...base,
      strokes: s.strokes.slice(0, -1),
      redoStack: stroke ? [...s.redoStack, { type: 'stroke', stroke }] : s.redoStack,
    }
  }
  if (item.type === 'text-add') {
    const block = s.texts.find((b) => b.id === item.id)
    return {
      ...base,
      texts: s.texts.filter((b) => b.id !== item.id),
      redoStack: block ? [...s.redoStack, { type: 'text-add', block }] : s.redoStack,
    }
  }
  if (item.type === 'text-remove') {
    // undo возвращает удалённый ранее блок
    return {
      ...base,
      texts: [...s.texts, item.block],
      redoStack: [...s.redoStack, { type: 'text-remove', id: item.block.id }],
    }
  }
  if (item.type === 'sticker-add') {
    const layer = s.stickers.find((l) => l.id === item.id)
    return {
      ...base,
      stickers: s.stickers.filter((l) => l.id !== item.id),
      redoStack: layer ? [...s.redoStack, { type: 'sticker-add', layer }] : s.redoStack,
    }
  }
  // sticker-remove: undo возвращает удалённый слой
  return {
    ...base,
    stickers: [...s.stickers, item.layer],
    redoStack: [...s.redoStack, { type: 'sticker-remove', id: item.layer.id }],
  }
}

// Повтор верхнего снятого действия; возвращаем его обратно в history.
export function applyRedo(s: EditHistoryState): EditHistoryState {
  const item = s.redoStack[s.redoStack.length - 1]
  if (!item) return s
  const redoStack = s.redoStack.slice(0, -1)
  const base = { redoStack, strokes: s.strokes, texts: s.texts, stickers: s.stickers, history: s.history }
  if (item.type === 'stroke') {
    return {
      ...base,
      strokes: [...s.strokes, item.stroke],
      history: pushHistory(s.history, { type: 'stroke' }),
    }
  }
  if (item.type === 'text-add') {
    return {
      ...base,
      texts: [...s.texts, item.block],
      history: pushHistory(s.history, { type: 'text-add', id: item.block.id }),
    }
  }
  if (item.type === 'text-remove') {
    // text-remove redo: снова удаляем блок
    const block = s.texts.find((b) => b.id === item.id)
    return {
      ...base,
      texts: s.texts.filter((b) => b.id !== item.id),
      history: block ? pushHistory(s.history, { type: 'text-remove', block }) : s.history,
    }
  }
  if (item.type === 'sticker-add') {
    return {
      ...base,
      stickers: [...s.stickers, item.layer],
      history: pushHistory(s.history, { type: 'sticker-add', id: item.layer.id }),
    }
  }
  // sticker-remove redo: снова удаляем слой
  const layer = s.stickers.find((l) => l.id === item.id)
  return {
    ...base,
    stickers: s.stickers.filter((l) => l.id !== item.id),
    history: layer ? pushHistory(s.history, { type: 'sticker-remove', layer }) : s.history,
  }
}
