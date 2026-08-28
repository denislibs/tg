// Правило «заглушён» применяется к витрине здесь: глобально выключенный ТИП
// чатов должен показываться как muted (серая иконка и бейдж, tweb
// `isPeerLocalMuted` с `respectType`). Само правило живёт в
// `stores/notifyStore.ts::isDialogMuted` (пин единственности —
// `stores/noDuplicateMuteRule.test.ts`), здесь пинится ЕГО ПРИМЕНЕНИЕ: до этого
// теста удаление строки не красило ни одного теста во всём прогоне, хотя
// расхождение витрины с фильтром папок ровно на нём уже ловили (см. докблок
// `matchesThisFolder` в `core/hooks/useDialogListSource.ts`).
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ManagersProvider } from './useManagers'
import type { Managers } from '../../client/bootstrap'
import { useChatList } from './useChatList'
import { useChatsStore } from '../../stores/chatsStore'
import { useNotifyStore } from '../../stores/notifyStore'
import type { NotifySettings } from '../managers/notifyManager'
import { makeDialog } from '../dialogs/testDialog'
import { applyPeerOps, resetPeerMirror } from '../peerCache'

// Вид чата больше не приезжает строкой (решение Р8): «супергруппа» — это
// конструктор `channel` с `pFlags.megagroup` в зеркале пиров.
const GROUP_PEER_ID = -1
const groupCard = { _: 'channel' as const, id: 1, title: 'Группа', photo: { _: 'chatPhotoEmpty' as const }, date: 0, pFlags: { megagroup: true as const } }

const settings = (over: Partial<NotifySettings> = {}): NotifySettings => ({
  private: { muted: false, preview: true },
  groups: { muted: false, preview: true },
  channels: { muted: false, preview: true },
  ...over,
})

// Зеркало пиров наполнено — карточки приезжают векторами контейнера `/chats`;
// пробела нет, поэтому фейку владельца остаётся только не упасть.
const managers = { peers: { fillMirror: vi.fn(async () => {}) } } as unknown as Managers
const withManagers = ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={managers}>{children}</ManagersProvider>
)

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [groupCard] }])
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false, meId: null })
  useChatsStore.getState().applyDialogOps([{ op: 'reset', items: [{ dialog: makeDialog({ peerId: GROUP_PEER_ID }), index: 30 }] }])
  useNotifyStore.setState({ settings: settings() })
})

describe('useChatList: глобально выключенный тип чатов', () => {
  it('тип заглушён — чат показывается как muted, хотя свой mute у диалога снят', () => {
    useNotifyStore.setState({ settings: settings({ groups: { muted: true, preview: true } }) })

    const { result } = renderHook(() => useChatList(), { wrapper: withManagers })

    expect(result.current[0].muted).toBe(true)
  })

  it('заглушён ДРУГОЙ тип — этому чату muted не выдумывается', () => {
    useNotifyStore.setState({ settings: settings({ channels: { muted: true, preview: true } }) })

    const { result } = renderHook(() => useChatList(), { wrapper: withManagers })

    expect(result.current[0].muted).toBeFalsy()
  })
})
