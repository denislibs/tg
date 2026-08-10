// src/core/realtime/connectionManager.outbox.test.ts
//
// Пины outbox connectionManager (Task 3, страховочная сетка перед replay-рефактором):
// запись живёт в Map<clientMsgId, SendArgs> и переживает закрытый сокет/реконнект/
// перезагрузку страницы (через outboxStore). Задача — зафиксировать текущее поведение
// send/ack/error/resend/restore, не меняя connectionManager.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { newConnectionManager } from './connectionManager'

// Тот же фейк ws, что и в connectionManager.test.ts, но с управляемым isOpen —
// исходный фейк всегда возвращает true, а сценарию 2 (закрытый сокет) нужен false.
function fakeWs(initialOpen = true) {
  let open = initialOpen
  const frames: Array<{ t: string; d?: unknown }> = []
  let openCb = () => {}; let closeCb = () => {}
  const onHandlers = new Map<string, (d: unknown) => void>()
  return {
    client: {
      connect: vi.fn(),
      onOpen: (cb: () => void) => { openCb = cb },
      onClose: (cb: () => void) => { closeCb = cb },
      onError: () => {},
      on: (t: string, cb: (d: unknown) => void) => onHandlers.set(t, cb),
      send: (t: string, d?: unknown) => frames.push({ t, d }),
      isOpen: () => open,
      close: vi.fn(() => closeCb()),
    },
    frames,
    setOpen: (v: boolean) => { open = v },
    fireOpen: () => { open = true; openCb() },
    fireClose: () => { open = false; closeCb() },
    recv: (t: string, d: unknown) => onHandlers.get(t)?.(d),
  }
}

// Минимальный фейк outboxStore (IndexedDB в воркере в проде): load/save как
// у connectionManager.test.ts, но с историей save-вызовов для проверки содержимого.
function fakeStore(initial: unknown[] = []) {
  const saved: unknown[][] = []
  return {
    load: vi.fn(() => Promise.resolve(initial as never[])),
    save: vi.fn((list: unknown[]) => { saved.push(list) }),
    saved,
  }
}

// Прогоняет микротаски восстановления outbox (load().then/catch/finally), как в
// существующем connectionManager.test.ts.
async function flushRestore() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

// NOTE: vitest 4.1.9 в этом репо дедлочится, если `vi.useRealTimers()` вызвать
// внутри `afterEach` при активных фейковых таймерах. Восстановление реальных
// таймеров в НАЧАЛЕ `beforeEach` (перед повторным useFakeTimers) даёт ту же
// изоляцию без зависания хука (см. connectionManager.test.ts:25-28 — тот же приём).
beforeEach(() => { vi.useRealTimers(); vi.useFakeTimers() })

// Честная карта покрытия для гонки «реконнект во время незавершённого
// outboxStore.load()» (асинхронная ветка connectionManager.ts:57 —
// `void outboxRestoredP?.then(() => { if (ws.isOpen()) resend() })`): ни тест 5,
// ни тест 6 её НЕ покрывают. Тест 5 вообще не передаёт outboxStore, поэтому
// outboxRestored синхронно true (см. комментарий внутри теста). Тест 6 делает
// `await flushRestore()` ДО `cm.start(); ws.fireOpen()` — к моменту открытия
// restore-промис уже зарезолвлен, outboxRestored уже true, и resend на onOpen
// идёт по СИНХРОННОЙ ветке (:56), а не по той, что ждёт `outboxRestoredP`.
// Саму гонку (реконнект случается ДО того, как load() успел зарезолвиться)
// держит предсуществующий `connectionManager.test.ts:75-101` — там
// `cm.start(); ws.fireOpen()` идут до любого `await`, поэтому промис
// восстановления в момент открытия сокета ещё висит.
describe('ConnectionManager outbox pins', () => {
  it('1. sendMessage при открытом сокете: кадр ушёл и запись легла в outbox', () => {
    const ws = fakeWs(true)
    const store = fakeStore([])
    const cm = newConnectionManager({
      ws: ws.client as never, getToken: () => 'tok',
      onReady: () => {}, onState: () => {}, onFrame: () => {},
      outboxStore: store as never,
    })
    cm.sendMessage({ chatId: 1, text: 'hi', clientMsgId: 'c1' })
    // что ломается: если send_message перестанет отправляться синхронно при
    // открытом сокете — этот expect на кадр упадёт первым.
    expect(ws.frames.find((f) => f.t === 'send_message')).toBeTruthy()
    // что ломается: если sendMessage перестанет класть запись в outbox — упадёт
    // как outboxSize, так и содержимое последнего save().
    expect(cm.outboxSize()).toBe(1)
    expect(store.save).toHaveBeenCalled()
    expect(store.saved[store.saved.length - 1]).toHaveLength(1)
  })

  it('2. sendMessage при закрытом сокете: кадр не ушёл, но запись в outbox есть', () => {
    const ws = fakeWs(false)
    const store = fakeStore([])
    const cm = newConnectionManager({
      ws: ws.client as never, getToken: () => 'tok',
      onReady: () => {}, onState: () => {}, onFrame: () => {},
      outboxStore: store as never,
    })
    cm.sendMessage({ chatId: 1, text: 'hi', clientMsgId: 'c1' })
    // что ломается: если sendMessage начнёт слать кадр без проверки isOpen —
    // сообщение уйдёт в закрытый сокет и потеряется молча.
    expect(ws.frames.find((f) => f.t === 'send_message')).toBeUndefined()
    // что ломается: если запись не попадёт в outbox без открытого сокета —
    // сообщение не переотправится на следующем connect и исчезнет.
    expect(cm.outboxSize()).toBe(1)
  })

  it('3. message_ack удаляет запись из outbox, save вызван', () => {
    const ws = fakeWs(true)
    const store = fakeStore([])
    const cm = newConnectionManager({
      ws: ws.client as never, getToken: () => 'tok',
      onReady: () => {}, onState: () => {}, onFrame: () => {},
      outboxStore: store as never,
    })
    cm.start(); ws.fireOpen()
    cm.sendMessage({ chatId: 1, text: 'hi', clientMsgId: 'c1' })
    expect(cm.outboxSize()).toBe(1)
    ws.recv('message_ack', { client_msg_id: 'c1', msg_id: 9, seq: 5, created_at: 'now' })
    // что ломается: если ack перестанет чистить outbox — сообщение переотправится
    // на следующем реконнекте, хотя сервер его уже принял (дубль на бэке).
    expect(cm.outboxSize()).toBe(0)
    expect(store.saved[store.saved.length - 1]).toHaveLength(0)
  })

  it('4. message_error тоже удаляет запись (иначе вечный resend на каждом реконнекте)', () => {
    const ws = fakeWs(true)
    const store = fakeStore([])
    const cm = newConnectionManager({
      ws: ws.client as never, getToken: () => 'tok',
      onReady: () => {}, onState: () => {}, onFrame: () => {},
      outboxStore: store as never,
    })
    cm.start(); ws.fireOpen()
    cm.sendMessage({ chatId: 1, text: 'hi', clientMsgId: 'c1' })
    expect(cm.outboxSize()).toBe(1)
    ws.recv('message_error', { client_msg_id: 'c1', reason: 'too_long' })
    // что ломается: если message_error перестанет удалять запись — отвергнутое
    // сообщение будет переотправляться на каждый реконнект вечно
    // (connectionManager.ts:67-70 — ровно об этом комментарий в коде).
    expect(cm.outboxSize()).toBe(0)
    expect(store.saved[store.saved.length - 1]).toHaveLength(0)
  })

  it('5. реконнект (onOpen) переотправляет все неподтверждённые записи', () => {
    const ws = fakeWs(true)
    // Без outboxStore: outboxRestored синхронно true (см. connectionManager.ts:24),
    // поэтому resend на onOpen отрабатывает без ожидания микротасок restore-промиса —
    // здесь важен именно сам resend, а не восстановление из IDB (это сценарий 6).
    const cm = newConnectionManager({
      ws: ws.client as never, getToken: () => 'tok',
      onReady: () => {}, onState: () => {}, onFrame: () => {},
    })
    cm.start(); ws.fireOpen()
    cm.sendMessage({ chatId: 1, text: 'hi', clientMsgId: 'c1' })
    ws.frames.length = 0
    ws.fireClose()
    vi.advanceTimersByTime(1000) // backoff elapses → reconnect
    ws.fireOpen()
    // что ломается: если onOpen перестанет резолвить outbox.values() — неподтверждённое
    // сообщение не переживёт разрыв соединения и исчезнет без ack/error.
    expect(ws.frames.filter((f) => f.t === 'send_message').length).toBe(1)
    expect((ws.frames.find((f) => f.t === 'send_message')?.d as { client_msg_id?: string })?.client_msg_id).toBe('c1')
  })

  it('6. восстановление из IDB не перезаписывает запись, добавленную в этой сессии', async () => {
    const ws = fakeWs(true)
    // load() отдаёт «протухшую» версию c1 (другой текст) плюс отдельную old2 —
    // как если бы прошлая сессия не успела получить ack на обе.
    const store = fakeStore([
      { chatId: 1, text: 'stale-from-idb', clientMsgId: 'c1' },
      { chatId: 2, text: 'restored2', clientMsgId: 'old2' },
    ])
    const cm = newConnectionManager({
      ws: ws.client as never, getToken: () => 'tok',
      onReady: () => {}, onState: () => {}, onFrame: () => {},
      outboxStore: store as never,
    })
    // Сессия успевает положить свежую c1 синхронно, ДО того как отработает
    // микротаска восстановления (load() ещё не зарезолвился).
    cm.sendMessage({ chatId: 1, text: 'fresh-this-session', clientMsgId: 'c1' })
    await flushRestore()
    ws.frames.length = 0
    cm.start(); ws.fireOpen() // резолвит resend по уже восстановленному outbox
    const c1Frames = ws.frames.filter(
      (f) => f.t === 'send_message' && (f.d as { client_msg_id?: string })?.client_msg_id === 'c1',
    )
    // что ломается: если восстановленная запись перезапишет свежую (порядок
    // set в connectionManager.ts:29-33 перевернётся) — переотправится устаревший
    // текст «stale-from-idb» вместо того, что реально ввёл пользователь в этой сессии.
    expect(c1Frames.every((f) => (f.d as { text?: string })?.text === 'fresh-this-session')).toBe(true)
    expect(c1Frames.some((f) => (f.d as { text?: string })?.text === 'stale-from-idb')).toBe(false)
    // old2 (без конфликта) восстанавливается и резолвится как есть.
    expect(cm.outboxSize()).toBe(2)
  })
})
