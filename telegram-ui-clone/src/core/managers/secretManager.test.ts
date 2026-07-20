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

function makeDeps() {
  const restCalls: RestCall[] = []
  const sends: Parameters<SecretDeps['conn']['sendMessage']>[0][] = []
  const events: { event: string; payload: unknown }[] = []
  const deps: SecretDeps = {
    rest: {
      post: async <T,>(url: string, body: unknown): Promise<T> => {
        restCalls.push({ url, body })
        if (url === '/secret_chats') return { chat_id: 1, state: 'requested' } as unknown as T
        return {} as T
      },
    },
    conn: { sendMessage: (args) => { sends.push(args) } },
    broadcast: (event, payload) => { events.push({ event, payload }) },
  }
  return { deps, restCalls, sends, events }
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
})
