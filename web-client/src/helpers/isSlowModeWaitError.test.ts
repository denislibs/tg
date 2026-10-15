import { describe, expect, it } from 'vitest'
import isSlowModeWaitError from './isSlowModeWaitError'

describe('isSlowModeWaitError', () => {
  it('HttpError-подобный объект и Error из RPC с SLOWMODE_WAIT_N', () => {
    expect(isSlowModeWaitError({ type: 'SLOWMODE_WAIT_30' })).toBe(true)
    expect(isSlowModeWaitError(new Error('SLOWMODE_WAIT_5'))).toBe(true)
  })

  it('прочие отказы и не-ошибки — нет', () => {
    expect(isSlowModeWaitError(new Error('forbidden'))).toBe(false)
    expect(isSlowModeWaitError({ type: 'FLOOD_WAIT_5' })).toBe(false)
    expect(isSlowModeWaitError(undefined)).toBe(false)
    expect(isSlowModeWaitError('SLOWMODE_WAIT_5')).toBe(false)
  })
})
