// src/core/realtime/messageOps.ts
//
// Каталог операций над окном сообщений — порт mirror-протокола tweb
// (historyStorage зеркалится вызовами методов SlicedArray). Воркер после
// применения кадра к своему SSOT рассылает не сырой кадр, а операцию (что
// изменилось в окне), а проектор её переигрывает поверх стора. MessageOp
// порождает ТОЛЬКО воркер (единственный интерпретатор кадра), переигрывает —
// только проектор. Исключение: обработчик RT.newMessage на главном потоке может
// порождать `replace` для резолва превью ответа (storeProjection.ts:107-123).
import type { Message } from '../models'

export type MessageOp =
  | { op: 'insert'; key: string; msg: Message }
  | { op: 'replace'; key: string; msg: Message }
  | { op: 'remove'; key: string; msgId: number }
  | { op: 'patch'; key: string; msgId: number; fields: Partial<Message> }

// Ключ дедупа: оптимистичный бабл (временный id < 0, ещё не сверен с сервером)
// ключуется по clientId — его seq лишь выдумка клиента (appendOptimistic:
// maxSeq + 1) для порядка внизу окна, не настоящая позиция в истории чата.
// Серверные сообщения (включая уже сверенные баблы — reconcileAck переставляет
// id на положительный) по-прежнему ключуются по seq. Так пространства ключей не
// пересекаются: чужое входящее с тем же tentativeSeq, что и у бабла, не может
// вытеснить его из Map (несущий инвариант 1B.1 — до фикса dedupAsc ключевал всё
// по seq, и последний вставленный побеждал, молча стирая бабл без ack/error).
export function dedupKey(m: Message): string {
  return m.clientId && m.id < 0 ? `c:${m.clientId}` : `s:${m.seq}`
}

// Схлопывает список по dedupKey (последний вставленный побеждает) и сортирует
// по возрастанию seq.
export function dedupAsc(list: Message[]): Message[] {
  const byKey = new Map<string, Message>()
  for (const m of list) byKey.set(dedupKey(m), m)
  return Array.from(byKey.values()).sort((a, b) => a.seq - b.seq)
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
function insert(msgs: Message[], m: Message): Message[] {
  if (msgs.some((x) => x.id === m.id)) return msgs
  const optimistic = m.clientId ? msgs.find((x) => x.clientId === m.clientId) : undefined
  const merged = optimistic
    ? { ...m, clientId: optimistic.clientId, localUrl: optimistic.localUrl, secret: m.secret ?? optimistic.secret }
    : m
  const base = optimistic ? msgs.filter((x) => x !== optimistic) : msgs
  return dedupAsc([...base, merged])
}

// replace: точечная замена по id (правки/апдейты полей), позиция в списке
// (по seq) сохраняется — в отличие от insert, пересборка/дедуп тут не нужны.
function replace(msgs: Message[], m: Message): Message[] {
  if (!msgs.some((x) => x.id === m.id)) return msgs
  return msgs.map((x) => (x.id === m.id ? m : x))
}

// remove: удаление по id. Не найдено → та же ссылка на массив (важно для
// мемоизации — подписчик по ссылке не перерисовывается впустую).
function remove(msgs: Message[], msgId: number): Message[] {
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
function patch(msgs: Message[], msgId: number, fields: Partial<Message>): Message[] {
  const idx = msgs.findIndex((x) => x.id === msgId)
  if (idx === -1) return msgs
  const cur = msgs[idx]
  // Опрос/розыгрыш несут вложенный локальный выбор (poll.myVotes,
  // giveaway.participating/iWon), которого fields.poll/fields.giveaway
  // сознательно НЕ несёт (cachePoll/cacheGiveaway строят операцию из голого
  // агрегата — см. карту обогащений §3.1/3.2, docs/research/2026-08-10-message-
  // enrichments.md). Это единственный случай, где patch трогает ключ верхнего
  // уровня (poll/giveaway), внутри которого есть поле, требующее точечного
  // сохранения — обычный shallow-merge {...cur, ...fields} заменил бы объект
  // целиком и стёр бы локальный выбор ОКНА (в многовкладочном сценарии —
  // не факт что совпадающий с тем, что успел насчитать воркер). Подставляем
  // текущее значение окна, если оно уже есть; иначе (первая загрузка агрегата)
  // используем то, что пришло в операции.
  let f = fields
  if (f.poll) f = { ...f, poll: { ...f.poll, myVotes: cur.poll ? cur.poll.myVotes : f.poll.myVotes } }
  if (f.giveaway) {
    f = {
      ...f,
      giveaway: {
        ...f.giveaway,
        participating: cur.giveaway ? cur.giveaway.participating : f.giveaway.participating,
        iWon: cur.giveaway ? cur.giveaway.iWon : f.giveaway.iWon,
      },
    }
  }
  const keys = Object.keys(f) as (keyof Message)[]
  if (keys.every((k) => Object.is(cur[k], f[k]))) return msgs
  const next = msgs.slice()
  next[idx] = { ...cur, ...f }
  return next
}

/** Применить операцию к списку сообщений окна. Чистая функция — вся семантика
 *  дедупа/слияния живёт здесь, поэтому её можно тестировать без стора. */
export function applyOp(msgs: Message[], op: MessageOp): Message[] {
  switch (op.op) {
    case 'insert': return insert(msgs, op.msg)
    case 'replace': return replace(msgs, op.msg)
    case 'remove': return remove(msgs, op.msgId)
    case 'patch': return patch(msgs, op.msgId, op.fields)
  }
}
