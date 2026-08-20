// src/core/managers/chatThemesManager.test.ts
//
// Локальной применялки у менеджера БОЛЬШЕ НЕТ (решение Р7): тема живёт в полной
// карточке пира (`chatFull`/`userFull.theme_emoticon`), а не в строке диалога,
// и владельца-в-воркере у карточек не заведено. Смену применяет читатель
// карточки на главном потоке — проектор кадра `chat_theme_update` поверх
// `core/chatFullCache.ts` (см. `core/chatFullCache.test.ts`).
import { describe, it, expect, vi } from 'vitest'
import { newChatThemesManager } from './chatThemesManager'
import type { RestClient } from '../net/restClient'

describe('ChatThemesManager', () => {
  it('setChatTheme PUTs /chats/{id}/theme с theme_id', async () => {
    const puts: { path: string; body: unknown }[] = []
    const rest = { put: vi.fn(async (path: string, body: unknown) => { puts.push({ path, body }) }) } as unknown as RestClient
    const mgr = newChatThemesManager({ rest })

    await mgr.setChatTheme(9, 'sunset')

    expect(puts).toEqual([{ path: '/chats/9/theme', body: { theme_id: 'sunset' } }])
  })

  it('setChatTheme("") сбрасывает тему — пустая строка едет как есть', async () => {
    const puts: { path: string; body: unknown }[] = []
    const rest = { put: vi.fn(async (path: string, body: unknown) => { puts.push({ path, body }) }) } as unknown as RestClient
    const mgr = newChatThemesManager({ rest })

    await mgr.setChatTheme(9, '')

    expect(puts).toEqual([{ path: '/chats/9/theme', body: { theme_id: '' } }])
  })

  it('RPC упал — ошибка пробрасывается вызывающему', async () => {
    const rest = { put: vi.fn(async () => { throw new Error('offline') }) } as unknown as RestClient
    const mgr = newChatThemesManager({ rest })

    await expect(mgr.setChatTheme(9, 'sunset')).rejects.toThrow('offline')
  })
})
