// src/core/hooks/useMessageWindow.mirror.test.ts
//
// Страницу истории в ЗЕРКАЛО окон (`core/history/messagesMirror.ts`) кладёт тот,
// кто её загрузил для ЖИВОЙ ленты — порт модели tweb, где `historyStorage`
// наполняет `getHistory`, а лента читает загруженное.
//
// Живых лент две, и они взаимоисключимы флагом `VITE_VANILLA_FEED`:
//   * флаг ВЫКЛЮЧЕН — историю грузит этот хук (React-ветка), он и кладёт;
//   * флаг ВКЛЮЧЁН  — историю грузит `chat/bubbles.ts` и кладёт сама
//     (`components/chat/bubbles.ts:2034`), хук в зеркало НЕ пишет.
//
// Зачем это пинить. С зеркала теперь читают НЕленточные потребители окна:
// плашка ответа над композером (черновик / жест ленты / Ctrl+↑), счётчики
// комментариев и просмотров поста канала, инвалидация вкладок «Общие медиа».
// Пропадёт запись — под ВЫКЛЮЧЕННЫМ флагом (сегодняшнее умолчание прода) они
// молча перестанут видеть уже загруженную историю: ошибки не будет, просто
// «сообщение вне окна». Второй писатель под ВКЛЮЧЁННЫМ флагом так же молчалив,
// но ломает другое — в окне ленты оказались бы сообщения, которых она не
// рисовала.
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Флаг живой ленты — компилтайм-константа (`config/app.ts` читает
// `import.meta.env.VITE_VANILLA_FEED`), поэтому его переключаем моком модуля, а
// не переменной окружения. Мок отдаёт ГЕТТЕР: `useMessageWindow` читает
// `AppConfig.vanillaFeed` в момент доезда страницы, значит одного модульного
// графа хватает на оба режима (пересборка модулей ломала бы контекст
// `ManagersProvider` и уводила зеркало в другой экземпляр).
const flag = vi.hoisted(() => ({ vanillaFeed: false }))
vi.mock('../../config/app', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../config/app')>()
  return {
    ...mod,
    AppConfig: { ...mod.AppConfig, get vanillaFeed() { return flag.vanillaFeed } },
  }
})

import { useMessageWindow } from './useMessageWindow'
import { ManagersProvider } from './useManagers'
import { mirrorWindow, resetMessagesMirror, winKey } from '../history/messagesMirror'
import { useMessagesStore } from '../../stores/messagesStore'
import { generateMessageId } from '../history/messageId'
import { makeMessage } from '../messages/testMessage'
import type { MyMessage } from '../models'
import type { HistoryArgs, HistoryResult } from '../managers/messagesManager'

const CHAT = 1
const cid = generateMessageId

const msg = (id: number): MyMessage =>
  makeMessage({ id: cid(id), peerId: CHAT, fromId: 1, text: `m${id}`, date: 1_750_000_000 + id })

function fakeManagers(handler: (a: HistoryArgs) => HistoryResult, around?: () => HistoryResult) {
  return {
    messages: {
      getHistory: async (a: HistoryArgs) => handler(a),
      getAround: around ? async () => around() : undefined,
    },
  }
}

function mount(managers: unknown) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ManagersProvider, { managers: managers as never, children })
  return renderHook(() => useMessageWindow(CHAT, 40), { wrapper })
}

const ids = () => (mirrorWindow(winKey(CHAT)) ?? []).map((m) => m.id)

beforeEach(() => {
  flag.vanillaFeed = false
  resetMessagesMirror()
  useMessagesStore.setState({ byKey: {} })
})

afterEach(() => resetMessagesMirror())

describe('useMessageWindow → зеркало: флаг ВЫКЛЮЧЕН (React-лента живая)', () => {
  it('первая страница окна доезжает до зеркала', async () => {
    const { result } = mount(fakeManagers(() => ({
      messages: [msg(3), msg(4)], count: 2, reachedTop: false, reachedBottom: true,
    })))
    await waitFor(() => expect(result.current.msgs.length).toBe(2))
    expect(ids()).toEqual([cid(3), cid(4)])
  })

  it('догрузка вверх (loadOlder) дописывает страницу в зеркало', async () => {
    const { result } = mount(fakeManagers((a) =>
      a.offsetId === 0
        ? { messages: [msg(3), msg(4)], count: 2, reachedTop: false, reachedBottom: true }
        : { messages: [msg(1), msg(2)], count: 2, reachedTop: true, reachedBottom: false }))
    await waitFor(() => expect(result.current.msgs.length).toBe(2))
    await act(async () => { await result.current.loadOlder() })
    expect(ids()).toEqual([cid(1), cid(2), cid(3), cid(4)])
  })

  it('догрузка вниз (loadNewer) дописывает страницу в зеркало', async () => {
    const { result } = mount(fakeManagers((a) =>
      a.offsetId === 0
        ? { messages: [msg(3)], count: 1, reachedTop: true, reachedBottom: false }
        : { messages: [msg(4), msg(5)], count: 2, reachedTop: true, reachedBottom: true }))
    await waitFor(() => expect(result.current.msgs.length).toBe(1))
    await act(async () => { await result.current.loadNewer() })
    expect(ids()).toEqual([cid(3), cid(4), cid(5)])
  })

  it('переход к сообщению (jumpTo) кладёт свою страницу в зеркало', async () => {
    const { result } = mount(fakeManagers(
      () => ({ messages: [msg(9)], count: 1, reachedTop: false, reachedBottom: true }),
      () => ({ messages: [msg(1), msg(2)], count: 2, reachedTop: true, reachedBottom: false }),
    ))
    await waitFor(() => expect(result.current.msgs.length).toBe(1))
    await act(async () => { await result.current.jumpTo(cid(1)) })
    expect(ids()).toEqual([cid(1), cid(2), cid(9)])
  })

  it('возврат к свежему окну (reloadNewest) кладёт свою страницу в зеркало', async () => {
    let call = 0
    const { result } = mount(fakeManagers(() => (++call === 1
      ? { messages: [msg(3)], count: 1, reachedTop: true, reachedBottom: true }
      : { messages: [msg(7)], count: 1, reachedTop: false, reachedBottom: true })))
    await waitFor(() => expect(result.current.msgs.length).toBe(1))
    await act(async () => { await result.current.reloadNewest() })
    expect(ids()).toEqual([cid(3), cid(7)])
  })
})

describe('useMessageWindow → зеркало: флаг ВКЛЮЧЁН (живая лента — vanilla)', () => {
  beforeEach(() => { flag.vanillaFeed = true })

  it('хук в зеркало не пишет — страницу кладёт сама лента', async () => {
    const { result } = mount(fakeManagers(() => ({
      messages: [msg(3), msg(4)], count: 2, reachedTop: false, reachedBottom: true,
    })))
    await waitFor(() => expect(result.current.msgs.length).toBe(2))
    expect(mirrorWindow(winKey(CHAT))).toBeUndefined()
  })
})
