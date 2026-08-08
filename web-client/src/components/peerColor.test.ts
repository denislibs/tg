import { describe, it, expect } from 'vitest'
import { PEER_COLORS, peerColorIndex, peerColorById, hexToRgbTriplet } from './peerColor'

describe('peerColor', () => {
  it('палитра 1:1 с tweb (getPeerColorById.ts:5)', () => {
    expect(PEER_COLORS).toEqual(['#CC5049', '#D67722', '#955CDB', '#40A920', '#309EBA', '#368AD1', '#C7508B'])
  })

  it('индекс = abs(peerId) % 7 (getPeerColorById.ts:10-12)', () => {
    expect(peerColorIndex(0)).toBe(0)
    expect(peerColorIndex(7)).toBe(0)
    expect(peerColorIndex(9)).toBe(2)
    expect(peerColorIndex(-9)).toBe(2) // чаты приходят с отрицательным id
    expect(peerColorById(444077753)).toBe(PEER_COLORS[444077753 % 7])
  })

  it('hex → триплет для --peer-color-rgb', () => {
    expect(hexToRgbTriplet('#CC5049')).toBe('204, 80, 73')
    expect(hexToRgbTriplet('#fff')).toBe('255, 255, 255')
  })
})
