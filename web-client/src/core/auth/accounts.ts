// Реестр аккаунтов для мультиаккаунта (Telegram: до нескольких сессий в одном
// клиенте). Живёт в том же idb (msgr/kv, ключ 'accounts'); токены хранятся
// здесь же (в воркере), наружу отдаётся санитизированный список без токенов.
// Переключение = смена активного session_token + перезагрузка страницы (воркер
// мемоизирует токен, reload переинициализирует WS/сторы/sync с нуля).
import { idbGet, idbSet } from '../store/idbKv'

const KEY = 'accounts'
export const MAX_ACCOUNTS = 4

export interface Account {
  token: string
  id: number
  name: string
  avatarUrl: string
  phone: string
}

export type PublicAccount = Omit<Account, 'token'>

export async function listAccounts(): Promise<Account[]> {
  try {
    return (await idbGet<Account[]>(KEY)) ?? []
  } catch {
    return [] // idb недоступен (напр. тестовое окружение) — фича мягко деградирует
  }
}

// upsert по id: обновляет профиль/токен существующего или добавляет новый.
export async function upsertAccount(a: Account): Promise<void> {
  try {
    const list = await listAccounts()
    const idx = list.findIndex((x) => x.id === a.id)
    if (idx >= 0) list[idx] = a
    else list.push(a)
    await idbSet(KEY, list)
  } catch { /* idb недоступен */ }
}

export async function removeAccount(id: number): Promise<Account[]> {
  const list = (await listAccounts()).filter((x) => x.id !== id)
  try { await idbSet(KEY, list) } catch { /* idb недоступен */ }
  return list
}

export async function tokenOf(id: number): Promise<string | null> {
  return (await listAccounts()).find((x) => x.id === id)?.token ?? null
}

export const toPublic = (a: Account): PublicAccount => ({ id: a.id, name: a.name, avatarUrl: a.avatarUrl, phone: a.phone })
