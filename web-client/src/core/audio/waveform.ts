import { useEffect, useState } from 'react'
import { decryptMedia, b64ToBytes } from '../secret/crypto'
import { mediaContentUrl, primeMediaToken, resolveMediaContentUrl } from '../mediaUrl'
import { unpack5bit, WAVEFORM_SAMPLES_COUNT } from './voiceWaveformAnalyser'

export const WAVE_BARS = 44

// Бары из ПЕРЕДАННЫХ пиков (посчитаны при записи, 1:1 tweb): base64 → 5-бит
// распаковка (100 значений 0..31) → ресэмпл к n баров (0..1, пол 0.08 как у
// recompute). Приоритетнее client-recompute: одинаково у всех получателей,
// не требует скачивания/декода аудиофайла.
export function decodeTransmittedBars(waveformB64: string, n = WAVE_BARS): number[] {
  if (!waveformB64) return []
  let bytes: Uint8Array
  try {
    bytes = b64ToBytes(waveformB64)
  } catch {
    return []
  }
  if (!bytes.length) return []
  const vals = unpack5bit(bytes, WAVEFORM_SAMPLES_COUNT)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const idx = Math.floor((i * vals.length) / n)
    out.push(Math.max(0.08, vals[idx] / 31))
  }
  return out
}

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
