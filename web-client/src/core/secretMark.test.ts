// Задача #94. Пометка `secret` на сообщении секретного чата — ОДИН ответ на
// всех путях, которыми сообщение попадает в окно.
//
// ЧТО ЗНАЧИТ ФЛАГ. `secret` отвечает «в объекте лежит ОТКРЫТЫЙ E2E-текст», а не
// «сообщение из секретного чата»: смысл задаёт единственный исполняемый
// потребитель — фильтр персиста (`store/persist.ts`: `!m.secret && !enc_body`),
// где условий два ровно потому, что признака два. `enc_body` ловит шифртекст
// (входящее), `secret` — то, чего `enc_body` поймать не может: свой
// оптимистичный бабл, у которого плейнтекст есть, а шифртекста нет вовсе
// (`secretManager.sendText/sendMedia`). Отсюда и ответ на нерасшифрованное:
// флага НЕТ, потому что расшифровки не было.
//
// ПОЧЕМУ ФАЙЛ ОБЩИЙ НА ДВА ПУТЯ. Расхождение (живой кадр флага не ставил,
// страница истории ставила) не видно ни одному тесту, который смотрит на путь
// поодиночке: каждый по отдельности «работает». Красит его только очная ставка
// — ОДИН шифртекст, ОДНО состояние хранилища ключей, два пути, один ответ.
//
// ПОЧЕМУ ШИФРТЕКСТ НАСТОЯЩИЙ. Мусорный блоб дал бы `null` по любой причине, и
// «нет пометки» ничего бы не значило. Здесь шифртекст ЗАВЕДОМО расшифровываемый
// (первый кейс это и проверяет), а второй отличается от первого ровно одним —
// хранилище ключей подменено пустым, то есть «ключа взять негде» (задача #92:
// на эту причину `decryptMessage` отдаёт `null` и когда ключа нет, и когда IDB
// недоступен).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'

// Живой путь достижим только через onFrame транспорта — перехватываем его тем
// же приёмом, что workerCore.channelFrames.test.ts.
let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => { capturedConnDeps = deps; return actual.newConnectionManager(deps) },
  }
})

// Воронка — точка, куда живой путь отдаёт кадр ПОСЛЕ попытки расшифровки, то
// есть первое место, где пометка наблюдаема. Настоящая гейтит кадр по pts (на
// негидрированном курсоре ушла бы в догон), поэтому подменяем только
// applyUpdate.
const applied: unknown[] = []
vi.mock('./realtime/globalFunnel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/globalFunnel')>()
  return {
    ...actual,
    newGlobalFunnel: (deps: Parameters<typeof actual.newGlobalFunnel>[0]) => ({
      ...actual.newGlobalFunnel(deps),
      applyUpdate: (_key: string, _pts: number | undefined, d: unknown) => { applied.push(d) },
    }),
  }
})

import { createWorkerCore } from './workerCore'
import { newMessagesManager } from './managers/messagesManager'
import { createSecretManager, type SecretDeps } from './managers/secretManager'
import { generateKeyPair, exportPublicKey, b64FromBytes } from './secret/crypto'
import { makeRawMessage } from './messages/testMessage'
import type { MessageReal, RawMessageReal } from './models'
import type { RestClient } from './net/restClient'
import type { Endpoint } from '../rpc/superMessagePort'

/** Секретный чат адресуется как канал (`secretManager::secretPeerId` строит
 *  `peerChannel`), поэтому ключ пира отрицательный. */
const SECRET_PEER = -42

function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

/** Минимальные зависимости secretManager: сеть отвечает пустотой, отправку
 *  копим — из неё и берётся шифртекст. */
function secretDeps() {
  const sends: Parameters<SecretDeps['conn']['sendMessage']>[0][] = []
  const deps: SecretDeps = {
    rest: { get: async <T>() => ({}) as T, post: async <T>() => ({}) as T },
    conn: { sendMessage: (args) => { sends.push(args) } },
    broadcast: () => {},
    upload: async () => 42,
    beforeSending: () => {},
    failSending: () => {},
  }
  return { deps, sends }
}

/** Кладёт в хранилище ключ секретного чата SECRET_PEER и возвращает шифртекст
 *  фразы, зашифрованный ИМЕННО ЭТИМ ключом (тот же путь, которым его создаёт
 *  собеседник: приняли запрос → вывели общий ключ → зашифровали текст). */
async function seedKeyAndCiphertext(text: string): Promise<string> {
  const { deps, sends } = secretDeps()
  const mgr = createSecretManager(deps)
  const initiator = await generateKeyPair()
  mgr.stashRequest(SECRET_PEER, b64FromBytes(await exportPublicKey(initiator.publicKey)))
  await mgr.accept(SECRET_PEER)
  await mgr.sendText({ peerId: SECRET_PEER, text, clientMsgId: 'cm94', ttlSeconds: null })
  return sends[0].encBody!
}

/** Шифрованное сообщение в форме ПРОВОДА: текста нет по построению (на провод
 *  уходит `text: ''`), тело едет в `enc_body`. */
function encWire(encBody: string): RawMessageReal {
  return { ...makeRawMessage({ id: 1, peerId: SECRET_PEER, fromId: 7 }), enc_body: encBody }
}

/** ЖИВОЙ ПУТЬ: кадр → workerCore::onFrame → secret.decryptMessage → воронка.
 *  Возвращает сообщение таким, каким его увидела воронка. */
async function liveMessage(encBody: string): Promise<MessageReal> {
  const core = createWorkerCore()
  const [epWorker] = pair()
  core.bind(epWorker)
  expect(capturedConnDeps).not.toBeNull()

  capturedConnDeps!.onFrame('new_message', {
    _: 'updateNewMessage', pts: 1, pts_count: 1, message: encWire(encBody),
  })

  await vi.waitFor(() => expect(applied).toHaveLength(1))
  return (applied[0] as { message: MessageReal }).message
}

/** Менеджер истории с настоящей расшифровкой (тот же secretManager, то же
 *  хранилище ключей) и страницей из одного шифрованного сообщения. */
function historyManager(encBody: string) {
  const { deps } = secretDeps()
  const secret = createSecretManager(deps)
  const rest = {
    get: async () => ({ messages: [encWire(encBody)], count: 1 }),
    post: async () => ({}),
  } as unknown as RestClient
  return newMessagesManager({ rest, decryptSecret: (p, e) => secret.decryptMessage(p, e) })
}

/** ПУТЬ ИСТОРИИ: REST-страница → decryptPage. */
async function historyMessage(encBody: string): Promise<MessageReal> {
  const r = await historyManager(encBody).getHistory({ peerId: SECRET_PEER, offsetId: 0, addOffset: 0, limit: 40 })
  return r.messages[0] as MessageReal
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  applied.length = 0
  capturedConnDeps = null
})

afterEach(() => { vi.unstubAllGlobals() })

describe('секретное сообщение: пометка `secret` одинакова на всех путях (#94)', () => {
  // Контроль инструмента и смысла флага сразу: без него оба ассерта второго
  // кейса были бы зелёными на прод-коде, который не ставит `secret` НИКОГДА.
  it('ключ есть: и живой кадр, и страница истории дают открытый текст и `secret: true`', async () => {
    const encBody = await seedKeyAndCiphertext('секрет')

    const live = await liveMessage(encBody)
    const history = await historyMessage(encBody)

    expect([live.secret, history.secret]).toEqual([true, true])
    expect([live.message, history.message]).toEqual(['секрет', 'секрет'])
  })

  it('ключа взять негде: оба пути оставляют бабл БЕЗ пометки — и это один и тот же ответ', async () => {
    const encBody = await seedKeyAndCiphertext('секрет')
    // Тот же шифртекст, но хранилище ключей пусто — единственное отличие от
    // кейса выше.
    vi.stubGlobal('indexedDB', new IDBFactory())

    const live = await liveMessage(encBody)
    const history = await historyMessage(encBody)

    expect([live.secret, history.secret]).toEqual([undefined, undefined])
    expect(live.secret).toEqual(history.secret)
    // Расшифровки не было — текста нет, шифртекст на месте: в персист такое
    // сообщение не идёт по `enc_body` (пин — store/persist.test.ts), своя
    // пометка ему для этого не нужна.
    expect([live.message, history.message]).toEqual(['', ''])
    expect([live.enc_body, history.enc_body]).toEqual([encBody, encBody])
  })

  // Третий путь: выдача поиска (и соседи по контейнеру — шаред-медиа, календарь,
  // пересылка, отложенные) расшифровку не зовёт вовсе. На вопрос о пометке он
  // обязан отвечать так же — и отвечает: плейнтекста в объекте нет, флага нет.
  it('путь без расшифровки (поиск) отвечает тем же: пометки нет', async () => {
    const encBody = await seedKeyAndCiphertext('секрет')
    vi.stubGlobal('indexedDB', new IDBFactory())

    const found = await historyManager(encBody).searchMessages(SECRET_PEER, 'секрет')
    const history = await historyMessage(encBody)

    expect((found.messages[0] as MessageReal).secret).toEqual(history.secret)
    expect((found.messages[0] as MessageReal).secret).toBeUndefined()
  })
})
