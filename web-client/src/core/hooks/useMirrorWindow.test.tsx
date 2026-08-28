// src/core/hooks/useMirrorWindow.test.tsx
//
// ЕДИНСТВЕННЫЙ мост из НЕреактивного зеркала окон в React. Пины здесь про сам
// контракт моста, а не про содержимое окна (оно покрыто
// `core/history/messagesMirror.test.ts`):
//   (1) окно отдаётся синхронно, тем же значением, что видит императивная лента;
//   (2) любое изменение окна (операция воркера ИЛИ страница истории) будит
//       React-потребителя — иначе плашка ответа/счётчики канала/«Общие медиа»
//       молча замерзают;
//   (3) ссылка стабильна, пока окно не менялось (иначе мемоизация потребителя
//       рвётся на каждом чужом рендере);
// Снятие подписки на размонтировании проверяется у самого зеркала
// (`messagesMirror.test.ts`, describe «мост в React»): изнутри
// `useSyncExternalStore` колбэк не наблюдаем.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useMirrorWindow } from './useMirrorWindow'
import { applyOpsToMirror, putMirrorPage, resetMessagesMirror, winKey } from '../history/messagesMirror'
import { makeMessage } from '../messages/testMessage'
import type { MyMessage } from '../models'

const CHAT = 5
const OTHER = 6
const KEY = winKey(CHAT)

const msg = (id: number): MyMessage =>
  makeMessage({ id, peerId: CHAT, fromId: 1, text: `m${id}`, date: 1_750_000_000 + id })

beforeEach(() => resetMessagesMirror())
afterEach(() => resetMessagesMirror())

describe('useMirrorWindow', () => {
  it('ключ null — пустое окно, зеркало не читается', () => {
    putMirrorPage(KEY, [msg(1)])
    const { result } = renderHook(() => useMirrorWindow(null))
    expect(result.current).toEqual([])
  })

  it('окно, о котором зеркало ещё не знает, — пустой массив, а не undefined', () => {
    const { result } = renderHook(() => useMirrorWindow(KEY))
    expect(result.current).toEqual([])
  })

  it('операция воркера будит потребителя', () => {
    const { result } = renderHook(() => useMirrorWindow(KEY))
    act(() => { applyOpsToMirror([{ op: 'insert', key: KEY, msg: msg(7) }]) })
    expect(result.current.map((m) => m.id)).toEqual([7])
    act(() => { applyOpsToMirror([{ op: 'insert', key: KEY, msg: msg(8) }]) })
    expect(result.current.map((m) => m.id)).toEqual([7, 8])
    act(() => { applyOpsToMirror([{ op: 'remove', key: KEY, msgId: 7 }]) })
    expect(result.current.map((m) => m.id)).toEqual([8])
  })

  it('страница истории (putMirrorPage) будит потребителя так же, как операция', () => {
    const { result } = renderHook(() => useMirrorWindow(KEY))
    act(() => { putMirrorPage(KEY, [msg(1), msg(2)]) })
    expect(result.current.map((m) => m.id)).toEqual([1, 2])
  })

  it('окно ЧУЖОГО ключа возвращает свои сообщения, а не сообщения соседа', () => {
    const { result } = renderHook(() => useMirrorWindow(winKey(OTHER)))
    act(() => { applyOpsToMirror([{ op: 'insert', key: KEY, msg: msg(7) }]) })
    expect(result.current).toEqual([])
  })

  it('ссылка стабильна, пока окно не менялось', () => {
    putMirrorPage(KEY, [msg(1)])
    const { result, rerender } = renderHook(() => useMirrorWindow(KEY))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    // Идемпотентная операция окно не меняет (`applyOp` вернул ту же ссылку) —
    // версия не растёт, значит и ссылка у потребителя прежняя.
    act(() => { applyOpsToMirror([{ op: 'remove', key: KEY, msgId: 999 }]) })
    expect(result.current).toBe(first)
  })

})
