import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { generateKeyPair, exportPublicKey, b64FromBytes } from '../secret/crypto'
import { loadPending } from '../secret/keyStore'
import { createSecretManager, type SecretDeps } from './secretManager'
import { RT } from '../realtime/events'

// Свежий IndexedDB на каждый тест — ключи/pending не текут между кейсами.
beforeEach(() => { indexedDB = new IDBFactory() })

interface RestCall { url: string; body: unknown }
// Настраиваемый ответ GET /secret_chats/{id} для sync-тестов.
type Handshake = { chat_id: number; initiator_id: number; responder_id: number; state: string; initiator_pub?: string; responder_pub?: string }

function makeDeps() {
  const restCalls: RestCall[] = []
  const getCalls: string[] = []
  const sends: Parameters<SecretDeps['conn']['sendMessage']>[0][] = []
  const events: { event: string; payload: unknown }[] = []
  const uploads: { bytes: ArrayBuffer; mime: string; size: number; fileName?: string }[] = []
  // Тест выставляет handshake (или бросает) перед вызовом sync.
  const getState = { handshake: null as Handshake | null, err: null as Error | null }
  const deps: SecretDeps = {
    rest: {
      get: async <T,>(url: string): Promise<T> => {
        getCalls.push(url)
        if (getState.err) throw getState.err
        return getState.handshake as unknown as T
      },
      post: async <T,>(url: string, body: unknown): Promise<T> => {
        restCalls.push({ url, body })
        if (url === '/secret_chats') return { chat_id: 1, state: 'requested' } as unknown as T
        return {} as T
      },
    },
    conn: { sendMessage: (args) => { sends.push(args) } },
    broadcast: (event, payload) => { events.push({ event, payload }) },
    upload: async (bytes, mime, size, fileName) => { uploads.push({ bytes, mime, size, fileName }); return 42 },
  }
  return { deps, restCalls, getCalls, sends, events, uploads, getState }
}

describe('secretManager', () => {
  it('start: генерит пару, постит pub на /secret_chats, сохраняет pending', async () => {
    const { deps, restCalls } = makeDeps()
    const mgr = createSecretManager(deps)
    const { chatId } = await mgr.start(2)
    expect(chatId).toBe(1)
    expect(restCalls).toHaveLength(1)
    expect(restCalls[0].url).toBe('/secret_chats')
    const body = restCalls[0].body as { peer_id: number; pub: string }
    expect(body.peer_id).toBe(2)
    expect(typeof body.pub).toBe('string')
    expect(body.pub.length).toBeGreaterThan(0)
    // приватный ключ инициатора сохранён локально до accept
    expect(await loadPending(1)).not.toBeNull()
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

    const payload = { text: 'секрет 🔒', entities: [{ type: 'bold', offset: 0, length: 6 }] }
    const res = await mgr.sendText({ chatId: 1, text: payload.text, entities: payload.entities, clientMsgId: 'cm1', ttlSeconds: 30 })
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
    const res = await mgr.sendMedia({ chatId: 1, bytes, name: 'pic.jpg', mime: 'image/jpeg', size: 10, mediaType: 'photo', clientMsgId: 'cm2', ttlSeconds: null })
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

  it('sendText без ключа чата бросает ошибку', async () => {
    const { deps } = makeDeps()
    const mgr = createSecretManager(deps)
    await expect(mgr.sendText({ chatId: 99, text: 'x', clientMsgId: 'c', ttlSeconds: null })).rejects.toThrow(/key missing/)
  })

  it('decryptMessage без ключа → null; на битом blob → null', async () => {
    const { deps } = makeDeps()
    const mgr = createSecretManager(deps)
    expect(await mgr.decryptMessage(99, 'garbage')).toBeNull()
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
    await mgr.start(2) // savePending(1)
    const responderKp = await generateKeyPair()
    const responderPub = b64FromBytes(await exportPublicKey(responderKp.publicKey))
    await mgr.complete(1, responderPub)
    expect(await loadPending(1)).toBeNull()
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe(RT.secretAccept)
    const p = events[0].payload as { chat_id: number; state: string; fingerprint: string[] }
    expect(p.chat_id).toBe(1)
    expect(p.state).toBe('established')
    expect(p.fingerprint).toHaveLength(12)
  })

  it('sync (responder, requested): перезапоминает pub инициатора и бродкастит secretRequest', async () => {
    const { deps, events, getState } = makeDeps()
    const mgr = createSecretManager(deps)
    const initiatorKp = await generateKeyPair()
    const initiatorPub = b64FromBytes(await exportPublicKey(initiatorKp.publicKey))
    getState.handshake = { chat_id: 1, initiator_id: 2, responder_id: 3, state: 'requested', initiator_pub: initiatorPub }
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
    getState.handshake = { chat_id: 1, initiator_id: 2, responder_id: 3, state: 'requested', initiator_pub: 'x' }
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
    await mgr.start(3) // savePending(1) — инициатор
    const responderKp = await generateKeyPair()
    const responderPub = b64FromBytes(await exportPublicKey(responderKp.publicKey))
    getState.handshake = { chat_id: 1, initiator_id: 2, responder_id: 3, state: 'accepted', responder_pub: responderPub }
    await mgr.sync(1, 2)
    expect(await loadPending(1)).toBeNull() // ключ доведён, pending очищен
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
    getState.handshake = { chat_id: 1, initiator_id: 2, responder_id: 3, state: 'accepted', responder_pub: 'z' }
    await mgr.sync(1, 3) // meId = responder (ключ есть)
    const accept = events.find((e) => e.event === RT.secretAccept)!
    expect(accept).toBeDefined()
    expect((accept.payload as { state: string }).state).toBe('established')
  })

  it('sync (rejected): бродкастит secretReject', async () => {
    const { deps, events, getState } = makeDeps()
    const mgr = createSecretManager(deps)
    getState.handshake = { chat_id: 1, initiator_id: 2, responder_id: 3, state: 'rejected' }
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
