import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { generateKeyPair, exportPublicKey, b64FromBytes } from '../secret/crypto'
import { loadKey, loadPending } from '../secret/keyStore'
import { createSecretManager, type SecretDeps } from './secretManager'
import { RT } from '../realtime/events'

// Свежий IndexedDB на каждый тест — ключи/pending не текут между кейсами.
beforeEach(() => { indexedDB = new IDBFactory() })

interface RestCall { url: string; body: unknown }
// Настраиваемый ответ GET /secret_chats/{id} для sync-тестов.
// Стадия handshake — КОНСТРУКТОР объединения `EncryptedChat`: вместе с ней
// меняется и набор полей. Прежде ехала пара {peer_id, state} с нашим
// перечислением из четырёх строк.
type Handshake =
  | { _: 'encryptedChatRequested'; id: number; date: number; admin_id: number; participant_id: number; g_a: string }
  | { _: 'encryptedChat'; id: number; date: number; admin_id: number; participant_id: number; g_a_or_b: string }
  | { _: 'encryptedChatDiscarded'; id: number }

function makeDeps() {
  const restCalls: RestCall[] = []
  const getCalls: string[] = []
  const sends: Parameters<SecretDeps['conn']['sendMessage']>[0][] = []
  const events: { event: string; payload: unknown }[] = []
  const uploads: { bytes: ArrayBuffer; mime: string; size: number; fileName?: string }[] = []
  // Заявки на временный бабл (порт tweb beforeMessageSending) — в воркере их
  // исполняет messages.beforeMessageSending, здесь просто копим.
  const pendings: Parameters<SecretDeps['beforeSending']>[0][] = []
  // Красная пометка на бабле — её ставит владелец из ВОРКЕРА (см. failSending
  // в secretManager): ошибка «нет ключа / оффлайн / упал аплоад» случается здесь.
  const failed: string[] = []
  // Тест выставляет handshake (или бросает) перед вызовом sync.
  const getState = { handshake: null as Handshake | null, err: null as Error | null }
  const deps: SecretDeps = {
    rest: {
      get: async <T>(url: string): Promise<T> => {
        getCalls.push(url)
        if (getState.err) throw getState.err
        return getState.handshake as unknown as T
      },
      post: async <T>(url: string, body: unknown): Promise<T> => {
        restCalls.push({ url, body })
        if (url === '/secret_chats') {
          return { _: 'encryptedChatRequested', id: 1, date: 1, admin_id: 5, participant_id: 9, g_a: 'x' } as unknown as T // ключ пира: -1
        }
        return {} as T
      },
    },
    conn: { sendMessage: (args) => { sends.push(args) } },
    failSending: (id) => { failed.push(id) },
    broadcast: (event, payload) => { events.push({ event, payload }) },
    upload: async (bytes, mime, size, fileName) => { uploads.push({ bytes, mime, size, fileName }); return 42 },
    beforeSending: (p) => { pendings.push(p) },
  }
  return { deps, restCalls, getCalls, sends, events, uploads, getState, pendings, failed }
}

// Задача #92. Хранилище ключей бывает не пустым, а НЕДОСТУПНЫМ: keyStore.open()
// отклоняется по `req.onerror`, и вместе с ним отклоняется `loadKey`. Стаб
// воспроизводит ровно это — indexedDB, чей open() всегда падает; ошибку отдаём
// следующей микрозадачей, потому что обработчики keyStore вешает синхронно
// сразу после вызова open() (как и настоящий IDB, который раньше не стреляет).
function breakIndexedDB(): void {
  indexedDB = {
    open: () => {
      const req = { error: new Error('idb unavailable'), onupgradeneeded: null, onsuccess: null, onerror: null } as unknown as IDBOpenDBRequest
      queueMicrotask(() => { req.onerror?.(new Event('error')) })
      return req
    },
  } as unknown as IDBFactory
}

describe('secretManager', () => {
  it('start: генерит пару, постит pub на /secret_chats, сохраняет pending', async () => {
    const { deps, restCalls } = makeDeps()
    const mgr = createSecretManager(deps)
    const { peerId } = await mgr.start(2)
    // Ключ пира ЗНАКОВЫЙ: у чата он отрицательный. Прежде фейк отдавал
    // положительное число, хотя сервер всегда слал ToPeerID(chatID, true).
    expect(peerId).toBe(-1)
    expect(restCalls).toHaveLength(1)
    expect(restCalls[0].url).toBe('/secret_chats')
    const body = restCalls[0].body as { peer_id: number; pub: string }
    expect(body.peer_id).toBe(2)
    expect(typeof body.pub).toBe('string')
    expect(body.pub.length).toBeGreaterThan(0)
    // приватный ключ инициатора сохранён локально до accept — по ЗНАКОВОМУ ключу
    expect(await loadPending(-1)).not.toBeNull()
  })

  it('accept: выводит ключ из pub инициатора, постит свой pub, отдаёт 12 эмодзи', async () => {
    const { deps, restCalls } = makeDeps()
    const mgr = createSecretManager(deps)
    // валидный pub инициатора для реального ECDH
    const initiatorKp = await generateKeyPair()
    const initiatorPub = b64FromBytes(await exportPublicKey(initiatorKp.publicKey))
    mgr.stashRequest(1, initiatorPub)
    const { fingerprint } = await mgr.accept(1)
    expect(fingerprint).toHaveLength(12)
    expect(restCalls.some((c) => c.url === '/secret_chats/1/accept')).toBe(true)
    const acceptCall = restCalls.find((c) => c.url === '/secret_chats/1/accept')!
    expect(typeof (acceptCall.body as { pub: string }).pub).toBe('string')
  })

  it('accept без stashRequest бросает ошибку', async () => {
    const { deps } = makeDeps()
    const mgr = createSecretManager(deps)
    await expect(mgr.accept(1)).rejects.toThrow(/initiator pub/)
  })

  it('sendText: шифрует и шлёт type:encrypted; decryptMessage восстанавливает payload', async () => {
    const { deps, sends } = makeDeps()
    const mgr = createSecretManager(deps)
    // готовим ключ чата через accept
    const initiatorKp = await generateKeyPair()
    const initiatorPub = b64FromBytes(await exportPublicKey(initiatorKp.publicKey))
    mgr.stashRequest(1, initiatorPub)
    await mgr.accept(1)

    const payload = { text: 'секрет 🔒', entities: [{ _: 'messageEntityBold', offset: 0, length: 6 }] }
    const res = await mgr.sendText({ peerId: 1, text: payload.text, entities: payload.entities, clientMsgId: 'cm1', ttlSeconds: 30 })
    expect(res.ok).toBe(true)
    expect(sends).toHaveLength(1)
    expect(sends[0].type).toBe('encrypted')
    expect(sends[0].text).toBe('')
    expect(sends[0].clientMsgId).toBe('cm1')
    expect(sends[0].ttlSeconds).toBe(30)
    expect(typeof sends[0].encBody).toBe('string')
    expect(sends[0].encBody!.length).toBeGreaterThan(0)

    const decrypted = await mgr.decryptMessage(1, sends[0].encBody!)
    expect(decrypted).toEqual(payload)
  })

  it('sendMedia: грузит ciphertext-блоб, шлёт type:encrypted с media_id; decrypt восстанавливает media', async () => {
    const { deps, sends, uploads } = makeDeps()
    const mgr = createSecretManager(deps)
    const initiatorKp = await generateKeyPair()
    const initiatorPub = b64FromBytes(await exportPublicKey(initiatorKp.publicKey))
    mgr.stashRequest(1, initiatorPub)
    await mgr.accept(1)

    const bytes = new TextEncoder().encode('файл-байты').buffer
    const res = await mgr.sendMedia({ peerId: 1, bytes, name: 'pic.jpg', mime: 'image/jpeg', size: 10, mediaType: 'photo', clientMsgId: 'cm2', ttlSeconds: null })
    expect(res.ok).toBe(true)
    // ciphertext ушёл как непрозрачный blob (не image/jpeg), а не plaintext
    expect(uploads).toHaveLength(1)
    expect(uploads[0].mime).toBe('application/octet-stream')
    expect(uploads[0].bytes.byteLength).toBeGreaterThan(0)
    // сообщение type:encrypted с media_id (blob) и пустым text
    expect(sends).toHaveLength(1)
    expect(sends[0].type).toBe('encrypted')
    expect(sends[0].text).toBe('')
    expect(sends[0].mediaId).toBe(42)
    // payload несёт media с key/iv и метаданными, но не сам файл
    const dec = await mgr.decryptMessage(1, sends[0].encBody!)
    expect(dec?.media).toBeDefined()
    expect(dec?.media?.mediaId).toBe(42)
    expect(dec?.media?.mediaType).toBe('photo')
    expect(dec?.media?.name).toBe('pic.jpg')
    expect(dec?.media?.mime).toBe('image/jpeg')
    expect(typeof dec?.media?.keyB64).toBe('string')
    expect(typeof dec?.media?.ivB64).toBe('string')
  })

  // Что ломается, если гарантия нарушена: секретная отправка идёт МИМО
  // messages.sendText/sendFile (по проводу уходит шифртекст, а не текст бабла), поэтому
  // временный бабл заводит этот путь. Пропади вызов — своё сообщение в секретном
  // чате не появлялось бы на экране до расшифрованного эха new_message.
  it('sendText c optimistic: временный бабл заявлен ДО шифрования, с плейнтекстом и пометкой secret', async () => {
    const { deps, pendings } = makeDeps()
    const mgr = createSecretManager(deps)
    const initiatorKp = await generateKeyPair()
    mgr.stashRequest(1, b64FromBytes(await exportPublicKey(initiatorKp.publicKey)))
    await mgr.accept(1)

    await mgr.sendText({ peerId: 1, text: 'секрет 🔒', clientMsgId: 'cm3', ttlSeconds: null, optimistic: { senderId: 5, type: 'text' } })

    expect(pendings).toEqual([{
      peer_id: 1, client_msg_id: 'cm3', sender_id: 5, text: 'секрет 🔒', type: 'text', entities: undefined, secret: true,
      thread_root_id: null, reply_to_id: null,
    }])
  })

  // Что ломается: у голосового и документа в секретном чате бабла нет и не было
  // (они приезжают уже расшифрованным эхом) — начни sendMedia заводить его
  // безусловно, после отправки висел бы вечный «отправляется…» рядом с настоящим.
  it('sendMedia без optimistic бабл не заводит, с optimistic — заводит с локальной метой файла', async () => {
    const { deps, pendings } = makeDeps()
    const mgr = createSecretManager(deps)
    const initiatorKp = await generateKeyPair()
    mgr.stashRequest(1, b64FromBytes(await exportPublicKey(initiatorKp.publicKey)))
    await mgr.accept(1)
    const bytes = new TextEncoder().encode('файл-байты').buffer

    await mgr.sendMedia({ peerId: 1, bytes, name: 'voice', mime: 'audio/ogg', size: 10, mediaType: 'voice', clientMsgId: 'cm4', ttlSeconds: null })
    expect(pendings).toEqual([])

    await mgr.sendMedia({
      peerId: 1, bytes, name: 'pic.jpg', mime: 'image/jpeg', size: 10, mediaType: 'photo', clientMsgId: 'cm5', ttlSeconds: null,
      text: 'подпись', optimistic: { senderId: 5, type: 'photo', media: { width: 2, height: 3, mime: 'image/jpeg', size: 10, name: 'pic.jpg' } },
    })
    expect(pendings[0]).toMatchObject({
      peer_id: 1, client_msg_id: 'cm5', sender_id: 5, text: 'подпись', type: 'photo',
      media: { width: 2, height: 3, mime: 'image/jpeg', size: 10, name: 'pic.jpg' }, secret: true,
    })
    // Локальное превью минтит ВОРКЕР — из плейнтекста, который у него и так на
    // руках до шифрования (вкладочный blob-URL был бы битым в остальных вкладках).
    expect(pendings[0].local_url).toMatch(/^blob:/)
  })

  // Что ломается: сорвись шифрование/аплоад/отправка — бабл остался бы вечным
  // «отправляется…». Ошибка случается ЗДЕСЬ, в воркере, поэтому и пометку
  // ставит владелец отсюда, а не вкладка вторым RPC.
  it('ошибка отправки помечает бабл упавшим — но только если бабл заводился', async () => {
    const { deps, failed } = makeDeps()
    const mgr = createSecretManager(deps)

    await expect(mgr.sendText({ peerId: 99, text: 'x', clientMsgId: 'cm6', ttlSeconds: null, optimistic: { senderId: 5, type: 'text' } })).rejects.toThrow(/key missing/)
    expect(failed).toEqual(['cm6'])

    await expect(mgr.sendText({ peerId: 99, text: 'x', clientMsgId: 'cm7', ttlSeconds: null })).rejects.toThrow(/key missing/)
    expect(failed).toEqual(['cm6'])
  })

  it('sendText без ключа чата бросает ошибку', async () => {
    const { deps } = makeDeps()
    const mgr = createSecretManager(deps)
    await expect(mgr.sendText({ peerId: 99, text: 'x', clientMsgId: 'c', ttlSeconds: null })).rejects.toThrow(/key missing/)
  })

  it('decryptMessage без ключа → null; на битом blob → null', async () => {
    const { deps } = makeDeps()
    const mgr = createSecretManager(deps)
    expect(await mgr.decryptMessage(99, 'garbage')).toBeNull()
  })

  // ── Задача #92: «ключа взять негде» — ОДИН исход ─────────────────────────
  // Контроль самого инструмента. Без него оба кейса ниже были бы зелёными при
  // ЛЮБОМ прод-коде: на исправном пустом IDB «ключа нет» и так даёт null, и
  // тест не отличил бы сломанное хранилище от отсутствующего ключа.
  it('стаб сломанного хранилища действительно ОТКЛОНЯЕТ чтение ключа (контроль инструмента)', async () => {
    breakIndexedDB()
    await expect(loadKey(1)).rejects.toBeTruthy()
  })

  // Раньше исходы расходились: ключа нет → null (кадр применяется
  // нерасшифрованным, пустым баблом), IDB недоступен → отказ всего метода
  // (кадр не применяется вовсе, дыра в pts; страница истории падает целиком в
  // Promise.all у messagesManager.decryptPage). Причина одна — ключа взять
  // негде, — значит и ответ обязан быть один.
  it('decryptMessage: «ключа нет» и «хранилище отказало» дают ОДИН исход — null', async () => {
    const { deps, sends } = makeDeps()
    const mgr = createSecretManager(deps)
    const initiatorKp = await generateKeyPair()
    mgr.stashRequest(1, b64FromBytes(await exportPublicKey(initiatorKp.publicKey)))
    await mgr.accept(1)
    await mgr.sendText({ peerId: 1, text: 'секрет', clientMsgId: 'cm92', ttlSeconds: null })
    const encBody = sends[0].encBody!
    // Шифртекст ЗАВЕДОМО расшифровываемый — иначе null ниже не значил бы ничего.
    expect(await mgr.decryptMessage(1, encBody)).toEqual({ text: 'секрет', entities: [] })

    const missingKey = await mgr.decryptMessage(777, encBody) // ключа нет
    breakIndexedDB()
    const brokenStore = await mgr.decryptMessage(1, encBody) // тот же чат, тот же шифртекст, мёртвый IDB

    expect(brokenStore).toBeNull()
    expect(brokenStore).toEqual(missingKey)
  })

  // Та же болезнь у соседей по файлу не заводится: у sendText/sendMedia чтение
  // ключа стоит ВНУТРИ try, поэтому обе причины кончаются одинаково — красная
  // пометка на бабле и отказ вызова. Текст ошибки при этом разный (свой
  // 'key missing' против ошибки IDB) — совпадать обязан ИСХОД, а не причина.
  it('sendText: «ключа нет» и «хранилище отказало» дают ОДИН исход — упавший бабл и отказ', async () => {
    const { deps, failed, sends } = makeDeps()
    const mgr = createSecretManager(deps)
    const optimistic = { senderId: 5, type: 'text' }

    await expect(mgr.sendText({ peerId: 99, text: 'x', clientMsgId: 'no-key', ttlSeconds: null, optimistic })).rejects.toThrow()
    breakIndexedDB()
    await expect(mgr.sendText({ peerId: 99, text: 'x', clientMsgId: 'broken-idb', ttlSeconds: null, optimistic })).rejects.toThrow()

    expect(failed).toEqual(['no-key', 'broken-idb'])
    expect(sends).toHaveLength(0) // шифртекста нет — на провод не ушло ничего
  })

  it('complete: без pending (не инициатор) — ничего не делает', async () => {
    const { deps, events } = makeDeps()
    const mgr = createSecretManager(deps)
    const responderKp = await generateKeyPair()
    const responderPub = b64FromBytes(await exportPublicKey(responderKp.publicKey))
    await mgr.complete(1, responderPub)
    expect(events).toHaveLength(0)
  })

  it('complete: с pending выводит ключ, чистит pending и бродкастит secretAccept', async () => {
    const { deps, events } = makeDeps()
    const mgr = createSecretManager(deps)
    await mgr.start(2) // savePending(-1)
    const responderKp = await generateKeyPair()
    const responderPub = b64FromBytes(await exportPublicKey(responderKp.publicKey))
    await mgr.complete(-1, responderPub)
    expect(await loadPending(-1)).toBeNull()
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe(RT.secretAccept)
    const p = events[0].payload as { peer_id: number; state: string; fingerprint: string[] }
    expect(p.peer_id).toBe(-1)
    expect(p.state).toBe('established')
    expect(p.fingerprint).toHaveLength(12)
  })

  it('sync (responder, requested): перезапоминает pub инициатора и бродкастит secretRequest', async () => {
    const { deps, events, getState } = makeDeps()
    const mgr = createSecretManager(deps)
    const initiatorKp = await generateKeyPair()
    const initiatorPub = b64FromBytes(await exportPublicKey(initiatorKp.publicKey))
    getState.handshake = { _: 'encryptedChatRequested', id: 1, date: 1, admin_id: 2, participant_id: 3, g_a: initiatorPub }
    await mgr.sync(1, 3) // meId = responder
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe(RT.secretRequest)
    // pub перезапомнен → accept работает без stashRequest
    const { fingerprint } = await mgr.accept(1)
    expect(fingerprint).toHaveLength(12)
  })

  it('sync (initiator, requested): бродкастит secretRequest (bridge смапит в awaiting), pub не трогает', async () => {
    const { deps, events, getState } = makeDeps()
    const mgr = createSecretManager(deps)
    getState.handshake = { _: 'encryptedChatRequested', id: 1, date: 1, admin_id: 2, participant_id: 3, g_a: 'x' }
    await mgr.sync(1, 2) // meId = initiator
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe(RT.secretRequest)
    const p = events[0].payload as { initiator_id: number; responder_id: number }
    expect(p.initiator_id).toBe(2)
    expect(p.responder_id).toBe(3)
  })

  it('sync (initiator, accepted, ключа нет): доводит ключ из responder_pub и бродкастит established', async () => {
    const { deps, events, getState } = makeDeps()
    const mgr = createSecretManager(deps)
    await mgr.start(3) // savePending(-1) — инициатор
    const responderKp = await generateKeyPair()
    const responderPub = b64FromBytes(await exportPublicKey(responderKp.publicKey))
    getState.handshake = { _: 'encryptedChat', id: 1, date: 1, admin_id: 2, participant_id: 3, g_a_or_b: responderPub }
    await mgr.sync(-1, 2)
    expect(await loadPending(-1)).toBeNull() // ключ доведён, pending очищен
    const accept = events.find((e) => e.event === RT.secretAccept)!
    expect(accept).toBeDefined()
    const p = accept.payload as { state: string; fingerprint: string[] }
    expect(p.state).toBe('established')
    expect(p.fingerprint).toHaveLength(12)
  })

  it('sync (accepted, ключ уже есть): бродкастит established из локального ключа', async () => {
    const { deps, events, getState } = makeDeps()
    const mgr = createSecretManager(deps)
    // получатель уже вывел ключ на accept
    const initiatorKp = await generateKeyPair()
    const initiatorPub = b64FromBytes(await exportPublicKey(initiatorKp.publicKey))
    mgr.stashRequest(1, initiatorPub)
    await mgr.accept(1)
    getState.handshake = { _: 'encryptedChat', id: 1, date: 1, admin_id: 2, participant_id: 3, g_a_or_b: 'z' }
    await mgr.sync(1, 3) // meId = responder (ключ есть)
    const accept = events.find((e) => e.event === RT.secretAccept)!
    expect(accept).toBeDefined()
    expect((accept.payload as { state: string }).state).toBe('established')
  })

  it('sync (rejected): бродкастит secretReject', async () => {
    const { deps, events, getState } = makeDeps()
    const mgr = createSecretManager(deps)
    // Отказ и разрыв сошлись в ОДИН конструктор.
    getState.handshake = { _: 'encryptedChatDiscarded', id: 1 }
    await mgr.sync(1, 3)
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe(RT.secretReject)
  })

  it('sync: ошибка GET (404/нет доступа) не бросается и ничего не бродкастит', async () => {
    const { deps, events, getState } = makeDeps()
    const mgr = createSecretManager(deps)
    getState.err = new Error('403 forbidden')
    await expect(mgr.sync(1, 3)).resolves.toBeUndefined()
    expect(events).toHaveLength(0)
  })
})
