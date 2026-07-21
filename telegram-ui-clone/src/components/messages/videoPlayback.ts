// Чистые хелперы кастомных видео-контролов лайтбокса. Вынесены из компонента,
// чтобы покрыть тестами без DOM. Референс — tweb (toHHMMSS, MediaProgressLine
// .setLoadProgress, playbackRateButton rates).

/** Набор скоростей воспроизведения (tweb rates урезан до вьюер-набора). */
export const VIDEO_RATES = [0.5, 1, 1.5, 2] as const

/** TimeRanges-подобный объект (video.buffered) — минимум для расчёта буфера. */
export interface TimeRangesLike {
  length: number
  start(index: number): number
  end(index: number): number
}

// Формат mm:ss (или h:mm:ss при длительности ≥ часа) — 1:1 с tweb toHHMMSS:
// минуты дополняются нулём только когда есть часы, секунды — всегда.
export function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total - h * 3600) / 60)
  const s = total - h * 3600 - m * 60
  const mm = h > 0 && m < 10 ? `0${m}` : `${m}`
  const ss = s < 10 ? `0${s}` : `${s}`
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// Конец ближайшего к currentTime загруженного диапазона (tweb setLoadProgress):
// берём диапазон, чей start ≤ currentTime и максимален, — его end.
export function bufferedEnd(buffered: TimeRangesLike, currentTime: number): number {
  let nearestStart = 0
  let end = 0
  for (let i = 0; i < buffered.length; i++) {
    const start = buffered.start(i)
    if (currentTime >= start && start >= nearestStart) {
      nearestStart = start
      end = buffered.end(i)
    }
  }
  return end
}

// Процент буферизации (0..100) — end ближайшего диапазона к длительности.
export function bufferedPercent(buffered: TimeRangesLike, currentTime: number, duration: number): number {
  if (!duration || !Number.isFinite(duration)) return 0
  const end = bufferedEnd(buffered, currentTime)
  return Math.max(0, Math.min(100, (end / duration) * 100))
}

// Следующая скорость из списка (циклически). Неизвестная текущая → первый элемент.
export function nextRate(current: number, rates: readonly number[] = VIDEO_RATES): number {
  const idx = rates.indexOf(current)
  if (idx === -1) return rates[0]
  return rates[(idx + 1) % rates.length]
}
