import { describe, it, expect } from 'vitest'
import { fingerprintEmoji } from './fingerprint'

describe('fingerprintEmoji', () => {
  it('детерминирован и даёт 12 эмодзи', () => {
    const fp = new Uint8Array(32).map((_, i) => i) // 0..31
    const a = fingerprintEmoji(fp)
    const b = fingerprintEmoji(fp)
    expect(a).toEqual(b)
    expect(a).toHaveLength(12)
  })
  it('разный fingerprint → разный результат', () => {
    const x = fingerprintEmoji(new Uint8Array(32).fill(1))
    const y = fingerprintEmoji(new Uint8Array(32).fill(2))
    expect(x).not.toEqual(y)
  })
})
