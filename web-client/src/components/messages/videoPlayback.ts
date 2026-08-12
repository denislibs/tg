// Чистые хелперы видео-контролов (потребитель — vanilla-плеер @lib/mediaPlayer;
// React-плеер лайтбокса снесён в Task 16 вместе с bufferedEnd/bufferedPercent).
// Референс — tweb (toHHMMSS, playbackRateButton rates).

/** Набор скоростей воспроизведения — tweb `mediaPlayer/playbackRateButton.tsx:23`. */
export const VIDEO_RATES = [0.5, 1, 1.5, 2, 3] as const

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

// Подпись кнопки скорости — tweb playbackRateButton: `1.0` → `1x`, `0.5` → `0.5`.
// Каждый символ рисуется отдельным глифом моноширинной «геометрической» гарнитуры,
// поэтому наружу отдаём строку, а не готовый текст.
export function rateToString(rate: number): string {
  return rate.toFixed(1).replace(/\.0$/, 'x')
}
