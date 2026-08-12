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
  /** новый или заменённый диалог */
  | { op: 'upsert'; items: DialogItem[] }
  /** точечное изменение полей; index — если оно сдвинуло диалог */
  | { op: 'patch'; chatId: number; fields: Partial<Dialog>; index?: number }
  /** сменился pinnedOrders/черновик — значения те же, порядок другой */
  | { op: 'reindex'; items: { chatId: number; index: number }[] }
  | { op: 'remove'; chatId: number }
