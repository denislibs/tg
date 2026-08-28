// src/core/realtime/messageOps.ts
//
// Каталог операций над окном сообщений — порт mirror-протокола tweb
// (historyStorage зеркалится вызовами методов SlicedArray). Воркер после
// применения кадра к своему SSOT рассылает не сырой кадр, а операцию (что
// изменилось в окне), а проектор её переигрывает поверх стора. MessageOp
// порождает ТОЛЬКО воркер (единственный интерпретатор кадра), переигрывает —
// только проектор. Исключение: обработчик RT.newMessage на главном потоке может
// порождать `replace` для резолва превью ответа (storeProjection.ts:107-123).
import type { MessageFields, MyMessage } from '../models'
import type { MessageMedia, MessageMediaPoll } from '../media/messageMedia'
import { isLocalMessageId } from '../history/messageId'

export type MessageOp =
  // `sequential` — порт поля tweb `PendingMessageDetails.sequential`, которое
  // `checkPendingMessage` кладёт в событие `history_update`
  // (appMessagesManager.ts:8730-8737). Ставится ТОЛЬКО на `insert`, которым
  // владелец финализирует свой же неотправленный бабл (`finalizePendingMessage`
  // в `managers/messages/pending.ts`) — обычная вставка чужого сообщения его не
  // несёт. Здесь это транспорт: канал «воркер → вкладка» у нас один, операции,
  // и признак отправителя доезжает до ленты только ими. Смысл — в докблоке
  // `PendingNewEvt.sequential` (`core/realtime/events.ts`), потребитель —
  // подписка `history_update` в `components/chat/bubbles.ts`.
  | { op: 'insert'; key: string; msg: MyMessage; sequential?: boolean }
  | { op: 'replace'; key: string; msg: MyMessage }
  | { op: 'remove'; key: string; msgId: number }
  | { op: 'patch'; key: string; msgId: number; fields: MessageFields }

// Ключ дедупа: оптимистичный бабл (номер назначен КЛИЕНТОМ — дробный, см.
// core/history/messageId.ts) ключуется по random_id, потому что его номер лишь
// выдумка владельца для порядка внизу окна, а не позиция в истории чата.
// Серверные сообщения (включая уже сверенные баблы — ack ставит настоящий
// номер) ключуются по номеру. Так пространства ключей не пересекаются: чужое
// входящее с соседним номером не может вытеснить бабл из Map (несущий инвариант
// 1B.1 — до фикса dedupAsc ключевал всё одинаково, и последний вставленный
// побеждал, молча стирая бабл без ack/error).
export function dedupKey(m: MyMessage): string {
  return m.random_id && isLocalMessageId(m.id) ? `c:${m.random_id}` : `s:${m.id}`
}

// Схлопывает список по dedupKey (последний вставленный побеждает) и сортирует
// по возрастанию номера.
export function dedupAsc(list: MyMessage[]): MyMessage[] {
  const byKey = new Map<string, MyMessage>()
  for (const m of list) byKey.set(dedupKey(m), m)
  return Array.from(byKey.values()).sort((a, b) => a.id - b.id)
}

// insert: та же семантика, что applyIncoming в messagesStore.ts —
//   1) ack-then-echo: сообщение с таким id уже в окне (бабл уже сверен ack'ом
//      раньше) → эхо здесь дубль, no-op;
//   2) слияние с оптимистикой: эхо своей отправки несёт client_msg_id — матчим
//      неподтверждённый бабл ПО НЕМУ (не по подгаданному tentative seq).
//      Переносим clientId (стабильный React-ключ), localUrl (загруженное фото
//      не рефетчится) и secret (эхо несёт расшифрованный текст без флага);
//   3) иначе — обычная вставка. dedupAsc держит инвариант: чужое входящее с тем
//      же seq, что и tentativeSeq бабла, но без совпадения clientId, ключуется
//      по seq — отдельно от бабла (ключ по clientId) — оба остаются.
function insert(msgs: MyMessage[], m: MyMessage): MyMessage[] {
  if (msgs.some((x) => x.id === m.id)) return msgs
  const optimistic = m.random_id ? msgs.find((x) => x.random_id === m.random_id) : undefined
  const merged = optimistic
    ? {
        ...m,
        random_id: optimistic.random_id,
        secret: m.secret ?? optimistic.secret,
        // Локальное превью живёт только у обычного сообщения — у пилюли медиа
        // нет вовсе, поэтому и переносить нечего.
        ...(m._ === 'message' && optimistic._ === 'message' && optimistic.localUrl
          ? { localUrl: optimistic.localUrl }
          : {}),
      }
    : m
  const base = optimistic ? msgs.filter((x) => x !== optimistic) : msgs
  return dedupAsc([...base, merged as MyMessage])
}

// replace: точечная замена по id (правки/апдейты полей), позиция в списке
// (по seq) сохраняется — в отличие от insert, пересборка/дедуп тут не нужны.
function replace(msgs: MyMessage[], m: MyMessage): MyMessage[] {
  if (!msgs.some((x) => x.id === m.id)) return msgs
  return msgs.map((x) => (x.id === m.id ? m : x))
}

// remove: удаление по id. Не найдено → та же ссылка на массив (важно для
// мемоизации — подписчик по ссылке не перерисовывается впустую).
function remove(msgs: MyMessage[], msgId: number): MyMessage[] {
  if (!msgs.some((x) => x.id === msgId)) return msgs
  return msgs.filter((x) => x.id !== msgId)
}

// patch: точечное слияние перечисленных полей поверх существующего сообщения
// (Stage 1B.3) — в отличие от replace НЕ подменяет весь объект, поэтому не
// стирает обогащение витрины (localUrl/replyTo/clientId/деривированные mine
// и т.п.), которого нет в fields — воркерная SSOT-копия его либо не знает,
// либо хранит независимо (см. docs/research/2026-08-10-message-enrichments.md).
// Не найдено → та же ссылка на массив (как у remove — важно для мемоизации).
// Ничего не меняется (все значения fields совпадают с текущими) — тоже та же
// ссылка: согласовано с прецедентом applyReaction/patchViews в
// messagesStore.ts (сравнение перед записью), чтобы идемпотентный реплей
// (catch-up/дубль кадра) не дёргал лишний ре-рендер.
/** Патч ничего не меняет — операция no-op, ссылку списка не рвём (мемоизированные
 *  баблы иначе перерисовались бы на ровном месте). */
function sameFields(cur: MyMessage, fields: MessageFields): boolean {
  const seen = cur as unknown as Record<string, unknown>
  const next = fields as Record<string, unknown>
  return Object.keys(next).every((k) => Object.is(seen[k], next[k]))
}

/**
 * Слить итоги опроса, СОХРАНИВ выбор зрителя, — но только если приехавшие итоги
 * УРЕЗАНЫ.
 *
 * Кадр `poll_update` собирается сервером для «зрителя 0» (`publishPollUpdate`,
 * backend/internal/usecase/chat/poll.go), то есть без единого `pFlags.chosen` —
 * поставить его туда нельзя, тело кадра одно на всех получателей. В схеме ровно
 * этот случай выражает бит `pollResults.pFlags.min`, и оригинал решает по нему
 * (`appPollsManager.saveResults`: `if(!results.pFlags.min) { chosenIndexes = [] }`).
 *
 * Пока бэкенд флага не производил, «урезанность» подразумевалась здесь
 * БЕЗУСЛОВНО — и персонализированные итоги, начни сервер их слать, молча
 * игнорировались бы. Теперь флаг едет, и вопрос задаётся ему: итоги без `min`
 * авторитетны целиком, включая отсутствие выбора (отзыв голоса с другого
 * устройства обязан дойти).
 *
 * Розыгрышу такого слияния больше не нужно вовсе: участие уехало из вложения в
 * отдельную ручку, локального состояния во вложении не осталось.
 */
function mergePollChoice(cur: MessageMedia, incoming: MessageMediaPoll): MessageMediaPoll {
  if (cur._ !== 'messageMediaPoll') return incoming
  if (!incoming.results.pFlags?.min) return incoming
  const mine = new Set(
    (cur.results.results ?? []).filter((r) => r.pFlags?.chosen).map((r) => r.option),
  )
  if (!mine.size) return incoming
  return {
    ...incoming,
    results: {
      ...incoming.results,
      results: (incoming.results.results ?? []).map((r) =>
        mine.has(r.option) ? { ...r, pFlags: { ...r.pFlags, chosen: true as const } } : r),
    },
  }
}

function patch(msgs: MyMessage[], msgId: number, fields: MessageFields): MyMessage[] {
  const idx = msgs.findIndex((x) => x.id === msgId)
  if (idx === -1) return msgs
  const cur = msgs[idx]
  // Вложение живёт только у обычного сообщения — у пилюли поля `media` в схеме
  // нет вовсе, и сохранять локальный выбор не из чего.
  if (cur._ !== 'message') {
    const untouched = sameFields(cur, fields)
    if (untouched) return msgs
    const out = msgs.slice()
    out[idx] = { ...cur, ...fields } as MyMessage
    return out
  }
  // Единственный случай, где patch заглядывает ВНУТРЬ значения поля: у опроса
  // внутри `media` лежит пер-зрительский выбор, которого операция не несёт (см.
  // mergePollChoice). Обычный shallow-merge заменил бы вложение целиком и стёр
  // бы выбор ОКНА — в многовкладочном сценарии не факт что совпадающий с тем,
  // что успел насчитать воркер.
  let f: MessageFields = fields
  if (f.media?._ === 'messageMediaPoll' && cur.media) {
    f = { ...f, media: mergePollChoice(cur.media, f.media) }
  }
  if (sameFields(cur, f)) return msgs
  const next = msgs.slice()
  next[idx] = { ...cur, ...f }
  return next
}

/** Применить операцию к списку сообщений окна. Чистая функция — вся семантика
 *  дедупа/слияния живёт здесь, поэтому её можно тестировать без стора. */
export function applyOp(msgs: MyMessage[], op: MessageOp): MyMessage[] {
  switch (op.op) {
    case 'insert': return insert(msgs, op.msg)
    case 'replace': return replace(msgs, op.msg)
    case 'remove': return remove(msgs, op.msgId)
    case 'patch': return patch(msgs, op.msgId, op.fields)
  }
}
