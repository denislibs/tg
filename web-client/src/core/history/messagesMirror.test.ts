// Зеркало окон сообщений на главном потоке (порт apiManagerProxy.mirrors):
// семантика применения операций, синхронные чтения, сброс на логауте и
// отображение операций на события каталога tweb (history_append/history_update/
// message_edit/history_delete, tweb rootScope.ts:77-88).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import rootScope, { type BroadcastEvents } from '@lib/rootScope'
import type { MessageReal, MyMessage } from '../models'
import { makeMessage } from '../messages/testMessage'
import type { MessageOp } from '../realtime/messageOps'
import { applyOpsToMirror, mirrorVersion, mirrorWindow, putMirrorPage, replaceMirrorWindow, resetMessagesMirror, subscribeMirror, winKey } from './messagesMirror'

const CHAT = 50
const THREAD = 60
const ME = 1
const OTHER = 2
// Второй чат — только для проверки, что замена не задевает чужие окна.
const OTHER_CHAT = 51

function msg(over: Partial<MessageReal> & { id: number }, threadRootId?: number): MessageReal {
  return { ...makeMessage({ id: over.id, peerId: CHAT, fromId: OTHER, text: `m${over.id}`, date: 1_750_000_000, threadRootId }), ...over }
}

/** Сузить до обычного сообщения: у пилюли ни текста, ни просмотров нет. */
const real = (m: MyMessage): MessageReal => m as MessageReal

// Собирает все четыре события истории в порядке отправки.
type HistoryEventName = 'history_append' | 'history_update' | 'message_edit' | 'history_delete'
  | 'messages_views' | 'replies_updated'
type Captured = { [K in HistoryEventName]: { name: K; payload: BroadcastEvents[K][0] } }[HistoryEventName]

const captured: Captured[] = []
const listeners = {
  history_append: (payload: BroadcastEvents['history_append'][0]) => { captured.push({ name: 'history_append', payload }) },
  history_update: (payload: BroadcastEvents['history_update'][0]) => { captured.push({ name: 'history_update', payload }) },
  message_edit: (payload: BroadcastEvents['message_edit'][0]) => { captured.push({ name: 'message_edit', payload }) },
  history_delete: (payload: BroadcastEvents['history_delete'][0]) => { captured.push({ name: 'history_delete', payload }) },
  messages_views: (payload: BroadcastEvents['messages_views'][0]) => { captured.push({ name: 'messages_views', payload }) },
  replies_updated: (payload: BroadcastEvents['replies_updated'][0]) => { captured.push({ name: 'replies_updated', payload }) },
}

beforeEach(() => {
  resetMessagesMirror()
  captured.length = 0
  rootScope.addEventListener('history_append', listeners.history_append)
  rootScope.addEventListener('history_update', listeners.history_update)
  rootScope.addEventListener('message_edit', listeners.message_edit)
  rootScope.addEventListener('history_delete', listeners.history_delete)
  rootScope.addEventListener('messages_views', listeners.messages_views)
  rootScope.addEventListener('replies_updated', listeners.replies_updated)
})

afterEach(() => {
  rootScope.removeEventListener('history_append', listeners.history_append)
  rootScope.removeEventListener('history_update', listeners.history_update)
  rootScope.removeEventListener('message_edit', listeners.message_edit)
  rootScope.removeEventListener('history_delete', listeners.history_delete)
  rootScope.removeEventListener('messages_views', listeners.messages_views)
  rootScope.removeEventListener('replies_updated', listeners.replies_updated)
})

const ids = (key: string) => (mirrorWindow(key) ?? []).map((m) => m.id)

// Точечные изменения приезжают в зеркало потоком операций; страницу истории
// кладёт тот, кто её грузит, — императивная лента через `putMirrorPage`
// (см. отдельный describe ниже).
const seed = (key: string, msgs: MyMessage[]) =>
  applyOpsToMirror(msgs.map((m): MessageOp => ({ op: 'insert', key, msg: m })))

describe('messagesMirror — содержимое окна', () => {
  it('insert заводит окно и кладёт сообщение', () => {
    applyOpsToMirror([{ op: 'insert', key: String(CHAT), msg: msg({ id: 7 }) }])
    expect(ids(String(CHAT))).toEqual([7])
  })

  it('окно держится по возрастанию seq независимо от порядка операций', () => {
    seed(String(CHAT), [msg({ id: 3 }), msg({ id: 1 }), msg({ id: 2 })])
    expect(ids(String(CHAT))).toEqual([1, 2, 3])
  })

  it('insert сливается с оптимистичным баблом по clientId (один элемент, localUrl сохранён)', () => {
    seed(String(CHAT), [msg({ id: -1, fromId: ME, random_id: 'c-1', localUrl: 'blob:local-1' })])
    applyOpsToMirror([{ op: 'insert', key: String(CHAT), msg: msg({ id: 700, fromId: ME, random_id: 'c-1' }) }])
    const list = mirrorWindow(String(CHAT))!
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(700)
    expect(real(list[0]).localUrl).toBe('blob:local-1')
  })

  it('replace подменяет сообщение по id, patch сливает перечисленные поля', () => {
    seed(String(CHAT), [msg({ id: 10, message: 'было' })])
    applyOpsToMirror([{ op: 'replace', key: String(CHAT), msg: msg({ id: 10, message: 'стало' }) }])
    expect(real(mirrorWindow(String(CHAT))![0]).message).toBe('стало')
    applyOpsToMirror([{ op: 'patch', key: String(CHAT), msgId: 10, fields: { views: 42 } }])
    expect(real(mirrorWindow(String(CHAT))![0]).message).toBe('стало')
    expect(real(mirrorWindow(String(CHAT))![0]).views).toBe(42)
  })

  it('remove убирает сообщение из окна', () => {
    seed(String(CHAT), [msg({ id: 10 }), msg({ id: 11 })])
    applyOpsToMirror([{ op: 'remove', key: String(CHAT), msgId: 10 }])
    expect(ids(String(CHAT))).toEqual([11])
  })

  // Окно заводит только реальное появление сообщения. replace/patch/remove по
  // окну, о котором зеркало ничего не знает, — no-op: применять их не к чему,
  // а заводить окно из ничего значило бы соврать читателю, что окно есть.
  it('replace/patch/remove в неизвестное окно окна не заводят', () => {
    applyOpsToMirror([
      { op: 'replace', key: String(CHAT), msg: msg({ id: 1 }) },
      { op: 'patch', key: String(CHAT), msgId: 1, fields: { views: 1 } },
      { op: 'remove', key: String(CHAT), msgId: 1 },
    ])
    expect(mirrorWindow(String(CHAT))).toBeUndefined()
  })

  it('операции адресуются окну треда отдельно от основного', () => {
    seed(String(CHAT), [msg({ id: 1 })])
    applyOpsToMirror([{ op: 'insert', key: `${CHAT}:${THREAD}`, msg: msg({ id: 800 }, THREAD) }])
    expect(ids(`${CHAT}:${THREAD}`)).toEqual([800])
    expect(ids(String(CHAT))).toEqual([1])
  })
})

describe('messagesMirror — сброс на логауте', () => {
  // Зеркало отдаёт сообщения синхронно на рендере: без сброса лента следующего
  // аккаунта прочитала бы историю прошлого (та же причина, что у
  // resetMediaUrlMirror в core/mediaCache.ts).
  it('resetMessagesMirror стирает все окна', () => {
    seed(String(CHAT), [msg({ id: 1 })])
    seed(`${CHAT}:${THREAD}`, [msg({ id: 2 }, THREAD)])

    resetMessagesMirror()

    expect(mirrorWindow(String(CHAT))).toBeUndefined()
    expect(mirrorWindow(`${CHAT}:${THREAD}`)).toBeUndefined()
  })

  it('после сброса правка стёртого сообщения его не воскрешает', () => {
    seed(String(CHAT), [msg({ id: 1 })])
    resetMessagesMirror()
    applyOpsToMirror([{ op: 'patch', key: String(CHAT), msgId: 1, fields: { views: 5 } }])
    expect(mirrorWindow(String(CHAT))).toBeUndefined()
  })
})

// Отображение операций на каталог событий tweb. Что ломается, если оно неверно:
// лента (порт bubbles.ts) читает эти события буквально — append рисует НОВЫЙ
// бабл и прижимает скролл, update переставляет бабл под сменившийся id,
// message_edit перерисовывает содержимое существующего, delete убирает узел.
// Перепутанное отображение = дубль бабла вместо обновления (или молчание вместо
// появления).
describe('messagesMirror — операции объявляются событиями tweb', () => {
  it('insert нового сообщения → history_append {storageKey, message}', () => {
    applyOpsToMirror([{ op: 'insert', key: String(CHAT), msg: msg({ id: 7 }) }])
    expect(captured).toHaveLength(1)
    expect(captured[0].name).toBe('history_append')
    const payload = captured[0].payload as BroadcastEvents['history_append'][0]
    expect(payload.storageKey).toBe(String(CHAT))
    expect(payload.message.id).toBe(7)
  })

  // Порт finalizePendingMessage → checkPendingMessage (tweb
  // appMessagesManager.ts:8722-8737): бабл не появляется второй раз, а
  // ПЕРЕСТАВЛЯЕТСЯ, и подписчик узнаёт, какой временный id заменён.
  it('insert, слившийся с оптимистичным баблом → history_update с tempId', () => {
    seed(String(CHAT), [msg({ id: -5, fromId: ME, random_id: 'c-1' })])
    captured.length = 0
    applyOpsToMirror([{ op: 'insert', key: String(CHAT), msg: msg({ id: 700, fromId: ME, random_id: 'c-1' }) }])
    expect(captured).toHaveLength(1)
    expect(captured[0].name).toBe('history_update')
    const payload = captured[0].payload as BroadcastEvents['history_update'][0]
    expect(payload.tempId).toBe(-5)
    expect(payload.message.id).toBe(700)
    expect(payload.storageKey).toBe(String(CHAT))
  })

  // Правка содержимого — 'message_edit' (tweb appMessagesManager.ts:8577,
  // подписчик bubbles.ts:1104). Через 'history_update' она бы не доехала:
  // обработчик history_update в bubbles.ts на неизменившемся mid выходит.
  it('replace → message_edit {storageKey, peerId, mid, message}', () => {
    seed(String(CHAT), [msg({ id: 10, message: 'было' })])
    captured.length = 0
    applyOpsToMirror([{ op: 'replace', key: String(CHAT), msg: msg({ id: 10, message: 'стало' }) }])
    expect(captured).toHaveLength(1)
    expect(captured[0].name).toBe('message_edit')
    const payload = captured[0].payload as BroadcastEvents['message_edit'][0]
    expect(payload.storageKey).toBe(String(CHAT))
    expect(payload.peerId).toBe(CHAT)
    expect(payload.mid).toBe(10)
    expect(real(payload.message).message).toBe('стало')
  })

  it('patch → message_edit, message несёт слитые поля', () => {
    seed(String(CHAT), [msg({ id: 10, message: 'текст' })])
    captured.length = 0
    applyOpsToMirror([{ op: 'patch', key: String(CHAT), msgId: 10, fields: { failed: true } }])
    expect(captured).toHaveLength(1)
    expect(captured[0].name).toBe('message_edit')
    const payload = captured[0].payload as BroadcastEvents['message_edit'][0]
    expect(payload.mid).toBe(10)
    expect(payload.message.failed).toBe(true)
    expect(real(payload.message).message).toBe('текст')
  })

  it('remove → history_delete {peerId, msgs}', () => {
    seed(String(CHAT), [msg({ id: 10 })])
    captured.length = 0
    applyOpsToMirror([{ op: 'remove', key: String(CHAT), msgId: 10 }])
    expect(captured).toHaveLength(1)
    expect(captured[0].name).toBe('history_delete')
    const payload = captured[0].payload as BroadcastEvents['history_delete'][0]
    expect(payload.peerId).toBe(CHAT)
    expect([...payload.msgs]).toEqual([10])
  })

  // peerId у события — чат, а не ключ окна: у треда ключ "50:60", а удалять/
  // править бабл надо в чате 50 (в tweb peerId и storageKey тоже раздельны).
  it('у окна треда peerId события — чат, storageKey — ключ окна', () => {
    seed(`${CHAT}:${THREAD}`, [msg({ id: 800 }, THREAD)])
    captured.length = 0
    applyOpsToMirror([
      { op: 'patch', key: `${CHAT}:${THREAD}`, msgId: 800, fields: { message: 'правка' } },
      { op: 'remove', key: `${CHAT}:${THREAD}`, msgId: 800 },
    ])
    expect(captured.map((c) => c.name)).toEqual(['message_edit', 'history_delete'])
    expect((captured[0].payload as BroadcastEvents['message_edit'][0]).storageKey).toBe(`${CHAT}:${THREAD}`)
    expect((captured[0].payload as BroadcastEvents['message_edit'][0]).peerId).toBe(CHAT)
    expect((captured[1].payload as BroadcastEvents['history_delete'][0]).peerId).toBe(CHAT)
  })

  // Счётчики поста канала объявляются СВОИМИ событиями (tweb rootScope.ts:92 и
  // :112), а не общей правкой: их потребитель переписывает один узел уже
  // отрисованного бабла, тогда как `message_edit` пересобирает содержимое
  // целиком (докблок `onMessageEdit` в chat/bubbles.ts) — пост, который
  // смотрят, перебирал бы своё вложение раз в секунду.
  it('патч ОДНИМИ просмотрами — messages_views ПАЧКОЙ, а не message_edit', () => {
    seed(String(CHAT), [msg({ id: 10 }), msg({ id: 11 })])
    captured.length = 0
    applyOpsToMirror([
      { op: 'patch', key: String(CHAT), msgId: 10, fields: { views: 9200 } },
      { op: 'patch', key: String(CHAT), msgId: 11, fields: { views: 7 } },
    ])
    // Одно событие на всю пачку — порт pushBatchUpdate (appMessagesManager.ts:8457).
    expect(captured.map((c) => c.name)).toEqual(['messages_views'])
    expect(captured[0].payload as BroadcastEvents['messages_views'][0]).toEqual([
      { peerId: CHAT, mid: 10, views: 9200 },
      { peerId: CHAT, mid: 11, views: 7 },
    ])
    expect(real(mirrorWindow(String(CHAT))![0]).views).toBe(9200)
  })

  it('патч ОДНИМ тредом — replies_updated с самим сообщением', () => {
    const replies = { _: 'messageReplies' as const, pFlags: { comments: true as const }, replies: 0, channel_id: 77 }
    seed(String(CHAT), [msg({ id: 10, replies })])
    captured.length = 0
    applyOpsToMirror([
      { op: 'patch', key: String(CHAT), msgId: 10, fields: { replies: { ...replies, replies: 3 } } },
    ])
    expect(captured.map((c) => c.name)).toEqual(['replies_updated'])
    const payload = captured[0].payload as BroadcastEvents['replies_updated'][0]
    expect(payload.storageKey).toBe(String(CHAT))
    expect(payload.peerId).toBe(CHAT)
    expect(payload.mid).toBe(10)
    expect(real(payload.message).replies!.replies).toBe(3)
  })

  // Правка сообщения объявляет ВСЕ его параметры разом (`messageFields`), и
  // просмотры среди них — она обязана остаться `message_edit`, иначе лента
  // перерисовала бы одно число вместо всего изменившегося бабла.
  it('правка, среди параметров которой есть просмотры, остаётся message_edit', () => {
    seed(String(CHAT), [msg({ id: 10 })])
    captured.length = 0
    applyOpsToMirror([
      { op: 'patch', key: String(CHAT), msgId: 10, fields: { views: 5, message: 'правка' } },
    ])
    expect(captured.map((c) => c.name)).toEqual(['message_edit'])
  })

  // Операция, ничего не изменившая (ack-then-echo дубль, remove по чужому id,
  // идемпотентный реплей кадра) — не событие: лента перерисовала бы бабл впустую.
  it('операция без изменений события не объявляет', () => {
    seed(String(CHAT), [msg({ id: 10 })])
    captured.length = 0
    applyOpsToMirror([
      { op: 'insert', key: String(CHAT), msg: msg({ id: 10 }) },
      { op: 'remove', key: String(CHAT), msgId: 999 },
      { op: 'patch', key: String(CHAT), msgId: 999, fields: { failed: true } },
      { op: 'patch', key: String(CHAT), msgId: 10, fields: { message: 'm10' } },
    ])
    expect(captured).toEqual([])
  })

  // Пачка применяется целиком ДО отправки событий (порт callbacks.push в
  // appMessagesManager.ts:2791): подписчик читает зеркало синхронно и обязан
  // видеть окно уже в конечном состоянии, а не в середине пачки.
  it('события пачки уходят после применения ВСЕХ операций', () => {
    const seen: number[][] = []
    const spy = () => { seen.push(ids(String(CHAT))) }
    rootScope.addEventListener('history_append', spy)
    const ops: MessageOp[] = [
      { op: 'insert', key: String(CHAT), msg: msg({ id: 1 }) },
      { op: 'insert', key: String(CHAT), msg: msg({ id: 2 }) },
    ]
    applyOpsToMirror(ops)
    rootScope.removeEventListener('history_append', spy)
    expect(seen).toEqual([[1, 2], [1, 2]])
  })
})

// Ключ окна переехал сюда из `stores/messagesStore` (этап 2): он принадлежит
// САМОМУ окну, а не его zustand-копии. Копии больше нет — стор снесён вместе с
// React-лентой (этап 7), поэтому пина «реэкспорт — ТА ЖЕ функция» здесь тоже
// больше нет: сверять не с чем.
describe('winKey — ключ окна живёт в зеркале', () => {
  it('основное окно чата и окно треда', () => {
    expect(winKey(CHAT)).toBe('50')
    expect(winKey(CHAT, THREAD)).toBe('50:60')
    // null/undefined треда — основное окно, а не "50:null".
    expect(winKey(CHAT, null)).toBe('50')
    expect(winKey(CHAT, undefined)).toBe('50')
  })
})

// Страница истории — единственный вход в зеркало, идущий НЕ от операции воркера
// (порт tweb: `historyStorage` наполняет тот, кто грузит историю, а
// `bubbles.ts::performHistoryResult` читает загруженное).
describe('putMirrorPage — страница истории', () => {
  it('заводит окно, которого ещё не было', () => {
    putMirrorPage(winKey(CHAT), [msg({ id: 1 }), msg({ id: 2 })])
    expect(ids(winKey(CHAT))).toEqual([1, 2])
  })

  it('не объявляет событий: страницу рисует сам загрузивший, синхронно после вызова', () => {
    putMirrorPage(winKey(CHAT), [msg({ id: 1 })])
    expect(captured).toEqual([])
  })

  it('сливается с окном по возрастанию seq, а не подменяет его', () => {
    seed(winKey(CHAT), [msg({ id: 5 })])
    captured.length = 0
    putMirrorPage(winKey(CHAT), [msg({ id: 3 }), msg({ id: 4 })])
    expect(ids(winKey(CHAT))).toEqual([3, 4, 5])
  })

  it('НЕ вытесняет бабл «отправляется…»: у него ключ дедупа c:${clientId}', () => {
    // Ровно тот дефект, ради которого слияние идёт через dedupAsc: у
    // неотправленного бабла seq — выдумка владельца (maxSeq + 1), и страница с
    // настоящим сообщением того же seq не должна стирать бабл с экрана.
    seed(winKey(CHAT), [msg({ id: -1, fromId: ME, random_id: 'c-1' })])
    captured.length = 0
    putMirrorPage(winKey(CHAT), [msg({ id: 700 })])
    // Оба живы. Порядок при равном seq — стабильный (`[...prev, ...page]`), то
    // есть уже стоящий бабл остаётся на месте, а страница дописывается за ним.
    expect(ids(winKey(CHAT))).toEqual([-1, 700])
  })

  it('своя более свежая копия того же сообщения выигрывает у старой', () => {
    putMirrorPage(winKey(CHAT), [msg({ id: 8, message: 'старое' })])
    putMirrorPage(winKey(CHAT), [msg({ id: 8, message: 'новое' })])
    expect(mirrorWindow(winKey(CHAT))?.map((m) => real(m).message)).toEqual(['новое'])
  })

  it('окна разных ключей не смешиваются', () => {
    putMirrorPage(winKey(CHAT), [msg({ id: 1 })])
    putMirrorPage(winKey(CHAT, THREAD), [msg({ id: 2 }, THREAD)])
    expect(ids(winKey(CHAT))).toEqual([1])
    expect(ids(winKey(CHAT, THREAD))).toEqual([2])
  })
})

// Замена окна — второй вход «не от операции», парный `putMirrorPage`. В tweb
// это разные действия и различает их ВЫЗЫВАЮЩИЙ: приклеить страницу к слайсу —
// `SlicedArray.insertSlice` (slicedArray.ts:190-240), начать окно заново —
// путь `delete` зеркала историй (`flushStoragesByPeerId`,
// appMessagesManager.ts:4732-4742 → `clearHistoryStorage`,
// apiManagerProxy.ts:282 и :542-563, где слайсы сносятся `splice(0, Infinity)`).
describe('replaceMirrorWindow — замена окна целиком', () => {
  it('выкидывает прежнее содержимое окна, а не сливается с ним', () => {
    seed(winKey(CHAT), [msg({ id: 1 }), msg({ id: 2 })])
    captured.length = 0
    replaceMirrorWindow(winKey(CHAT), [msg({ id: 90 }), msg({ id: 91 })])
    expect(ids(winKey(CHAT))).toEqual([90, 91])
  })

  // Тот же вход, но через `putMirrorPage`, оставляет старое в окне — ради
  // контраста, потому что различие «слить/заменить» и есть предмет примитива.
  it('контраст: putMirrorPage на тех же данных старое СОХРАНЯЕТ', () => {
    seed(winKey(CHAT), [msg({ id: 1 }), msg({ id: 2 })])
    putMirrorPage(winKey(CHAT), [msg({ id: 90 }), msg({ id: 91 })])
    expect(ids(winKey(CHAT))).toEqual([1, 2, 90, 91])
  })

  it('пустой заменой окно становится ИЗВЕСТНО пустым, а не неизвестным', () => {
    // «Очистить историю»: `mirrorWindow` обязан вернуть [], а не undefined —
    // на этом различии стоят приветствие бота и клавиатура ответа в Chat.tsx.
    // Оригинал кладёт на место вычищенных слайсов пустой
    // (apiManagerProxy.ts:549-551), а не оставляет SlicedArray без слайсов.
    seed(winKey(CHAT), [msg({ id: 1 })])
    replaceMirrorWindow(winKey(CHAT), [])
    expect(mirrorWindow(winKey(CHAT))).toEqual([])
    expect(mirrorWindow(winKey(CHAT))).not.toBeUndefined()
  })

  it('выкидывает и бабл «отправляется…» — в этом отличие от слияния', () => {
    // `putMirrorPage` его бережёт намеренно (ключ дедупа c:${random_id}).
    // Замена — нет: в оригинале неотправленное лежит в НИЖНЕМ слайсе
    // (appMessagesManager.ts:7611 `historyStorage.history.unshift`), а окно
    // вокруг далёкого номера — уже другой слайс, где этого бабла нет.
    seed(winKey(CHAT), [msg({ id: -1, fromId: ME, random_id: 'c-1' })])
    replaceMirrorWindow(winKey(CHAT), [msg({ id: 700 })])
    expect(ids(winKey(CHAT))).toEqual([700])
  })

  it('заводит окно, которого ещё не было', () => {
    replaceMirrorWindow(winKey(CHAT), [msg({ id: 5 })])
    expect(ids(winKey(CHAT))).toEqual([5])
  })

  it('порядок и дедупликация окна те же: по возрастанию номера, побеждает последняя копия', () => {
    replaceMirrorWindow(winKey(CHAT), [msg({ id: 9, message: 'старое' }), msg({ id: 3 }), msg({ id: 9, message: 'новое' })])
    expect(ids(winKey(CHAT))).toEqual([3, 9])
    expect(mirrorWindow(winKey(CHAT))?.map((m) => real(m).message)).toEqual(['m3', 'новое'])
  })

  it('не трогает окна других ключей — ни другого чата, ни треда того же чата', () => {
    seed(winKey(CHAT), [msg({ id: 1 })])
    seed(winKey(CHAT, THREAD), [msg({ id: 2 }, THREAD)])
    seed(winKey(OTHER_CHAT), [msg({ id: 3 })])
    replaceMirrorWindow(winKey(CHAT), [msg({ id: 90 })])
    expect(ids(winKey(CHAT))).toEqual([90])
    expect(ids(winKey(CHAT, THREAD))).toEqual([2])
    expect(ids(winKey(OTHER_CHAT))).toEqual([3])
  })

  it('событий каталога не шлёт: новое окно рисует сам заменивший', () => {
    seed(winKey(CHAT), [msg({ id: 1 })])
    captured.length = 0
    replaceMirrorWindow(winKey(CHAT), [])
    expect(captured).toEqual([])
  })

  it('будит подписчиков и поднимает версию — ровно раз на вызов', () => {
    seed(winKey(CHAT), [msg({ id: 1 })])
    let calls = 0
    const off = subscribeMirror(() => { calls++ })
    const before = mirrorVersion()
    replaceMirrorWindow(winKey(CHAT), [msg({ id: 90 })])
    expect(calls).toBe(1)
    expect(mirrorVersion()).toBe(before + 1)
    off()
  })
})

// ── Мост в React ───────────────────────────────────────────────────────────
//
// Счётчик версии + подписки, поверх которых живёт ЕДИНСТВЕННЫЙ React-хук
// `core/hooks/useMirrorWindow.ts` (контракт самого хука — в его тесте).
// Здесь проверяется то, что изнутри `useSyncExternalStore` не наблюдаемо:
// кого и когда зовёт зеркало.
describe('messagesMirror — мост в React (версия + подписки)', () => {
  it('операция, изменившая окно, поднимает версию и зовёт подписчиков РОВНО раз на пачку', () => {
    const calls: number[] = []
    const off = subscribeMirror(() => calls.push(mirrorVersion()))
    const before = mirrorVersion()
    applyOpsToMirror([
      { op: 'insert', key: winKey(CHAT), msg: msg({ id: 1 }) },
      { op: 'insert', key: winKey(CHAT), msg: msg({ id: 2 }) },
    ])
    expect(calls).toEqual([before + 1])
    off()
  })

  it('операция, НИЧЕГО не изменившая, подписчиков не будит', () => {
    seed(winKey(CHAT), [msg({ id: 10 })])
    const calls: number[] = []
    const off = subscribeMirror(() => calls.push(mirrorVersion()))
    // remove по отсутствующему номеру: `applyOp` вернул ту же ссылку.
    applyOpsToMirror([{ op: 'remove', key: winKey(CHAT), msgId: 999 }])
    expect(calls).toEqual([])
    off()
  })

  it('страница истории будит подписчиков, хотя событий каталога не шлёт', () => {
    let calls = 0
    const off = subscribeMirror(() => { calls++ })
    const before = mirrorVersion()
    putMirrorPage(winKey(CHAT), [msg({ id: 1 })])
    // Ни `history_append`, ни любое другое событие каталога — страницу рисует
    // сам загрузивший (докблок `putMirrorPage`). А вот React-потребитель окна
    // ничего не грузил и узнать обязан — отсюда отдельный канал версии.
    expect(captured).toEqual([])
    expect(calls).toBe(1)
    expect(mirrorVersion()).toBe(before + 1)
    off()
  })

  it('сброс зеркала будит подписчиков; повторный сброс пустого — нет', () => {
    seed(winKey(CHAT), [msg({ id: 1 })])
    let calls = 0
    const off = subscribeMirror(() => { calls++ })
    resetMessagesMirror()
    expect(calls).toBe(1)
    resetMessagesMirror()
    expect(calls).toBe(1)
    off()
  })

  it('отписка перестаёт звать колбэк', () => {
    let calls = 0
    const off = subscribeMirror(() => { calls++ })
    putMirrorPage(winKey(CHAT), [msg({ id: 1 })])
    expect(calls).toBe(1)
    off()
    putMirrorPage(winKey(CHAT), [msg({ id: 2 })])
    expect(calls).toBe(1)
  })
})
