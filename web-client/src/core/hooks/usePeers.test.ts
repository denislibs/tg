import { describe, it, expect } from 'vitest'
import { peersKey } from './usePeers'

describe('peersKey', () => {
  it('sorts ids ascending', () => {
    expect(peersKey([3, 1, 2])).toBe('1,2,3')
  })

  it('dedupes repeated ids', () => {
    expect(peersKey([2, 2, 1, 1])).toBe('1,2')
  })

  it('is order-independent (same key for any permutation)', () => {
    expect(peersKey([5, 9, 1])).toBe(peersKey([1, 5, 9]))
  })

  it('returns an empty string for no ids', () => {
    expect(peersKey([])).toBe('')
  })
})
