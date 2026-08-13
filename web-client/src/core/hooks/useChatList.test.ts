// Правило «заглушён» применяется к витрине здесь: глобально выключенный ТИП
// чатов должен показываться как muted (серая иконка и бейдж, tweb
// `isPeerLocalMuted` с `respectType`). Само правило живёт в
// `stores/notifyStore.ts::isDialogMuted` (пин единственности —
// `stores/noDuplicateMuteRule.test.ts`), здесь пинится ЕГО ПРИМЕНЕНИЕ: до этого
// теста удаление строки не красило ни одного теста во всём прогоне, хотя
// расхождение витрины с фильтром папок ровно на нём уже ловили (см. докблок
// `matchesThisFolder` в `core/hooks/useDialogListSource.ts`).
import { describe, expect, it, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useChatList } from './useChatList'
import { useChatsStore } from '../../stores/chatsStore'
import { useNotifyStore } from '../../stores/notifyStore'
import { useAppStateStore } from '../../stores/appState'
import type { Dialog } from '../models'
import type { NotifySettings } from '../managers/notifyManager'

const dialog = (chatId: number, over: Partial<Dialog> = {}): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false, ...over,
} as Dialog)

const settings = (over: Partial<NotifySettings> = {}): NotifySettings => ({
  private: { muted: false, preview: true },
  groups: { muted: false, preview: true },
  channels: { muted: false, preview: true },
  ...over,
})

beforeEach(() => {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false, meId: null })
  useChatsStore.getState().applyDialogOps([{ op: 'reset', items: [{ dialog: dialog(1, { type: 'group' }), index: 30 }] }])
  useAppStateStore.setState({ drafts: [] })
  useNotifyStore.setState({ settings: settings() })
})

describe('useChatList: глобально выключенный тип чатов', () => {
  it('тип заглушён — чат показывается как muted, хотя свой mute у диалога снят', () => {
    useNotifyStore.setState({ settings: settings({ groups: { muted: true, preview: true } }) })

    const { result } = renderHook(() => useChatList())

    expect(result.current[0].muted).toBe(true)
  })

  it('заглушён ДРУГОЙ тип — этому чату muted не выдумывается', () => {
    useNotifyStore.setState({ settings: settings({ channels: { muted: true, preview: true } }) })

    const { result } = renderHook(() => useChatList())

    expect(result.current[0].muted).toBeFalsy()
  })
})
