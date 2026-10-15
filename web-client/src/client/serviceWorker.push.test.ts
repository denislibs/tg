import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

/* Web Push service worker'а (`public/sw.js`): порт tweb `serviceWorker/push.ts` —
 * `fillPushObject` (:403-418), `fireNotification` (:420-470), `onNotificationClick`
 * (:~280-345), `onPing` (:482-487).
 *
 * SW поднимается ИСХОДНИКОМ (он не модуль, см. `serviceWorker.appShell.test.ts`);
 * `self.registration.showNotification`, окна (`clients`) и `openWindow` —
 * подставные, обработчики `push` / `notificationclick` / `message` — настоящие.
 *
 * Предмет: тело пуша читается по форме tweb (`custom.channel_id | from_id`), клик
 * открывает чат — а если окна нет (приложение закрыто, DNP выключен), чат
 * открывается после `push-ready` от новой вкладки; запертое код-паролем
 * приложение не получает адреса, пока не разблокировано. */

const SW_SOURCE = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8')

type Handler = (e: Record<string, unknown>) => void
type Handlers = Record<string, Handler | undefined>

interface FakeClient {
  focus: ReturnType<typeof vi.fn>
  postMessage: ReturnType<typeof vi.fn>
}

const makeClient = (): FakeClient => ({ focus: vi.fn(async() => undefined), postMessage: vi.fn() })

/** Адреса кликов, отданные окну (`sw-hello` на старте SW — не они). */
const clicks = (c: FakeClient) => c.postMessage.mock.calls.map(([m]) => m).filter((m) => m.type === 'push-click')

function loadServiceWorker(clients: FakeClient[] = []) {
  const handlers: Handlers = {}
  const shown: { title: string, options: Record<string, unknown> }[] = []
  const openWindow = vi.fn(async() => undefined)
  const self = {
    addEventListener(type: string, fn: Handler) { handlers[type] = fn },
    location: { origin: 'https://localhost' },
    clients: { matchAll: async() => clients, claim: async() => {}, openWindow },
    registration: {
      showNotification: async(title: string, options: Record<string, unknown>) => { shown.push({ title, options }) },
    },
    skipWaiting: async() => {},
  }
  const importScripts = () => { throw new Error('нет sw-bridge.js') }
  // oxlint-disable-next-line no-implied-eval
  new Function('self', 'caches', 'fetch', 'importScripts', SW_SOURCE)(self, {}, vi.fn(), importScripts)
  return { handlers, shown, openWindow, clients }
}

async function dispatchWaiting(handler: Handler | undefined, event: Record<string, unknown>) {
  const pending: Promise<unknown>[] = []
  handler?.({ ...event, waitUntil: (p: Promise<unknown>) => { pending.push(p) } })
  await Promise.all(pending)
}

const push = (sw: ReturnType<typeof loadServiceWorker>, body: unknown) =>
  dispatchWaiting(sw.handlers.push, { data: { json: () => body } })

/** Уведомление, которое SW показал, — как его получает `notificationclick`. */
const click = (sw: ReturnType<typeof loadServiceWorker>, data: unknown) =>
  dispatchWaiting(sw.handlers.notificationclick, { notification: { close: vi.fn(), data } })

const ready = (sw: ReturnType<typeof loadServiceWorker>, source: FakeClient) =>
  dispatchWaiting(sw.handlers.message, { data: { type: 'push-ready' }, source })

const lock = (sw: ReturnType<typeof loadServiceWorker>, locked: boolean) =>
  dispatchWaiting(sw.handlers.message, {
    data: { type: 'passcode-state', isUsingPasscode: true, encryptionKey: locked ? null : {} },
    ports: [],
  })

const PEER_PUSH = {
  loc_key: 'MESSAGE_TEXT',
  loc_args: ['Алиса', 'привет'],
  title: 'Алиса',
  description: 'привет',
  custom: { msg_id: '5', from_id: '7' },
}

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(() => { vi.unstubAllGlobals() })

describe('sw.js — fillPushObject / показ пуша (tweb push.ts:403-470)', () => {
  it('личка: peerId из from_id, тег peer<id>, заголовок и текст из тела, данные — сам объект', async() => {
    const sw = loadServiceWorker()
    await push(sw, structuredClone(PEER_PUSH))

    expect(sw.shown).toHaveLength(1)
    const { title, options } = sw.shown[0]
    expect(title).toBe('Алиса')
    expect(options.body).toBe('привет')
    expect(options.tag).toBe('peer7')
    expect((options.data as { custom: { peerId: string } }).custom.peerId).toBe('7')
  })

  it('группа/канал: channel_id "5" -> peerId "-5", тег peer-5', async() => {
    const sw = loadServiceWorker()
    await push(sw, { ...structuredClone(PEER_PUSH), custom: { msg_id: '5', channel_id: '5' } })

    expect(sw.shown[0].options.tag).toBe('peer-5')
    expect((sw.shown[0].options.data as { custom: { peerId: string } }).custom.peerId).toBe('-5')
  })

  it('chat_id "9" -> "-9" (вторая ветка fillPushObject)', async() => {
    const sw = loadServiceWorker()
    await push(sw, { ...structuredClone(PEER_PUSH), custom: { msg_id: '5', chat_id: '9' } })

    expect((sw.shown[0].options.data as { custom: { peerId: string } }).custom.peerId).toBe('-9')
  })

  it('нет ключа пира (старое задание очереди): peerId пустой, тег "peer"', async() => {
    const sw = loadServiceWorker()
    await push(sw, { ...structuredClone(PEER_PUSH), custom: { msg_id: '5' } })

    expect(sw.shown[0].options.tag).toBe('peer')
    expect((sw.shown[0].options.data as { custom: { peerId: string } }).custom.peerId).toBe('')
  })

  it('без loc_key (превью выключено): «Telegram», общий текст, тег unknown_peer — но адрес остаётся', async() => {
    const sw = loadServiceWorker()
    await push(sw, { title: 'Алиса', custom: { msg_id: '5', from_id: '7' } })

    const { title, options } = sw.shown[0]
    expect(title).toBe('Telegram')
    expect(options.body).toBe('New message')
    expect(options.tag).toBe('unknown_peer')
    expect((options.data as { custom: { peerId: string } }).custom.peerId).toBe('7')
  })

  it('MESSAGE_NOTEXT без описания: заголовок автора, общий текст, тег пира', async() => {
    const sw = loadServiceWorker()
    await push(sw, { loc_key: 'MESSAGE_NOTEXT', loc_args: ['Алиса', ''], title: 'Алиса', description: '', custom: { msg_id: '5', from_id: '7' } })

    expect(sw.shown[0].title).toBe('Алиса')
    expect(sw.shown[0].options.body).toBe('New message')
    expect(sw.shown[0].options.tag).toBe('peer7')
  })

  it('пустое или нечитаемое тело: пользователю всё равно показывается уведомление (userVisibleOnly)', async() => {
    const sw = loadServiceWorker()
    await dispatchWaiting(sw.handlers.push, { data: { json: () => { throw new Error('bad json') } } })
    await dispatchWaiting(sw.handlers.push, { data: null })

    expect(sw.shown.map((n) => n.options.tag)).toEqual(['unknown_peer', 'unknown_peer'])
  })

  it('silent: custom.silent == "1" -> тихое уведомление', async() => {
    const sw = loadServiceWorker()
    await push(sw, { ...structuredClone(PEER_PUSH), custom: { msg_id: '5', from_id: '7', silent: '1' } })
    await push(sw, structuredClone(PEER_PUSH))

    expect(sw.shown.map((n) => n.options.silent)).toEqual([true, false])
  })
})

describe('sw.js — клик по пушу (tweb push.ts onNotificationClick / onPing)', () => {
  const shownData = async(sw: ReturnType<typeof loadServiceWorker>, body: unknown = PEER_PUSH) => {
    await push(sw, structuredClone(body))
    return sw.shown[sw.shown.length - 1].options.data
  }

  it('окно есть: focus() и push-click с объектом пуша', async() => {
    const win = makeClient()
    const sw = loadServiceWorker([win])
    const data = await shownData(sw)

    await click(sw, data)

    expect(win.focus).toHaveBeenCalledTimes(1)
    expect(clicks(win)).toEqual([{ type: 'push-click', payload: data }])
    expect(sw.openWindow).not.toHaveBeenCalled()
  })

  it('окна нет (приложение закрыто, DNP выключен): openWindow, затем push-ready -> push-click один раз', async() => {
    const sw = loadServiceWorker([])
    const data = await shownData(sw)

    await click(sw, data)
    expect(sw.openWindow).toHaveBeenCalledWith('/')

    const tab = makeClient()
    await ready(sw, tab)
    expect(clicks(tab)).toEqual([{ type: 'push-click', payload: data }])

    // повторный пинг раз в 10 с адрес не отдаёт второй раз
    await ready(sw, tab)
    expect(clicks(tab)).toHaveLength(1)
  })

  it('push-ready без отложенного клика ничего не шлёт', async() => {
    const sw = loadServiceWorker([])
    const tab = makeClient()
    await ready(sw, tab)
    expect(clicks(tab)).toEqual([])
  })

  it('заперто код-паролем: окно фокусируется, push-click нет; после разблокировки и push-ready — есть', async() => {
    const win = makeClient()
    const sw = loadServiceWorker([win])
    await lock(sw, true)
    const data = await shownData(sw)

    await click(sw, data)
    expect(win.focus).toHaveBeenCalledTimes(1)
    expect(clicks(win)).toEqual([])

    // пока заперто, даже пришедший push-ready адрес не отдаёт
    await ready(sw, win)
    expect(clicks(win)).toEqual([])

    await lock(sw, false)
    await ready(sw, win)
    expect(clicks(win)).toEqual([{ type: 'push-click', payload: data }])
  })

  it('уведомление без данных (например, закрыто системой): ничего не происходит', async() => {
    const win = makeClient()
    const sw = loadServiceWorker([win])
    await click(sw, undefined)
    expect(win.focus).not.toHaveBeenCalled()
    expect(sw.openWindow).not.toHaveBeenCalled()
  })

  it('уведомление вкладки (foreground, uiNotifications) несёт custom.peerId сразу — тот же путь клика', async() => {
    const win = makeClient()
    const sw = loadServiceWorker([win])
    const data = { custom: { peerId: '-3', msg_id: '8' } }

    await click(sw, data)

    expect(clicks(win)).toEqual([{ type: 'push-click', payload: data }])
  })
})
