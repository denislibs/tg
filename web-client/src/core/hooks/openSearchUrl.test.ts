import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TME_ORIGIN } from '@config/app'

const openUsername = vi.fn(async () => {})
vi.mock('@lib/appImManager', () => ({ default: { openUsername } }))

const { openSearchUrl } = await import('./openSearchUrl')

describe('openSearchUrl — своя ссылка открывается внутри, как t.me', () => {
  it('свой хост ссылок: <tme>/username/N → openUsername с номером сообщения', () => {
    openSearchUrl(`${DEFAULT_TME_ORIGIN}/durov/12`)
    expect(openUsername).toHaveBeenLastCalledWith({ userName: 'durov', lastMsgId: 12 })
  })

  it('https://t.me/username → openUsername без номера', () => {
    openSearchUrl('https://t.me/durov')
    expect(openUsername).toHaveBeenLastCalledWith({ userName: 'durov', lastMsgId: undefined })
  })
})
