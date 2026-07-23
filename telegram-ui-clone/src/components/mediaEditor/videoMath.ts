// Чистая математика редактирования видео (без DOM/WebCodecs) — тестируется в
// vitest. Диапазон трима, покадровый план (таймстампы кадров при энкоде),
// выбор кодека/битрейта и размер выходного кадра. Порт tweb
// finalRender/{calcCodecAndBitrate,constants,getResultSize}.

/** Кадров в секунду при энкоде результата (tweb EXPECTED_FPS/BITRATE_TARGET_FPS). */
export const ENCODE_FPS = 30

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

// Пресеты кодека 1:1 с tweb calcCodecAndBitrate/constants.
export const DEFAULT_CODEC = { codec: 'avc1.42001f', width: 1280, height: 720, bitrate: 14e6 }
export const HIGH_RES_CODEC = { codec: 'avc1.4d4028', width: 1920, height: 1080, bitrate: 20e6 }

/** Диапазон трима в секундах из долей crop-рамки тайм-лайна и длительности. */
export interface TrimRange {
  startSec: number
  endSec: number
  durationSec: number
}

export function trimRange(duration: number, cropStart: number, cropLength: number): TrimRange {
  if (!(duration > 0)) return { startSec: 0, endSec: 0, durationSec: 0 }
  const a = clamp(cropStart, 0, 1) * duration
  const b = clamp(cropStart + cropLength, 0, 1) * duration
  const startSec = Math.min(a, b)
  const endSec = Math.max(a, b)
  return { startSec, endSec, durationSec: Math.max(0, endSec - startSec) }
}

/** Число кадров энкода для диапазона длиной durationSec при данном fps (минимум 1). */
export function frameCount(durationSec: number, fps: number = ENCODE_FPS): number {
  return Math.max(1, Math.round(durationSec * fps))
}

/** Время исходника (сек) для кадра i диапазона (не выходит за конец трима). */
export function frameMediaTime(trim: TrimRange, i: number, fps: number = ENCODE_FPS): number {
  return Math.min(trim.startSec + i / fps, trim.endSec)
}

/** Таймстамп кадра i в микросекундах, относительно начала трима (для VideoFrame). */
export function frameTimestampUs(i: number, fps: number = ENCODE_FPS): number {
  return Math.round((i / fps) * 1e6)
}

/** Абсолютное время обложки (сек) из доли позиции метки на тайм-лайне. */
export function thumbnailTime(duration: number, position: number): number {
  return clamp(position, 0, 1) * (duration > 0 ? duration : 0)
}

/**
 * Минимальная длина трима в долях (tweb videoControls minLength): не даём
 * обрезать короче 0.5 сек. Для видео короче 0.5 сек — вся длина.
 */
export function minTrimLength(duration: number): number {
  if (!(duration > 0)) return 0
  return Math.min(1, 0.5 / duration)
}

/** Кодек и битрейт для кадра w×h (порт tweb calcCodecAndBitrate). */
export function calcCodecAndBitrate(w: number, h: number, fps: number = ENCODE_FPS): { codec: string; bitrate: number } {
  const base = h > DEFAULT_CODEC.height || w > DEFAULT_CODEC.width ? HIGH_RES_CODEC : DEFAULT_CODEC
  const bitrate = Math.round((w * h * fps) / (base.width * base.height * ENCODE_FPS) * base.bitrate)
  return { codec: base.codec, bitrate: Math.max(1, bitrate) }
}

// Вписать соотношение сторон ratio в бокс maxW×maxH (порт snapToViewport tweb).
function snapToViewport(ratio: number, maxW: number, maxH: number): [number, number] {
  let w = maxW
  let h = maxH
  if (maxW / maxH > ratio) w = maxH * ratio
  else h = maxW / ratio
  return [w, h]
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

/**
 * Размер выходного кадра видео из размера crop-рамки (пиксели исходника):
 * не увеличиваем сверх нативного, но вписываем в бокс кодека (tweb getResultSize
 * для videoType 'video' → highResCodec 1920×1080); стороны чётные (нужно H.264).
 */
export function outputSize(cropW: number, cropH: number, maxW: number = HIGH_RES_CODEC.width, maxH: number = HIGH_RES_CODEC.height): { width: number; height: number } {
  const cw = Math.max(1, cropW)
  const ch = Math.max(1, cropH)
  let w = cw
  let h = ch
  if (w > maxW || h > maxH) {
    [w, h] = snapToViewport(cw / ch, maxW, maxH)
  }
  return { width: even(w), height: even(h) }
}
