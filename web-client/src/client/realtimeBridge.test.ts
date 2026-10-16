// src/client/realtimeBridge.test.ts
//
// Норма построчная (web-client/CLAUDE.md, «Тесты»): этот модуль — весь целиком
// проводка, а не логика (обработчиков не содержит). Из двух строк, которые он
// реально исполняет, ни одна раньше не была покрыта — удаление любой красило 0
// тестов, а приложение при этом полностью теряло realtime:
//
//   for (const ev of WORKER_EVENTS) {
//     smp.on(ev, (p, m) => { rootScope.dispatchEventSingle(ev, p, m) })  // :30 — насос
//   }
//   rootScope.setPort(smp)                                              // :35 — обратный путь
//
// Регистрация подписчиков (registerStoreProjection и т.д.) сюда не входит —
// каждая покрыта своим файлом (storeProjection.test.ts, soundSubscriber.test.ts, …).
//
// startClient()/startRealtime() держат модульные синглтоны (bootstrap.ts's `cached`,
// этот файл's `started`) — vi.resetModules() + динамический импорт в КАЖДОМ тесте
// дают свежий smp/rootScope на кейс, не завися от порядка запуска.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Endpoint } from '../rpc/superMessagePort'
import type { NewMessageEvt } from '../core/realtime/events'

// Тот же приём, что в bootstrap.lock.test.ts: happy-dom не знает ни Worker, ни
// SharedWorker — startClient() падает в ветку `new Worker(...)`, которую нужно
// застабить, чтобы дойти до реальной проводки. Здесь дополнительно нужен доступ
// к слушателю 'message', который конструктор SuperMessagePort вешает на эндпоинт
// (superMessagePort.ts:75), — через него симулируется входящий от воркера кадр
// {kind:'event', …}, не трогая внутренности SuperMessagePort напрямую.
// Единственный инстанс на setup() (startClient() создаёт ровно один Worker) —
// достаточно module-level переменной под слушателем, без отслеживания самого
// инстанса.
let lastListener: ((ev: MessageEvent) => void) | undefined
class FakeWorker implements Endpoint {
  postMessage(): void {}
  addEventListener(_type: 'message', cb: (ev: MessageEvent) => void): void { lastListener = cb }
}

async function setup() {
  vi.resetModules()
  lastListener = undefined
  vi.stubGlobal('Worker', FakeWorker)
  const { default: rootScope } = await import('@lib/rootScope')
  const { RT } = await import('../core/realtime/events')
  const { startRealtime } = await import('./realtimeBridge')
  const { startClient } = await import('./bootstrap')
  // Симулирует входящее сообщение от воркера — тем же путём, каким его
  // доставил бы настоящий Worker.postMessage на стороне вкладки.
  const deliver = (data: unknown) => lastListener?.({ data } as MessageEvent)
  return { deliver, rootScope, RT, startRealtime, startClient }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Минимальная заглушка полезной нагрузки — типизированный payload насосу не
// важен, он его не разбирает, только перекладывает (см. notificationSubscriber.test.ts
// для того же приёма).
const evt = (peer_id: number, seq: number) => ({ peer_id, seq } as unknown as NewMessageEvt)

describe('realtimeBridge.startRealtime — насос smp → rootScope', () => {
  // Удаление строки 30 (`smp.on(ev, …)`) не красит тесты подписчиков (они бьют
  // по rootScope.dispatchEventSingle напрямую, минуя насос) — только этот тест
  // симулирует реальный входящий кадр воркера и проверяет, что он вообще
  // доходит до rootScope.
  it('входящий кадр воркера {kind:"event"} доезжает до rootScope-слушателя через dispatchEventSingle', async () => {
    const { deliver, rootScope, RT, startRealtime, startClient } = await setup()
    startRealtime()
    const { smp } = startClient()
    // dispatchEventSingle НЕ шлёт обратно в порт (в отличие от dispatchEvent) —
    // если бы насос по ошибке звал dispatchEvent, это вызвало бы smp.emit и
    // закольцевало событие обратно в воркер (rootScope.ts:117-121). Проверяем
    // отсутствие этого вызова, а не только сам факт доставки, — иначе мутация
    // dispatchEventSingle → dispatchEvent прошла бы тест незамеченной.
    const emitSpy = vi.spyOn(smp, 'emit')
    const received: unknown[] = []
    rootScope.addEventListener(RT.newMessage, (p) => received.push(p))

    deliver({ kind: 'event', event: RT.newMessage, payload: evt(1, 1) })

    expect(received).toEqual([evt(1, 1)])
    expect(emitSpy).not.toHaveBeenCalled()
  })

  // Удаление строки 35 (`rootScope.setPort(smp)`) не красит тесты подписчиков —
  // они читают из rootScope, не пишут в него. Только исходящий путь (эта
  // вкладка порождает событие через rootScope.dispatchEvent) замечает пропажу:
  // без setPort порт остаётся null и локальное событие никуда, кроме локальных
  // слушателей, не уходит.
  // Событие СМЕНЫ ЯЗЫКА идёт по этому же насосу, но оно не `RT.*`: порождает его
  // вкладка (`lib/langPack.ts::applyLangPack`), а воркер лишь ретранслирует соседям.
  // Пин заведён живой проверкой задачи 9: имя отсутствовало в `WORKER_EVENTS`, и
  // соседняя вкладка языка не меняла — при том, что ОТПРАВКА работала (исходящий
  // путь имён не перечисляет), то есть дефект был виден только на двух вкладках.
  it('смена языка в соседней вкладке доезжает до rootScope этой', async () => {
    const { deliver, rootScope, startRealtime } = await setup()
    startRealtime()
    const received: unknown[] = []
    rootScope.addEventListener('language_change', (code) => received.push(code))

    deliver({ kind: 'event', event: 'language_change', payload: 'ru' })

    expect(received).toEqual(['ru'])
  })

  // Событие книги (tweb rootScope.ts:152) — тоже не `RT.*`: его шлёт менеджер книги
  // воркера (`contactsManager::onContactUpdated`), а слушает список контактов.
  it('contacts_update воркера доезжает до rootScope вкладки', async () => {
    const { deliver, rootScope, startRealtime } = await setup()
    startRealtime()
    const received: unknown[] = []
    rootScope.addEventListener('contacts_update', (userId) => received.push(userId))

    deliver({ kind: 'event', event: 'contacts_update', payload: 5 })

    expect(received).toEqual([5])
  })

  // tweb `chat_toggle_forum` (rootScope.ts:34) — шлёт владелец карточек воркера
  // после операции зеркала, слушает лента открытого чата (переоткрытие форума).
  it('chat_toggle_forum воркера доезжает до rootScope вкладки', async () => {
    const { deliver, rootScope, startRealtime } = await setup()
    startRealtime()
    const received: unknown[] = []
    rootScope.addEventListener('chat_toggle_forum', (payload) => received.push(payload))

    deliver({ kind: 'event', event: 'chat_toggle_forum', payload: { chatId: 50, enabled: true } })

    expect(received).toEqual([{ chatId: 50, enabled: true }])
  })

  // Событие чёрного списка (tweb rootScope.ts:53) — шлёт `privacyManager.toggleBlock`
  // воркера, слушают вкладка «Заблокированные» и хаб «Конфиденциальность».
  it('peer_block воркера доезжает до rootScope вкладки', async () => {
    const { deliver, rootScope, startRealtime } = await setup()
    startRealtime()
    const received: unknown[] = []
    rootScope.addEventListener('peer_block', (e) => received.push(e))

    deliver({ kind: 'event', event: 'peer_block', payload: { peerId: 6, blocked: true } })

    expect(received).toEqual([{ peerId: 6, blocked: true }])
  })

  // Запросы на повторную оплату платного сообщения (tweb rootScope.ts) — шлёт
  // воркер (`messages/repayRequestHandler.ts`), слушает перехватчик смены цены чата.
  it('insufficent_stars_for_message и fulfill_repaid_message воркера доезжают до rootScope', async () => {
    const { deliver, rootScope, startRealtime } = await setup()
    startRealtime()
    const received: unknown[] = []
    rootScope.addEventListener('insufficent_stars_for_message', (e) => received.push(['need', e]))
    rootScope.addEventListener('fulfill_repaid_message', (e) => received.push(['done', e]))

    deliver({ kind: 'event', event: 'insufficent_stars_for_message', payload: { requestId: 1, messageCount: 2, peerId: -5, starsAmount: 5 } })
    deliver({ kind: 'event', event: 'fulfill_repaid_message', payload: { requestId: 1 } })

    expect(received).toEqual([['need', { requestId: 1, messageCount: 2, peerId: -5, starsAmount: 5 }], ['done', { requestId: 1 }]])
  })

  // Глобальные настройки уведомлений по типу чатов (tweb rootScope.ts `notify_settings`) —
  // шлёт воркер (кадр журнала и местный апдейт своего PUT), слушает проектор notifyStore.
  it('notify_settings воркера доезжает до rootScope вкладки', async () => {
    const { deliver, rootScope, startRealtime } = await setup()
    startRealtime()
    const received: unknown[] = []
    rootScope.addEventListener('notify_settings', (e) => received.push(e))
    const body = { _: 'updateNotifySettings', peer: { _: 'notifyUsers' }, notify_settings: { _: 'peerNotifySettings', mute_until: 0 } }

    deliver({ kind: 'event', event: 'notify_settings', payload: body })

    expect(received).toEqual([body])
  })

  // Черновик треда (tweb rootScope.ts:162) — шлёт `draftsManager.saveDraft` воркера,
  // слушает поле ввода открытого треда (`ChatInput`, tweb input.ts:1711-1727).
  it('draft_updated воркера доезжает до rootScope вкладки', async () => {
    const { deliver, rootScope, startRealtime } = await setup()
    startRealtime()
    const received: unknown[] = []
    rootScope.addEventListener('draft_updated', (e) => received.push(e))

    deliver({ kind: 'event', event: 'draft_updated', payload: { peerId: -5, threadId: 7, draft: undefined } })

    expect(received).toEqual([{ peerId: -5, threadId: 7, draft: undefined }])
  })

  it('rootScope.setPort(smp) реально вызывается — событие этой вкладки (dispatchEvent) уходит в порт', async () => {
    const { rootScope, RT, startRealtime, startClient } = await setup()
    startRealtime()
    const { smp } = startClient()
    const emitSpy = vi.spyOn(smp, 'emit')

    rootScope.dispatchEvent(RT.newMessage, evt(2, 2))

    expect(emitSpy).toHaveBeenCalledWith(RT.newMessage, evt(2, 2), undefined)
  })
})
