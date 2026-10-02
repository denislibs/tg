import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TME_ORIGIN } from '@config/app'

const applyHash = vi.fn(async () => {})
vi.mock('./useUrlSync', () => ({ applyHash }))

const { openSearchUrl } = await import('./openSearchUrl')

describe('openSearchUrl — своя ссылка открывается внутри, как t.me', () => {
  it('свой хост ссылок: <tme>/username/N → #@username/N', () => {
    openSearchUrl(`${DEFAULT_TME_ORIGIN}/durov/12`, {} as never)
    expect(applyHash).toHaveBeenLastCalledWith('#@durov/12', {})
  })

  it('https://t.me/username → #@username (как было)', () => {
    openSearchUrl('https://t.me/durov', {} as never)
    expect(applyHash).toHaveBeenLastCalledWith('#@durov', {})
  })
})
