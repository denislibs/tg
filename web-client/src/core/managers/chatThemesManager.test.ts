// src/core/managers/chatThemesManager.test.ts
// Task 4 (действия без оптимистики): setChatTheme зовёт владельца ПОСЛЕ успешного
// REST-ответа (порт tweb invokeApi(...).then(saveUpdate)), а на ошибке — не
// зовёт вовсе.
import { describe, it, expect, vi } from 'vitest'
import { newChatThemesManager } from './chatThemesManager'
import type { RestClient } from '../net/restClient'

const fakeDialogs = () => ({ applyTheme: vi.fn() })

describe('ChatThemesManager', () => {
  it('setChatTheme PUTs /chats/{id}/theme с theme_id, затем зовёт dialogs.applyTheme', async () => {
    const puts: { path: string; body: unknown }[] = []
    const rest = { put: vi.fn(async (path: string, body: unknown) => { puts.push({ path, body }) }) } as unknown as RestClient
    const dialogs = fakeDialogs()
    const mgr = newChatThemesManager({ rest, dialogs })

    await mgr.setChatTheme(9, 'sunset')

    expect(puts).toEqual([{ path: '/chats/9/theme', body: { theme_id: 'sunset' } }])
    expect(dialogs.applyTheme).toHaveBeenCalledWith(9, 'sunset')
  })

  it('setChatTheme("") сбрасывает тему и передаёт пустую строку применялке', async () => {
    const rest = { put: vi.fn(async () => {}) } as unknown as RestClient
    const dialogs = fakeDialogs()
    const mgr = newChatThemesManager({ rest, dialogs })

    await mgr.setChatTheme(9, '')

    expect(dialogs.applyTheme).toHaveBeenCalledWith(9, '')
  })

  it('RPC упал — dialogs.applyTheme не зовётся', async () => {
    const rest = { put: vi.fn(async () => { throw new Error('offline') }) } as unknown as RestClient
    const dialogs = fakeDialogs()
    const mgr = newChatThemesManager({ rest, dialogs })

    await expect(mgr.setChatTheme(9, 'sunset')).rejects.toThrow('offline')
    expect(dialogs.applyTheme).not.toHaveBeenCalled()
  })
})
