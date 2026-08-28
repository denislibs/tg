// src/core/hooks/useChannelLive.test.tsx
//
// Открытый канал ОБЯЗАН быть подписан на свой топик: без подписки per-channel
// funnel воркера не открывает канал, и лента не получает ни живых постов, ни
// добора пропущенного через /difference. Строка проводки одна — её и пиним
// (норма покрытия, web-client/CLAUDE.md, «Тесты»).
//
// Счётчиков поста здесь больше нет: просмотры и тред приезжают внутри самого
// сообщения (`views`/`replies`), и проверяются они там, где рисуются, —
// снесённом components/messages/ChatFeed.commentsFooter.test.tsx.
import { renderHook, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { useChannelLive } from './useChannelLive'
import { ManagersProvider } from './useManagers'

const CHANNEL = -100

let subscribed: number[]
let unsubscribed: number[]

// Ссылка на менеджеров ДОЛЖНА быть стабильной: она в зависимостях эффекта
// (как и в бою — `useManagers` отдаёт один объект на приложение).
const managers = {
  realtime: {
    subscribeChannel: async ({ peerId }: { peerId: number }) => { subscribed.push(peerId) },
    unsubscribeChannel: async ({ peerId }: { peerId: number }) => { unsubscribed.push(peerId) },
  },
}

function mount(over: { isChannel?: boolean; isRealChat?: boolean } = {}) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ManagersProvider, { managers: managers as never, children })
  return renderHook(
    () => useChannelLive({
      isRealChat: over.isRealChat ?? true,
      isChannel: over.isChannel ?? true,
      numericChatId: CHANNEL,
    }),
    { wrapper },
  )
}

beforeEach(() => {
  subscribed = []
  unsubscribed = []
})

// Автоочистки в прогоне нет (`globals` выключены) — размонтируем сами.
afterEach(cleanup)

describe('useChannelLive — подписка канала на время открытого чата', () => {
  it('подписка ставится на открытии и снимается на закрытии', () => {
    const { unmount } = mount()
    expect(subscribed).toEqual([CHANNEL])
    unmount()
    expect(unsubscribed).toEqual([CHANNEL])
  })

  it('не канал — подписки нет', () => {
    mount({ isChannel: false })
    expect(subscribed).toEqual([])
  })

  it('ненастоящий чат (черновик открытия) — подписки нет', () => {
    mount({ isRealChat: false })
    expect(subscribed).toEqual([])
  })
})
