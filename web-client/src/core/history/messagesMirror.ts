// src/core/history/messagesMirror.ts
//
// НЕреактивное зеркало окон сообщений на главном потоке — порт модели tweb
// `apiManagerProxy.mirrors` (обычные структуры, читаются СИНХРОННО на рендере:
// `getMessageByPeer`, tweb lib/apiManagerProxy.ts:1108) + объявление изменений
// типизированными событиями `rootScope` (`history_append`/`history_update`/
// `message_edit`/`history_delete`, tweb lib/rootScope.ts:77-88).
//
// Зачем оно рядом с `stores/messagesStore`: zustand-копия окна существует ради
// React (подписка на срез → перерисовка). Императивной ленте (порт
// `chat/bubbles.ts`, этап 2) нужно другое — синхронное чтение окна и точечное
// «изменилось вот это». Обе копии кормит ОДИН поток операций
// (`core/realtime/messageOps.ts`) из ОДНОЙ точки — `client/realtime/
// storeProjection.ts` — и переигрывает их ТА ЖЕ чистая `applyOp`: второй
// независимый вывод того же факта развёл бы копии (см. «Владение фактами» в
// web-client/CLAUDE.md).
//
// Чего здесь нет и почему:
// * `history_multiappend`/`history_reload`/`history_reply_markup` из каталога
//   tweb — у нас нет источника (наш поток операций per-окно, а multiappend в
//   tweb per-сообщение);
// * применения кадров мимо операций — их больше нет вовсе: правка, координаты
//   гео-трансляции, реакции (включая платную ⭐), свой голос/отметка,
//   «проверка фактов» и просмотры поста канала едут той же операцией, что и
//   всё остальное (таблица в web-client/CLAUDE.md).
import type { MyMessage } from '../models'
import { applyOp, dedupAsc, type MessageOp } from '../realtime/messageOps'
import rootScope from '@lib/rootScope'

/** Ключ окна: основное окно чата ("50") или его тред — форум-топик /
 *  комментарии ("50:60"). Аналог tweb `chat.messagesStorageKey`, которым
 *  подписки `bubbles.ts` отсеивают события чужого окна.
 *
 *  Живёт здесь, а не в `stores/messagesStore`: ключ — свойство САМОГО окна, а не
 *  его zustand-копии, и потребитель у него теперь не один (императивная лента
 *  зеркала и React-лента стора). `stores/messagesStore` реэкспортирует его
 *  отсюда — лента не имеет права зависеть от стора (см. этап 7). */
export const winKey = (peerId: number, threadRootId?: number | null): string =>
  threadRootId ? `${peerId}:${threadRootId}` : String(peerId)

// key (winKey: "peerId" | "peerId:threadRoot") → сообщения окна, по возрастанию номера
// — тот же порядок и та же дедупликация, что у окна в сторе.
const windows = new Map<string, MyMessage[]>()

// Окно, которого ещё нет: применяем операцию поверх пустого списка. Для
// replace/remove/patch `applyOp` вернёт ЭТУ ЖЕ ссылку (нечего править) — окно не
// заведётся; заводит его только `insert`, то есть ровно то, что в окне реально
// появилось. Так зеркало ведёт себя как `apiManagerProxy.mirrors` в tweb: оно
// зеркалит всё, что объявил владелец, а не только открытый чат (bubbles.ts
// отсеивает чужое сам — сверкой `storageKey`/`peerId`). У zustand-копии гейт
// другой (окно должно быть открыто React'ом) — единственное структурное
// расхождение копий, см. storeProjection.mirror.test.ts.
const EMPTY: MyMessage[] = []

/** Синхронное чтение окна (аналог `historyStorage.history` в tweb).
 *  undefined — про это окно зеркало ещё ничего не знает. */
export function mirrorWindow(key: string): readonly MyMessage[] | undefined {
  return windows.get(key)
}

// Синхронного чтения ОДНОГО сообщения (аналог tweb `getMessageByPeer`) здесь
// больше нет: `mirrorMessage(peerId, msgId)` не звал никто, кроме собственного
// теста, — инвентарь разбора нашёл его в списке «с нулём читателей». Заведётся
// обратно вместе с потребителем, а не «на будущее».

/** Положить в окно страницу истории — единственный вход, которым в зеркало
 *  попадает НЕ операция воркера, а результат `messages.getHistory`.
 *
 *  Так же устроен tweb: `historyStorage` наполняет тот, кто грузит историю
 *  (`appMessagesManager.getHistory` → `mergeHistoryResult`), а лента
 *  (`bubbles.ts::performHistoryResult`) уже читает загруженное. Событий здесь
 *  НЕТ намеренно: `history_append` в tweb объявляет появление НОВОГО сообщения,
 *  а не доезд страницы — страницу рисует сам загрузивший, синхронно после
 *  этого вызова.
 *
 *  Слияние (а не подмена окна) идёт через тот же `dedupAsc`, что и операции:
 *  ключ неотправленного бабла — `c:${random_id}`, серверного — `s:${id}`
 *  (`core/realtime/messageOps.ts::dedupKey`), поэтому страница не может
 *  вытеснить из окна бабл «отправляется…», который воркер уже объявил
 *  операцией, а пришедшая позже страница выигрывает у своей же более старой
 *  копии того же сообщения. */
export function putMirrorPage(key: string, msgs: readonly MyMessage[]): void {
  const prev = windows.get(key) ?? EMPTY
  windows.set(key, dedupAsc([...prev, ...msgs]))
}

/** Кадр rt:logging_out: окна прошлой сессии обязаны исчезнуть — зеркало отдаёт
 *  сообщения синхронно на рендере, и без сброса лента следующего аккаунта
 *  прочитала бы чужую историю (та же причина, что у
 *  `core/mediaCache.ts::resetMediaUrlMirror`). */
export function resetMessagesMirror(): void {
  windows.clear()
}

// Чат окна: и у основного ключа ("50"), и у ключа треда ("50:60") это первый
// сегмент — тот самый peerId, которым tweb адресует history_delete/message_edit.
const peerIdOf = (key: string): number => Number(key.split(':')[0])

// Применить операции воркера к зеркалу и объявить изменения событиями.
//
// Отображение операций на каталог tweb (имена и формы 1:1, tweb
// rootScope.ts:77-88):
//   insert нового сообщения                → 'history_append'
//   insert, слившийся с оптимистичным      → 'history_update' + tempId
//     баблом — порт finalizePendingMessage → checkPendingMessage
//     (tweb appMessagesManager.ts:8722-8737: там tempId тоже несёт id
//     временного). В tweb 'history_update' значит ровно это и только это —
//     «у сообщения сменился идентификатор, переставь бабл»
//     (bubbles.ts:765-830 репозиционирует бабл, содержимое не трогает).
//   replace / patch                        → 'message_edit'
//     Изменение СОДЕРЖИМОГО уже существующего сообщения tweb объявляет именно
//     этим событием (appMessagesManager.ts:7921/8577/8977, подписчик —
//     bubbles.ts:1104 → onMessageEdit перерисовывает бабл). Отправить сюда
//     'history_update' было бы отступлением от оригинала с конкретной ценой:
//     обработчик history_update в bubbles.ts на message.mid === item.mid
//     логирует «wow what» и выходит, то есть правка молча не доехала бы.
//   remove                                 → 'history_delete'
//
// События собираются в callbacks и отправляются ПОСЛЕ применения всей пачки
// (порт приёма tweb `callbacks.push(...)`, appMessagesManager.ts:2791):
// подписчик, читающий зеркало синхронно, обязан видеть пачку применённой
// целиком, а не наполовину.
//
// Отправляем `dispatchEventSingle`: событие выведено НА ВКЛАДКЕ из уже
// принятого кадра, обычный `dispatchEvent` уехал бы в воркер и закольцевался
// (инвариант rootScope, см. web-client/CLAUDE.md).
export function applyOpsToMirror(ops: MessageOp[]): void {
  const callbacks: (() => void)[] = []
  for (const op of ops) {
    const prev = windows.get(op.key) ?? EMPTY
    const next = applyOp(prev, op)
    // Операция ничего не изменила (ack-then-echo дубль, remove/patch по
    // отсутствующему id, идемпотентный реплей) — applyOp вернул ту же ссылку,
    // объявлять нечего.
    if (next === prev) continue
    windows.set(op.key, next)

    const peerId = peerIdOf(op.key)
    if (op.op === 'remove') {
      callbacks.push(() => rootScope.dispatchEventSingle('history_delete', { peerId, msgs: new Set([op.msgId]) }))
      continue
    }

    const mid = op.op === 'patch' ? op.msgId : op.msg.id
    // Сообщение объявляем таким, каким оно легло в зеркало (после слияния с
    // оптимистикой / патча), а не сырым op.msg — лента рисует то, что лежит.
    const message = next.find((m) => m.id === mid)
    if (!message) continue
    if (op.op !== 'insert') {
      callbacks.push(() => rootScope.dispatchEventSingle('message_edit', { storageKey: op.key, peerId, mid, message }))
      continue
    }
    // Слияние с оптимистичным баблом: в окне БЫЛ временный с тем же random_id
    // (его id — tempId события, как в tweb pendingData.tempId).
    const optimistic = op.msg.random_id ? prev.find((m) => m.random_id === op.msg.random_id) : undefined
    // `sequential` едет от отправителя как есть: его посчитал владелец бабла
    // (`managers/messages/pending.ts`), зеркало его не выводит — ровно как в
    // tweb, где `checkPendingMessage` кладёт в событие `pendingData.sequential`.
    if (optimistic) callbacks.push(() => rootScope.dispatchEventSingle('history_update', { storageKey: op.key, message, tempId: optimistic.id, sequential: op.sequential }))
    else callbacks.push(() => rootScope.dispatchEventSingle('history_append', { storageKey: op.key, message }))
  }
  for (const fire of callbacks) fire()
}
