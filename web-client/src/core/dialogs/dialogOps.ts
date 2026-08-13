// Контракт канала rt:dialog_op — порт модели tweb, где витрина получает СОБЫТИЕ СО
// ЗНАЧЕНИЕМ (`dialogs_multiupdate: Map<PeerId, {dialog}>`, rootScope.ts:74), а не
// «пойди перечитай». Индекс едет внутри значения — как `{id, index, value}` у
// SortedDialogList (sortedDialogList.ts:132-139): зеркало сортирует по готовому
// индексу и своего порядка не выводит.
import type { Dialog } from '../models'

export type DialogItem = { dialog: Dialog; index: number }

export type DialogOp =
  /** первичная загрузка, ответ на объявленный пробел, resync */
  | { op: 'reset'; items: DialogItem[] }
  /**
   * Новый или заменённый диалог. ЗАЯВКА НА ЭТАП 2 (пагинация виртуального
   * списка, docs/superpowers/specs/2026-08-12-dialogs-ownership-and-virtual-
   * list-design.md): владелец её пока не производит — дозагруженная страница
   * диалогов приедет именно этой операцией, чтобы не гонять `reset` всего
   * списка. Не мёртвый код: зеркало (`chatsStore.applyDialogOps`) её уже умеет.
   */
  | { op: 'upsert'; items: DialogItem[] }
  /** точечное изменение полей; index — если оно сдвинуло диалог */
  | { op: 'patch'; chatId: number; fields: Partial<Dialog>; index?: number }
  /** сменился pinnedOrders/черновик — значения те же, порядок другой */
  | { op: 'reindex'; items: { chatId: number; index: number }[] }
  | { op: 'remove'; chatId: number }
