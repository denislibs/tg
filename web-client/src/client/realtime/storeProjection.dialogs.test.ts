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
import { RT } from '../../core/realtime/events'
import { useChatsStore } from '../../stores/chatsStore'
import { newDialogsManager } from '../../core/managers/dialogsManager'
import type { Dialog } from '../../core/models'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

const dialog = (chatId: number, at = '2026-08-01T00:00:00Z'): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false,
  lastMessage: { seq: 1, text: 'x', senderId: 1, at },
} as Dialog)

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

    expect(useChatsStore.getState().dialogs.map((d) => d.chatId))
      .toEqual(mgr.getSnapshot().map((i) => i.dialog.chatId))
  })

  it('reindex меняет порядок, не трогая значения', () => {
    const st = useChatsStore.getState()
    st.applyDialogOps([{ op: 'reset', items: [
      { dialog: dialog(1), index: 10 }, { dialog: dialog(2), index: 20 },
    ] }])
    st.applyDialogOps([{ op: 'reindex', items: [{ chatId: 1, index: 30 }] }])

    expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([1, 2])
  })

  // upsert: новый диалог появляется, существующий обновляется полями операции.
  it('upsert добавляет новый диалог и обновляет существующий', () => {
    const st = useChatsStore.getState()
    st.applyDialogOps([{ op: 'reset', items: [{ dialog: dialog(1), index: 10 }] }])

    st.applyDialogOps([{ op: 'upsert', items: [
      { dialog: { ...dialog(1), title: 'обновлён' }, index: 10 },
      { dialog: dialog(2), index: 20 },
    ] }])

    const s = useChatsStore.getState()
    expect(s.dialogs.map((d) => d.chatId)).toEqual([2, 1])
    expect(s.dialogs.find((d) => d.chatId === 1)?.title).toBe('обновлён')
  })

  // patch: точечное изменение полей без замены объекта целиком; index двигает строку.
  it('patch меняет поля и (если пришёл index) двигает строку', () => {
    const st = useChatsStore.getState()
    st.applyDialogOps([{ op: 'reset', items: [
      { dialog: dialog(1), index: 10 }, { dialog: dialog(2), index: 20 },
    ] }])

    st.applyDialogOps([{ op: 'patch', chatId: 1, fields: { muted: true }, index: 30 }])

    const s = useChatsStore.getState()
    expect(s.dialogs.find((d) => d.chatId === 1)?.muted).toBe(true)
    expect(s.dialogs.map((d) => d.chatId)).toEqual([1, 2]) // index 30 > 20 — 1 теперь выше
  })

  // Ревью Task 2 (Important): patch БЕЗ index — mute/read/метаданные, которые
  // порядок не двигают (реальный сценарий Task 3/4 — воркерный владелец шлёт
  // именно такой patch). Позиция обязана остаться прежней: сама по себе fields-
  // правка не имеет права переиндексировать диалог. Ловит регрессию вида
  // `op.index ?? 0` — валидный TS, тайпчек не поймает, но обнулил бы позицию.
  //
  // ТРИ диалога, а не два: у chatId 1 и chatId 3 индекс 10 и 5 соответственно —
  // оба МЕНЬШЕ индекса chatId 2 (20). Если бы patch без index обнулял индекс
  // (0 < 5), diaлог 1 обогнал бы... нет — упал бы НИЖЕ chatId 3 (0 < 5), меняя
  // порядок с [2,1,3] на [2,3,1]. С двумя диалогами (10 vs 20) обнуление 10→0
  // не поменяло бы относительный порядок — регрессия была бы не видна.
  it('patch без index меняет поля, но НЕ трогает позицию диалога', () => {
    const st = useChatsStore.getState()
    st.applyDialogOps([{ op: 'reset', items: [
      { dialog: dialog(1), index: 10 }, { dialog: dialog(2), index: 20 }, { dialog: dialog(3), index: 5 },
    ] }])

    st.applyDialogOps([{ op: 'patch', chatId: 1, fields: { muted: true } }])

    const s = useChatsStore.getState()
    expect(s.dialogs.find((d) => d.chatId === 1)?.muted).toBe(true)
    // index у chatId 1 остался 10 (между 20 и 5) — порядок не изменился.
    expect(s.dialogs.map((d) => d.chatId)).toEqual([2, 1, 3])
  })

  // remove: диалог выпадает из зеркала.
  it('remove убирает диалог из зеркала', () => {
    const st = useChatsStore.getState()
    st.applyDialogOps([{ op: 'reset', items: [
      { dialog: dialog(1), index: 10 }, { dialog: dialog(2), index: 20 },
    ] }])

    st.applyDialogOps([{ op: 'remove', chatId: 2 }])

    expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([1])
  })
})
