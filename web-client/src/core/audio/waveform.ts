import { useEffect, useState } from 'react'
import { decryptMedia } from '../secret/crypto'
import { mediaContentUrl, primeMediaToken, resolveMediaContentUrl } from '../mediaUrl'

export const WAVE_BARS = 44

// Секретный трек (E2E): байты приходят ciphertext'ом, их надо расшифровать.
export interface WaveSecret { keyB64: string; ivB64: string }

const cache = new Map<number, number[]>()
const inflight = new Map<number, Promise<number[]>>()

type AC = typeof AudioContext

// Reduce raw audio bytes to WAVE_BARS peak amplitudes (0..1) — a real waveform,
// computed identically on every client, so no server storage. Cached per mediaId.
async function decodeBars(mediaId: number, raw: ArrayBuffer): Promise<number[]> {
  const Ctor: AC = window.AudioContext || (window as unknown as { webkitAudioContext: AC }).webkitAudioContext
  const ac = new Ctor()
  try {
    const audio = await ac.decodeAudioData(raw.slice(0))
    const ch = audio.getChannelData(0)
    const block = Math.max(1, Math.floor(ch.length / WAVE_BARS))
    const bars: number[] = []
    let max = 0.0001
    for (let i = 0; i < WAVE_BARS; i++) {
      let peak = 0
      const start = i * block
      for (let j = 0; j < block; j++) {
        const v = Math.abs(ch[start + j] || 0)
        if (v > peak) peak = v
      }
      bars.push(peak)
      if (peak > max) max = peak
    }
    const norm = bars.map((b) => Math.max(0.08, b / max))
    cache.set(mediaId, norm)
    return norm
  } finally {
    void ac.close()
  }
}

// Decode a (plain or secret) audio file into a waveform. `getRaw` fetches the
// bytes: обычный трек — прямой контент, секретный — расшифрованный ciphertext.
async function computeWaveformWith(mediaId: number, getRaw: () => Promise<ArrayBuffer>): Promise<number[]> {
  const hit = cache.get(mediaId)
  if (hit) return hit
  const running = inflight.get(mediaId)
  if (running) return running
  const job = getRaw().then((raw) => decodeBars(mediaId, raw))
  inflight.set(mediaId, job)
  try {
    return await job
  } finally {
    inflight.delete(mediaId)
  }
}

export async function computeWaveform(mediaId: number, url: string): Promise<number[]> {
  return computeWaveformWith(mediaId, async () => (await fetch(url)).arrayBuffer())
}

// React hook: returns the decoded waveform for a media id (empty until ready).
// secret — расшифровать ciphertext (голос в E2E-чате).
export function useWaveform(mediaId: number, secret?: WaveSecret): number[] {
  const [bars, setBars] = useState<number[]>(() => cache.get(mediaId) ?? [])
  const keyB64 = secret?.keyB64
  const ivB64 = secret?.ivB64
  useEffect(() => {
    const hit = cache.get(mediaId)
    if (hit) {
      setBars(hit)
      return
    }
    let alive = true
    const raw = keyB64 && ivB64
      ? computeWaveformWith(mediaId, async () => {
          await primeMediaToken()
          const res = await fetch(mediaContentUrl(mediaId))
          if (!res.ok) throw new Error(`secret audio ${res.status}`)
          return decryptMedia(await res.arrayBuffer(), keyB64, ivB64)
        })
      : Promise.resolve(resolveMediaContentUrl(mediaId)).then((url) => computeWaveform(mediaId, url))
    void raw.then((b) => { if (alive) setBars(b) }).catch(() => {})
    return () => {
      alive = false
    }
  }, [mediaId, keyB64, ivB64])
  return bars
}
