// Глобальные настройки уведомлений по типу чатов: стор держит
// `peerNotifySettings` по ключам `notifyUsers|notifyChats|notifyBroadcasts`
// (tweb `appNotificationsManager.peerSettings`, `savePeerSettings`).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dialog } from '../core/models'
import type { NotifySettings } from '../core/managers/notifyManager'
import { MUTE_UNTIL_FOREVER } from '../core/dialogs/notifySettings'
import { isDialogMuted, isTypeMuted, loadNotifySettings, notifyTypeForChat, typeShowPreviews, useNotifyStore } from './notifyStore'

const NOW = 1_800_000_000
const DEFAULT = (): NotifySettings => useNotifyStore.getInitialState().settings

beforeEach(() => useNotifyStore.setState({ settings: DEFAULT(), loaded: false }))

describe('notifyStore', () => {
  it('по умолчанию ничто не заглушено, превью показывается', () => {
    const s = useNotifyStore.getState().settings
    for (const key of ['notifyUsers', 'notifyChats', 'notifyBroadcasts'] as const) {
      expect(isTypeMuted(s, key, NOW)).toBe(false)
      expect(typeShowPreviews(s, key)).toBe(true)
    }
  })

  it('apply: mute_until в будущем → тип заглушён, остальные нет', () => {
    useNotifyStore.getState().apply('notifyUsers', { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER, show_previews: true })
    const s = useNotifyStore.getState().settings
    expect(isTypeMuted(s, 'notifyUsers', NOW)).toBe(true)
    expect(isTypeMuted(s, 'notifyChats', NOW)).toBe(false)
  })

  it('apply: срок в прошлом — не мьют', () => {
    useNotifyStore.getState().apply('notifyChats', { _: 'peerNotifySettings', mute_until: NOW - 10 })
    expect(isTypeMuted(useNotifyStore.getState().settings, 'notifyChats', NOW)).toBe(false)
  })

  it('apply сливает поля: событие с одним mute_until не стирает show_previews', () => {
    useNotifyStore.getState().apply('notifyChats', { _: 'peerNotifySettings', show_previews: false })
    useNotifyStore.getState().apply('notifyChats', { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER })
    const s = useNotifyStore.getState().settings
    expect(typeShowPreviews(s, 'notifyChats')).toBe(false)
    expect(isTypeMuted(s, 'notifyChats', NOW)).toBe(true)
  })

  it('apply не трогает ссылку на словарь, если ничего не изменилось (подписчики не просыпаются зря)', () => {
    useNotifyStore.getState().apply('notifyUsers', { _: 'peerNotifySettings', mute_until: 0, show_previews: true })
    const before = useNotifyStore.getState().settings
    useNotifyStore.getState().apply('notifyUsers', { _: 'peerNotifySettings', mute_until: 0, show_previews: true })
    expect(useNotifyStore.getState().settings).toBe(before)
  })

  it('notifyTypeForChat: пользователь → notifyUsers; группа → notifyChats; канал → notifyBroadcasts', () => {
    expect(notifyTypeForChat(7, undefined)).toBe('notifyUsers')
    expect(notifyTypeForChat(-5, undefined)).toBe('notifyChats')
    expect(notifyTypeForChat(-5, { _: 'channel', pFlags: { broadcast: true } } as never)).toBe('notifyBroadcasts')
  })

  it('isDialogMuted: заглушённый ТИП глушит чат без своего мьюта; свой мьют диалога — тоже', () => {
    useNotifyStore.getState().apply('notifyUsers', { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER, show_previews: true })
    const s = useNotifyStore.getState().settings
    const dlg = (notify_settings?: Dialog['notify_settings']) => ({ peerId: 7, notify_settings }) as Pick<Dialog, 'peerId' | 'notify_settings'>
    expect(isDialogMuted(dlg(), undefined, s, NOW)).toBe(true)
    expect(isDialogMuted({ peerId: -5 } as never, undefined, s, NOW)).toBe(false)
    expect(isDialogMuted({ peerId: -5, notify_settings: { _: 'peerNotifySettings', mute_until: NOW + 60 } } as never, undefined, s, NOW)).toBe(true)
  })

  it('loadNotifySettings кладёт в стор все три типа одним getNotifyPeerTypeSettings', async () => {
    const loaded: NotifySettings = {
      notifyUsers: { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER, show_previews: false },
      notifyChats: { _: 'peerNotifySettings', mute_until: 0, show_previews: true },
      notifyBroadcasts: { _: 'peerNotifySettings', mute_until: 0, show_previews: true },
    }
    const getNotifyPeerTypeSettings = vi.fn(async () => loaded)
    await loadNotifySettings({ notify: { getNotifyPeerTypeSettings } })
    expect(useNotifyStore.getState().settings).toEqual(loaded)
    expect(useNotifyStore.getState().loaded).toBe(true)
  })

  it('loadNotifySettings: отказ сервера оставляет дефолты', async () => {
    await loadNotifySettings({ notify: { getNotifyPeerTypeSettings: async () => { throw new Error('offline') } } })
    expect(useNotifyStore.getState().settings).toEqual(DEFAULT())
    expect(useNotifyStore.getState().loaded).toBe(false)
  })
})

// Мьют чата трёхзначный (tweb appNotificationsManager.ts:342-384): настройки типа
// подставляются только в НЕопределённые поля пира. Явное «уведомлять» —
// mute_until: 0 (togglePeerMute, appMessagesManager.ts:11985-11991, и истечение
// срока в checkMuteUntil :187-190) — перекрывает заглушённый тип.
describe('isDialogMuted: мьют чата против типа', () => {
  const typeMuted = (): NotifySettings => ({
    ...DEFAULT(),
    notifyUsers: { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER, show_previews: true },
  })
  const dlg = (notify_settings: Dialog['notify_settings']) => ({ peerId: 7, notify_settings }) as Pick<Dialog, 'peerId' | 'notify_settings'>

  it('мьют не задан — наследует заглушённый тип', () => {
    expect(isDialogMuted(dlg({ _: 'peerNotifySettings' }), undefined, typeMuted(), NOW)).toBe(true)
  })
  it('явное «уведомлять» (mute_until: 0) перекрывает заглушённый тип', () => {
    expect(isDialogMuted(dlg({ _: 'peerNotifySettings', mute_until: 0 }), undefined, typeMuted(), NOW)).toBe(false)
  })
  it('истёкший срок — тоже явное «уведомлять», тип не возвращается', () => {
    expect(isDialogMuted(dlg({ _: 'peerNotifySettings', mute_until: NOW - 5 }), undefined, typeMuted(), NOW)).toBe(false)
  })
  it('срок в будущем глушит сам, даже когда тип включён', () => {
    expect(isDialogMuted(dlg({ _: 'peerNotifySettings', mute_until: NOW + 60 }), undefined, DEFAULT(), NOW)).toBe(true)
  })
  it('silent у чата глушит независимо от срока', () => {
    expect(isDialogMuted(dlg({ _: 'peerNotifySettings', silent: true, mute_until: 0 }), undefined, DEFAULT(), NOW)).toBe(true)
  })
  it('диалога в зеркале нет — решает тип («личные» по умолчанию)', () => {
    expect(isDialogMuted(undefined, undefined, typeMuted(), NOW)).toBe(true)
    expect(isDialogMuted(undefined, undefined, DEFAULT(), NOW)).toBe(false)
  })
})
