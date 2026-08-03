import type { CipherState } from './noise/symmetricState'

// Верхняя граница payload одного кадра (совпадает с бэкендом ws maxMessageSize).
export const MAX_FRAME_LEN = 1 << 20
const EMPTY_AD = new Uint8Array(0)

// Формат кадра: u32 big-endian длина + payload. Над WS префикс избыточен (границы
// даёт сам WS), но закладываем единообразно с бэком ради будущего сырого-TCP носителя.
export function frameLen(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length)
  new DataView(out.buffer).setUint32(0, payload.length, false) // big-endian
  out.set(payload, 4)
  return out
}

export function unframeLen(raw: Uint8Array): Uint8Array {
  if (raw.length < 4) throw new Error('dnp: short frame header')
  const n = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, false)
  if (n > MAX_FRAME_LEN) throw new Error('dnp: frame too large')
  if (n !== raw.length - 4) throw new Error('dnp: frame length mismatch')
  return raw.subarray(4)
}

// Транспортный кадр: [len][encrypt(pt)], AD пустой.
export function sealFrame(cs: CipherState, plaintext: Uint8Array): Uint8Array {
  return frameLen(cs.encryptWithAd(EMPTY_AD, plaintext))
}

export function openFrame(cs: CipherState, raw: Uint8Array): Uint8Array {
  return cs.decryptWithAd(EMPTY_AD, unframeLen(raw))
}
