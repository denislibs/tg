import { sessionKv } from '../store/sessionKv'

const KEY = 'session_token'

// Holds the session token in memory (for synchronous RestClient reads) and
// persists it to IndexedDB so it survives reload. Под код-паролем — только в
// зашифрованном слое (`sessionKv`): `load()` ждёт ключ, то есть до разблокировки
// токена в памяти нет, и `RestClient` (гейт `ready()`) не шлёт ни одного запроса.
export class TokenStore {
  private token: string | null = null
  private loadPromise: Promise<void> | null = null

  /** Load the persisted token into memory (call once at worker start). Memoized. */
  load(): Promise<void> {
    this.loadPromise ??= this._load()
    return this.loadPromise
  }

  /** Resolves once the initial load has completed. */
  ready(): Promise<void> {
    return this.loadPromise ?? this.load()
  }

  private async _load(): Promise<void> {
    this.token = (await sessionKv.get<string>(KEY)) ?? null
  }

  get(): string | null {
    return this.token
  }

  async set(token: string): Promise<void> {
    this.token = token
    await sessionKv.set(KEY, token)
  }

  async clear(): Promise<void> {
    this.token = null
    await sessionKv.delete(KEY)
  }
}
