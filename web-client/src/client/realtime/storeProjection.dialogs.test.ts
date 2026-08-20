// Task 2 (перенос владения диалогами): проектор — зеркало диалогов. Сравниваем
// ОТВЕТ ВЛАДЕЛЬЦА (dialogsManager) с состоянием зеркала (chatsStore), а не
// зеркало с самим собой — по образцу storeProjection.peers.test.ts.
//
// Стенд склеивает настоящий dialogsManager с настоящим проектором тем же
// каналом rt:dialog_op, что и в проде (workerCore.ts: onDialogOps → broadcast →
// realtimeBridge → storeProjection). Проверять стороны по отдельности здесь
// бессмысленно: предмет задачи — что владелец и витрина НЕ расходятся.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'
import { cachedPeerTheme, resetChatFullMirror, saveChatFull } from '../../core/chatFullCache'
import { RT } from '../../core/realtime/events'
import { useChatsStore } from '../../stores/chatsStore'
import { newDialogsManager } from '../../core/managers/dialogsManager'
import type { Dialog } from '../../core/models'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'
import { makeDialog, makeLastMessage } from '../../core/dialogs/testDialog'
import { MUTE_UNTIL_FOREVER, type PeerNotifySettings } from '../../core/dialogs/notifySettings'

/** «Навсегда» — не флаг, а далёкий срок (порт MUTE_UNTIL). */
const MUTED: PeerNotifySettings = { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER }

const dialog = (peerId: number, at = '2026-08-01T00:00:00Z'): Dialog => makeDialog({ peerId, lastMessage: makeLastMessage({ peerId, seq: 1, senderId: 1, text: 'x', createdAt: at }) })

/** onDialogOps — та же проводка, что в проде задаёт workerCore
 *  (broadcast(RT.dialogOp, {ops})); здесь вместо веера портов сразу локальный
 *  ре-эмит, как это делает realtimeBridge на вкладке. */
function stand(cache: Dialog[]) {
  const mgr = newDialogsManager({
    rest: { get: async () => ({ chats: [] }) } as never,
    onDialogOps: (ops) => rootScope.dispatchEventSingle(RT.dialogOp, { ops }),
    loadCache: async () => cache,
    loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
  })
  return { mgr }
}

describe('storeProjection — диалоги: воркер владеет, витрина зеркалит', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  beforeEach(() => { useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false }) })

  // ГЛАВНЫЙ ПИН задачи: зеркало обязано совпасть с тем, что реально отдал
  // владелец через fillMirror(), а не просто с тем, что записали в тесте руками.
  it('состояние зеркала совпадает с ответом владельца', async () => {
    const { mgr } = stand([dialog(1, '2026-08-01T00:00:00Z'), dialog(2, '2026-08-02T00:00:00Z')])

    await mgr.fillMirror()

    expect(useChatsStore.getState().dialogs.map((d) => d.peerId))
      .toEqual(mgr.getSnapshot().map((i) => i.dialog.peerId))
  })

  it('reindex меняет порядок, не трогая значения', () => {
    const st = useChatsStore.getState()
    st.applyDialogOps([{ op: 'reset', items: [
      { dialog: dialog(1), index: 10 }, { dialog: dialog(2), index: 20 },
    ] }])
    st.applyDialogOps([{ op: 'reindex', items: [{ peerId: 1, index: 30 }] }])

    expect(useChatsStore.getState().dialogs.map((d) => d.peerId)).toEqual([1, 2])
  })

  // upsert: новый диалог появляется, существующий обновляется полями операции.
  it('upsert добавляет новый диалог и обновляет существующий', () => {
    const st = useChatsStore.getState()
    st.applyDialogOps([{ op: 'reset', items: [{ dialog: dialog(1), index: 10 }] }])

    st.applyDialogOps([{ op: 'upsert', items: [
      { dialog: { ...dialog(1), unread_count: 7 }, index: 10 },
      { dialog: dialog(2), index: 20 },
    ] }])

    const s = useChatsStore.getState()
    expect(s.dialogs.map((d) => d.peerId)).toEqual([2, 1])
    expect(s.dialogs.find((d) => d.peerId === 1)?.unread_count).toBe(7)
  })

  // patch: точечное изменение полей без замены объекта целиком; index двигает строку.
  it('patch меняет поля и (если пришёл index) двигает строку', () => {
    const st = useChatsStore.getState()
    st.applyDialogOps([{ op: 'reset', items: [
      { dialog: dialog(1), index: 10 }, { dialog: dialog(2), index: 20 },
    ] }])

    st.applyDialogOps([{ op: 'patch', peerId: 1, fields: { notify_settings: MUTED }, index: 30 }])

    const s = useChatsStore.getState()
    expect(s.dialogs.find((d) => d.peerId === 1)?.notify_settings).toEqual(MUTED)
    expect(s.dialogs.map((d) => d.peerId)).toEqual([1, 2]) // index 30 > 20 — 1 теперь выше
  })

  // Ревью Task 2 (Important): patch БЕЗ index — mute/read/метаданные, которые
  // порядок не двигают (реальный сценарий Task 3/4 — воркерный владелец шлёт
  // именно такой patch). Позиция обязана остаться прежней: сама по себе fields-
  // правка не имеет права переиндексировать диалог. Ловит регрессию вида
  // `op.index ?? 0` — валидный TS, тайпчек не поймает, но обнулил бы позицию.
  //
  // ТРИ диалога, а не два: у peerId 1 и peerId 3 индекс 10 и 5 соответственно —
  // оба МЕНЬШЕ индекса peerId 2 (20). Если бы patch без index обнулял индекс
  // (0 < 5), diaлог 1 обогнал бы... нет — упал бы НИЖЕ peerId 3 (0 < 5), меняя
  // порядок с [2,1,3] на [2,3,1]. С двумя диалогами (10 vs 20) обнуление 10→0
  // не поменяло бы относительный порядок — регрессия была бы не видна.
  it('patch без index меняет поля, но НЕ трогает позицию диалога', () => {
    const st = useChatsStore.getState()
    st.applyDialogOps([{ op: 'reset', items: [
      { dialog: dialog(1), index: 10 }, { dialog: dialog(2), index: 20 }, { dialog: dialog(3), index: 5 },
    ] }])

    st.applyDialogOps([{ op: 'patch', peerId: 1, fields: { notify_settings: MUTED } }])

    const s = useChatsStore.getState()
    expect(s.dialogs.find((d) => d.peerId === 1)?.notify_settings).toEqual(MUTED)
    // index у peerId 1 остался 10 (между 20 и 5) — порядок не изменился.
    expect(s.dialogs.map((d) => d.peerId)).toEqual([2, 1, 3])
  })

  // Fix (ревью Task 3, Important): владелец публиковал `patch` безусловно —
  // повторный ИДЕНТИЧНЫЙ кадр (бэкенд шлёт эхо на ВСЕ соединения пользователя,
  // включая инициировавшее) пересоздавал и массив `dialogs`, и объект диалога в
  // зеркале при нулевом изменении данных (лишний ре-рендер мемоизированного
  // ChatListItem). Проверяем СКВОЗНОЙ путь владелец→зеркало.
  it('повторный идентичный кадр не пересоздаёт ни массив dialogs, ни объект диалога', async () => {
    const { mgr } = stand([dialog(1, '2026-08-01T00:00:00Z')])
    await mgr.fillMirror()

    mgr.applyNotifySettings(1, MUTED)
    const dialogsBefore = useChatsStore.getState().dialogs
    const dialogBefore = dialogsBefore.find((d) => d.peerId === 1)

    mgr.applyNotifySettings(1, MUTED) // то же самое повторно

    const s = useChatsStore.getState()
    expect(s.dialogs).toBe(dialogsBefore) // массив НЕ пересоздан
    expect(s.dialogs.find((d) => d.peerId === 1)).toBe(dialogBefore) // диалог сохранил ССЫЛКУ
  })

  // remove: диалог выпадает из зеркала.
  it('remove убирает диалог из зеркала', () => {
    const st = useChatsStore.getState()
    st.applyDialogOps([{ op: 'reset', items: [
      { dialog: dialog(1), index: 10 }, { dialog: dialog(2), index: 20 },
    ] }])

    st.applyDialogOps([{ op: 'remove', peerId: 2 }])

    expect(useChatsStore.getState().dialogs.map((d) => d.peerId)).toEqual([1])
  })
})

// Тема оформления — ИСКЛЮЧЕНИЕ из «диалогами владеет воркер» и оно от решения
// Р7: её место в схеме не строка `dialog`, а полная карточка
// (`chatFull`/`userFull.theme_emoticon`). Владельца-в-воркере у карточек нет,
// поэтому кадр `chat_theme_update` применяет ЗДЕСЬ проектор — поверх
// единственного зеркала карточек. Мутация «убрать строку [RT.chatThemeUpdate]
// из APPLY» красит этот кейс: тема открытого чата перестала бы меняться вовсе.
describe('storeProjection — тема чата живёт в карточке, а не в строке диалога', () => {
  it('chat_theme_update патчит зеркало полных карточек', () => {
    resetChatFullMirror()
    saveChatFull(-9, { _: 'channelFull', id: 9, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null })

    rootScope.dispatchEventSingle(RT.chatThemeUpdate, { peer_id: -9, theme_id: 'sunset' })

    expect(cachedPeerTheme(-9)).toBe('sunset')
  })
})
