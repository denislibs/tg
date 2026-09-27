// S10 — шифрование хранилищ под код-паролем, воркерная половина
// (`passcodeWorker.ts` + `store/sessionKv.ts` + `lib/encryptedStorageLayer.ts`),
// порт tweb `mainWorker/index.worker.ts:246-333`, `lib/localStorage.ts`,
// `lib/encryptedStorageLayer.ts`.
//
// Предмет — то, что лежит НА ДИСКЕ (fake-IndexedDB `msgr/kv`, localStorage,
// sessionStorage) и что уходит В СЕТЬ: под кодом нет открытого токена/реестра
// аккаунтов/outbox и нет ключа; смена и выключение; старт под замком не шлёт ни
// одного запроса, пока ключ не пришёл; «хвосты» до шифрования вливаются и
// стираются; «забыли код» стирает всё без ключа.
//
// Каждый тест — «свежий воркер»: `vi.resetModules()` даёт новые статики
// `EncryptionKeyStore`/`DeferredIsUsingPasscode` (у воркера они свои), диск
// (fake-IDB) живёт между реалмами, пока тест его не сменит.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TOKEN = 'tok-SECRET-session-1234567890'
const OTHER_TOKEN = 'tok-OTHER-account-0987654321'

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function realm() {
  const kv = await import('../store/idbKv')
  const { newPasscodeWorker } = await import('./passcodeWorker')
  const { PASSCODE_CHANNEL } = await import('./protocol')
  const { TokenStore } = await import('../auth/tokenStore')
  const accounts = await import('../auth/accounts')
  const { sessionKv } = await import('../store/sessionKv')
  const EncryptionKeyStore = (await import('@lib/passcode/keyStore')).default
  const DeferredIsUsingPasscode = (await import('@lib/passcode/deferredIsUsingPasscode')).default
  const utils = await import('@lib/passcode/utils')
  const { RestClient } = await import('../net/restClient')

  const events: { port: string, event: unknown }[] = []
  const mkPort = (name: string) => ({
    name,
    emit: (channel: string, event: unknown) => {
      expect(channel).toBe(PASSCODE_CHANNEL)
      events.push({ port: name, event })
    },
  })
  const source = mkPort('source')
  const other = mkPort('other')
  const clearPersist = vi.fn(async() => {})
  const selfTerminate = vi.fn()
  const worker = newPasscodeWorker({ ports: [source, other], clearPersist, selfTerminate })

  return {
    kv, worker, source, other, events, clearPersist, selfTerminate,
    TokenStore, accounts, sessionKv, EncryptionKeyStore, DeferredIsUsingPasscode, utils, RestClient,
  }
}

type Realm = Awaited<ReturnType<typeof realm>>

/** Всё содержимое `msgr/kv` — ключ → значение. */
async function dumpKv(): Promise<Map<string, unknown>> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('msgr', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const out = new Map<string, unknown>()
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if(!cursor) return resolve()
      out.set(cursor.key as string, cursor.value)
      cursor.continue()
    }
    req.onerror = () => reject(req.error)
  })
  db.close()
  return out
}

const rawKey = async(key: CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', key))
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

function containsBytes(hay: Uint8Array, needle: Uint8Array) {
  outer: for(let i = 0; i + needle.length <= hay.length; i++) {
    for(let j = 0; j < needle.length; j++) if(hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

/** На диске и в web storage нет ни открытых секретов, ни ключа — ни в каком виде. */
async function expectNoSecretsAtRest(key: CryptoKey, secrets: string[]) {
  const raw = await rawKey(key)
  const dump = await dumpKv()
  for(const [name, value] of dump) {
    const asText = value instanceof Uint8Array ? new TextDecoder().decode(value) : JSON.stringify(value) ?? ''
    for(const secret of secrets) expect(asText, `открытый секрет в msgr/kv["${name}"]`).not.toContain(secret)
    expect(value, `ключ в msgr/kv["${name}"]`).not.toBeInstanceOf(CryptoKey)
    if(value instanceof Uint8Array) expect(containsBytes(value, raw), `raw-ключ в msgr/kv["${name}"]`).toBe(false)
    expect(asText, `base64-ключ в msgr/kv["${name}"]`).not.toContain(b64(raw))
  }
  for(const store of [localStorage, sessionStorage]) {
    for(let i = 0; i < store.length; i++) {
      const value = store.getItem(store.key(i)!) ?? ''
      expect(value).not.toContain(b64(raw))
      for(const secret of secrets) expect(value).not.toContain(secret)
    }
  }
}

/** Вход до кода: токен и реестр аккаунтов открыто, как было всегда. */
async function login(r: Realm) {
  const tokens = new r.TokenStore()
  await tokens.set(TOKEN)
  await r.accounts.upsertAccount({ token: TOKEN, id: 1, name: 'A', photoId: 0, phone: '+1' })
  await r.accounts.upsertAccount({ token: OTHER_TOKEN, id: 2, name: 'B', photoId: 0, phone: '+2' })
  await r.sessionKv.set('outbox', [{ clientMsgId: 'c1', text: 'unsent secret text' }])
  return tokens
}

/** Как `lib/passcode/actions.ts::enablePasscode`: запись на диск, ключ — воркеру. */
async function enable(r: Realm, passcode: string) {
  const { verificationHash, verificationSalt, encryptionSalt, encryptionKey } =
    await r.utils.createEncryptionArtifactsForPasscode(passcode)
  await r.kv.idbSet('passcode', { verificationHash, verificationSalt, encryptionSalt })
  await r.worker.handle(r.source, { method: 'toggleUsingPasscode', payload: { isUsingPasscode: true, encryptionKey } })
  return { encryptionKey, encryptionSalt }
}

describe('включение: ключи аккаунтов — только в зашифрованном слое', () => {
  it('в msgr/kv нет session_token/accounts/outbox, есть kv__encrypted; ключа нет нигде', async() => {
    const r = await realm()
    await login(r)
    expect((await dumpKv()).get('session_token')).toBe(TOKEN) // до кода — открыто

    const { encryptionKey } = await enable(r, '1234')

    const dump = await dumpKv()
    expect(dump.has('session_token')).toBe(false)
    expect(dump.has('accounts')).toBe(false)
    expect(dump.has('outbox')).toBe(false)
    expect(dump.get('kv__encrypted')).toBeInstanceOf(Uint8Array)
    await expectNoSecretsAtRest(encryptionKey, [TOKEN, OTHER_TOKEN, 'unsent secret text'])
  })

  it('чтение/запись после включения идут через слой: значения на месте, на диске открытыми не появляются', async() => {
    const r = await realm()
    await login(r)
    const { encryptionKey } = await enable(r, '1234')

    expect((await r.accounts.listAccounts()).map((a) => a.token)).toEqual([TOKEN, OTHER_TOKEN])
    const tokens = new r.TokenStore()
    await tokens.load()
    expect(tokens.get()).toBe(TOKEN)

    await tokens.set('tok-NEW-after-passcode-555')
    await expectNoSecretsAtRest(encryptionKey, ['tok-NEW-after-passcode-555', TOKEN])
  })

  it('рассылка «кроме источника»: соседняя вкладка получает флаг и ключ, источник — нет', async() => {
    const r = await realm()
    const { encryptionKey } = await enable(r, '1234')
    expect(r.events).toEqual([
      { port: 'other', event: { method: 'toggleUsingPasscode', payload: { isUsingPasscode: true, encryptionKey } } },
    ])
  })
})

describe('старт под замком: без ключа нет ни токена, ни сети', () => {
  it('REST ждёт ключ: fetch не зовётся, пока не пришёл saveEncryptionKey; затем — с токеном', async() => {
    const first = await realm()
    await login(first)
    const { encryptionKey } = await enable(first, '1234')

    vi.resetModules() // новый воркер: ключа в памяти нет
    const r = await realm()
    const fetchSpy = vi.fn(async() => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)

    expect(await r.worker.handle(r.source, { method: 'isLocked' })).toEqual({ isUsingPasscode: true, isLocked: true })

    const tokens = new r.TokenStore()
    const rest = new r.RestClient('/api', () => tokens.get(), () => tokens.ready())
    const request = rest.get('/me')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(tokens.get()).toBeNull()

    await r.worker.handle(r.source, { method: 'saveEncryptionKey', payload: encryptionKey })
    await request

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    // ключ разошёлся соседям, а спросившей вкладке isLocked теперь отдаёт его сам
    expect(r.events).toContainEqual({ port: 'other', event: { method: 'saveEncryptionKey', payload: encryptionKey } })
    r.events.length = 0
    expect(await r.worker.handle(r.source, { method: 'isLocked' })).toEqual({ isUsingPasscode: true, isLocked: false })
    expect(r.events).toEqual([{ port: 'source', event: { method: 'saveEncryptionKey', payload: encryptionKey } }])
  })

  it('без кода isLocked отвечает «не заперто», ключ никому не шлётся', async() => {
    const r = await realm()
    expect(await r.worker.handle(r.source, { method: 'isLocked' })).toEqual({ isUsingPasscode: false, isLocked: false })
    expect(r.events).toEqual([])
  })
})

describe('смена кода', () => {
  it('перешифровка новым ключом: старым ключом блоб не читается, новым — всё на месте', async() => {
    const r = await realm()
    await login(r)
    const { encryptionKey: oldKey } = await enable(r, '1234')
    const { verificationHash, verificationSalt, encryptionSalt, encryptionKey: newKey } =
      await r.utils.createEncryptionArtifactsForPasscode('9999')

    await r.worker.handle(r.source, {
      method: 'changePasscode',
      payload: { toStore: { verificationHash, verificationSalt, encryptionSalt }, encryptionKey: newKey },
    })

    const blob = (await dumpKv()).get('kv__encrypted') as Uint8Array
    const { decryptLocalData } = await import('@lib/crypto/aesLocal')
    await expect(decryptLocalData({ key: oldKey, encryptedData: blob })).rejects.toBeTruthy()
    const data = JSON.parse(new TextDecoder().decode(await decryptLocalData({ key: newKey, encryptedData: blob })))
    expect(data.session_token).toBe(TOKEN)
    expect((await dumpKv()).get('passcode')).toMatchObject({ encryptionSalt })
    await expectNoSecretsAtRest(newKey, [TOKEN, OTHER_TOKEN])
    await expectNoSecretsAtRest(oldKey, [])
  })
})

describe('выключение кода', () => {
  it('значения возвращаются открытыми, зашифрованного слоя нет, ключ забыт', async() => {
    const r = await realm()
    await login(r)
    await enable(r, '1234')

    await r.worker.handle(r.source, { method: 'toggleUsingPasscode', payload: { isUsingPasscode: false } })

    const dump = await dumpKv()
    expect(dump.get('session_token')).toBe(TOKEN)
    expect((dump.get('accounts') as { token: string }[]).map((a) => a.token)).toEqual([TOKEN, OTHER_TOKEN])
    expect(dump.has('kv__encrypted')).toBe(false)
    expect(r.EncryptionKeyStore.getUndeferred()).toBeNull()
  })
})

describe('миграция: код включали до шифрования хранилищ', () => {
  it('открытые хвосты вливаются в слой при первом чтении с ключом и стираются', async() => {
    const first = await realm()
    await login(first)
    // запись старого формата: соли ключа нет, токены лежат открытыми
    const { verificationHash, verificationSalt } = await first.utils.createEncryptionArtifactsForPasscode('1234')
    await first.kv.idbSet('passcode', { verificationHash, verificationSalt })

    vi.resetModules()
    const r = await realm()
    const tokens = new r.TokenStore()
    const loading = tokens.load()
    // вкладка создала соль и вывела ключ (lib/passcode/actions.ts::unlockWithPasscode)
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await r.utils.deriveEncryptionKey('1234', salt)
    await r.worker.handle(r.source, { method: 'saveEncryptionKey', payload: key })
    await loading

    expect(tokens.get()).toBe(TOKEN)
    expect((await r.accounts.listAccounts()).map((a) => a.id)).toEqual([1, 2])
    const dump = await dumpKv()
    expect(dump.has('session_token')).toBe(false)
    expect(dump.has('accounts')).toBe(false)
    expect(dump.has('outbox')).toBe(false)
    await expectNoSecretsAtRest(key, [TOKEN, OTHER_TOKEN, 'unsent secret text'])
  })
})

describe('«забыли код»: forceLogout', () => {
  it('без ключа стирает оба слоя, запись кода, офлайн-стор и корзину; вкладкам — reload, воркер завершается', async() => {
    const first = await realm()
    await login(first)
    await enable(first, '1234')

    vi.resetModules() // экран блокировки: ключа нет
    const r = await realm()
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      open: async() => ({}),
      delete: async(name: string) => { deleted.push(name); return true },
    })

    await r.worker.handle(r.source, { method: 'forceLogout' })

    const dump = await dumpKv()
    for(const key of ['session_token', 'accounts', 'outbox', 'kv__encrypted', 'passcode']) expect(dump.has(key)).toBe(false)
    expect(r.clearPersist).toHaveBeenCalledTimes(1)
    expect(deleted).toContain('cachedFiles')
    expect(r.events).toEqual([
      { port: 'source', event: { method: 'reload' } },
      { port: 'other', event: { method: 'reload' } },
    ])
    expect(r.selfTerminate).toHaveBeenCalledTimes(1)
  })
})

describe('замок других вкладок и terminate', () => {
  it('toggleLockOthers рассылает toggleLock всем, кроме источника; terminate завершает воркер', async() => {
    const r = await realm()
    await r.worker.handle(r.source, { method: 'toggleLockOthers', payload: false })
    expect(r.events).toEqual([{ port: 'other', event: { method: 'toggleLock', payload: false } }])
    await r.worker.handle(r.source, { method: 'terminate' })
    expect(r.selfTerminate).toHaveBeenCalledTimes(1)
  })
})
