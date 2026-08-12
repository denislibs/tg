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
