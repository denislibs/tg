import { useEffect, useState } from 'react'
import { startClient } from '../../client/bootstrap'

export const WAVE_BARS = 44

const cache = new Map<number, number[]>()
const inflight = new Map<number, Promise<number[]>>()

type AC = typeof AudioContext

// Decode an audio file and reduce it to WAVE_BARS peak amplitudes (0..1) — a
// real waveform, computed identically on every client, so no server storage.
export async function computeWaveform(mediaId: number, url: string): Promise<number[]> {
  const hit = cache.get(mediaId)
  if (hit) return hit
  const running = inflight.get(mediaId)
  if (running) return running

  const job = (async () => {
    const resp = await fetch(url)
    const raw = await resp.arrayBuffer()
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
  })()
  inflight.set(mediaId, job)
  try {
    return await job
  } finally {
    inflight.delete(mediaId)
  }
}

// React hook: returns the decoded waveform for a media id (empty until ready).
export function useWaveform(mediaId: number): number[] {
  const [bars, setBars] = useState<number[]>(() => cache.get(mediaId) ?? [])
  useEffect(() => {
    const hit = cache.get(mediaId)
    if (hit) {
      setBars(hit)
      return
    }
    let alive = true
    void startClient()
      .managers.media.contentUrl(mediaId)
      .then((url) => computeWaveform(mediaId, url))
      .then((b) => {
        if (alive) setBars(b)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [mediaId])
  return bars
}
