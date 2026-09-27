// Строка «Избранного» без онлайн-точки: оригинал спрашивает статус только
// у `peerId !== rootScope.myId` (tweb appDialogsManager.ts:2945-2951), иначе
// точка «в сети» горела бы на «Избранном», пока онлайн сам зритель.
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import type { Chat } from '../data'
import ChatListItem from './ChatListItem'

const managers = { peers: { fillMirror: async () => {} }, media: { downloadMediaURL: async () => '' } } as never

function renderRow(chat: Chat) {
  render(
    <ManagersProvider managers={managers}>
      <ChatListItem chat={chat} selected={false} onSelect={() => {}} />
    </ManagersProvider>,
  )
  return document.querySelector<HTMLElement>('.dialog-avatar')!
}

beforeEach(() => {
  useChatsStore.setState({ presence: { 5: { _: 'userStatusOnline', expires: 2_000_000_000 }, 6: { _: 'userStatusOnline', expires: 2_000_000_000 } } })
})
afterEach(cleanup)

describe('ChatListItem — онлайн-точка', () => {
  it('у «Избранного» точки нет, даже когда зритель онлайн', () => {
    const avatar = renderRow({ id: '5', name: 'Saved Messages', avatar: '', avatarEmoji: 'saved', preview: '', type: 'saved' })
    expect(avatar.classList.contains('is-online')).toBe(false)
  })

  it('у собеседника онлайн — есть', () => {
    const avatar = renderRow({ id: '6', name: 'Bob', avatar: '', preview: '', type: 'private' })
    expect(avatar.classList.contains('is-online')).toBe(true)
  })
})
