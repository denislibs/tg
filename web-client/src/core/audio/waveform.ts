import { useEffect, useState } from 'react'
import mediaSizes from '@core/dom/mediaSizes'
import clamp from '@helpers/number/clamp'
import { decryptMedia, b64ToBytes } from '../secret/crypto'
// mediaContentUrl здесь — БАЙТЫ аудио для декода волны (fetch + decodeAudioData),
// не картинка: Task 7 (перевод картинок на downloadMediaURL) их не трогает.
import { mediaContentUrl, primeMediaToken, resolveMediaContentUrl } from '../mediaUrl'
import { unpack5bit, WAVEFORM_BYTES_LENGTH, WAVEFORM_SAMPLES_COUNT } from './voiceWaveformAnalyser'

// ПЕРЕДАННЫЕ пики (посчитаны при записи): base64 → 5-бит распаковка в СЫРЫЕ
// значения 0..31, как у tweb `decodeWaveform`. Приоритетнее client-recompute:
// одинаковы у всех получателей и не требуют скачивания/декода аудиофайла.
// Сведение к барам и высотам — `buildWaveformBars` (порт createWaveformBars).
export function decodeTransmittedPeaks(waveformB64: string): number[] {
  if (!waveformB64) return []
  let bytes: Uint8Array
  try {
    bytes = b64ToBytes(waveformB64)
  } catch {
    return []
  }
  if (!bytes.length) return []
  // 1:1 tweb `wrapVoiceMessage`: `decodeWaveform(waveform.slice(0, 63))` — не
  // больше 63 байт (100 сэмплов), число значений выводится из длины буфера.
  return unpack5bit(bytes.slice(0, WAVEFORM_BYTES_LENGTH))
}

// ── Геометрия волны — порт tweb `createWaveformBars` (components/audio.ts:83-126)
const BAR_WIDTH = 2
const BAR_MARGIN = 2
const BAR_HEIGHT_MIN = 4
// tweb: `mediaSizes.isMobile && false ? 16 : 23` (audio.ts:86) — мобильная
// высота отключена константой `&& false` в самом оригинале, поэтому здесь
// только 23; ветки-предмета нет.
const BAR_HEIGHT_MAX = 23
// Ширина волны — пара по текущему экрану (tweb audio.ts:88-89): 152/190 на
// мобиле против 190/256 на десктопе. Владелец факта один — `mediaSizes`
// (`core/dom/mediaSizes.ts`, порт tweb `helpers/mediaSizes.ts`).
const WAVE_MIN_W_MOBILE = 152
const WAVE_MAX_W_MOBILE = 190
const WAVE_MIN_W_DESKTOP = 190
const WAVE_MAX_W_DESKTOP = 256

export const WAVEFORM_BAR_WIDTH = BAR_WIDTH
export const WAVEFORM_BAR_MARGIN = BAR_MARGIN
export const WAVEFORM_HEIGHT = BAR_HEIGHT_MAX

/**
 * Сводит пики (0..31) к барам с высотами В ПИКСЕЛЯХ — 1:1 tweb: ширина волны
 * растёт с длительностью (190..256px), число баров = availW / (2+2), а сами
 * пики агрегируются МАКСИМУМОМ по группе и нормируются на максимум записи —
 * поэтому тихие места остаются низкими, а не сливаются в сплошную полосу.
 */
export function buildWaveformBars(peaks: number[], duration: number): { bars: number[]; width: number } {
  const minW = mediaSizes.isMobile ? WAVE_MIN_W_MOBILE : WAVE_MIN_W_DESKTOP
  const maxW = mediaSizes.isMobile ? WAVE_MAX_W_MOBILE : WAVE_MAX_W_DESKTOP

  const wfSize = peaks.length
  if (!wfSize) return { bars: [], width: minW }

  const availW = clamp((duration / 60) * maxW, minW, maxW)
  const barCount = Math.min((availW / (BAR_WIDTH + BAR_MARGIN)) | 0, wfSize)
  const normValue = Math.max(...peaks)
  const maxDelta = BAR_HEIGHT_MAX - BAR_HEIGHT_MIN

  const out: number[] = []
  let maxValue = 0
  let sumI = 0
  for (let i = 0; i < wfSize; ++i) {
    const value = peaks[i] || 0
    if (sumI + barCount >= wfSize) {
      sumI = sumI + barCount - wfSize
      if (sumI < (barCount + 1) / 2) {
        if (maxValue < value) maxValue = value
      }
      out.push(Math.max((maxValue * maxDelta + (normValue + 1) / 2) / (normValue + 1), BAR_HEIGHT_MIN))
      maxValue = sumI < (barCount + 1) / 2 ? 0 : value
    } else {
      if (maxValue < value) maxValue = value
      sumI += barCount
    }
  }
  return { bars: out, width: availW }
}

// Секретный трек (E2E): байты приходят ciphertext'ом, их надо расшифровать.
export interface WaveSecret { keyB64: string; ivB64: string }

const cache = new Map<number, number[]>()
const inflight = new Map<number, Promise<number[]>>()

type AC = typeof AudioContext

// Фолбэк для сообщений без переданных пиков: считаем их сами из аудио —
// ровно столько же сэмплов, сколько кладёт в документ запись (100), иначе
// buildWaveformBars упрётся в их число и нарисует меньше баров, чем tweb.
// Значения нормализуются к 0..1; кэш — по mediaId.
async function decodeBars(mediaId: number, raw: ArrayBuffer): Promise<number[]> {
  const Ctor: AC = window.AudioContext || (window as unknown as { webkitAudioContext: AC }).webkitAudioContext
  const ac = new Ctor()
  try {
    const audio = await ac.decodeAudioData(raw.slice(0))
    const ch = audio.getChannelData(0)
    const block = Math.max(1, Math.floor(ch.length / WAVEFORM_SAMPLES_COUNT))
    const bars: number[] = []
    let max = 0.0001
    for (let i = 0; i < WAVEFORM_SAMPLES_COUNT; i++) {
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
//
// ПРЕДМЕТА В tweb НЕТ: оригинал волну из аудиофайла не считает НИКОГДА — пики
// приезжают в документе сообщения (documentAttributeAudio.waveform). Пересчёт
// остаётся ровно одному сценарию — голос в СЕКРЕТНОМ чате: сервер видит там
// только шифртекст, посчитать и сохранить пики ему не с чего, а секретных чатов
// у tweb нет вовсе. Отсюда `enabled`: обычное голосовое сюда не ходит.
export function useWaveform(mediaId: number, secret?: WaveSecret, enabled = true): number[] {
  const [bars, setBars] = useState<number[]>(() => (enabled ? cache.get(mediaId) ?? [] : []))
  const keyB64 = secret?.keyB64
  const ivB64 = secret?.ivB64
  useEffect(() => {
    if (!enabled) return
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
  }, [mediaId, keyB64, ivB64, enabled])
  return bars
}
