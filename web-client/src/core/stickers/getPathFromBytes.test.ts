import { describe, expect, it } from 'vitest'
import getPathFromBytes, { createSvgFromBase64, createSvgFromBytes } from './getPathFromBytes'

// Реальный контур из выгрузки (`backend/assets/stickers/abcemoji/meta.json`,
// `2.tgs`, поле `path`, base64) — не в git (untracked assets, `.gitignore`
// оставляет только `duck/`+`animated_emoji/`), поэтому байты зашиты сюда
// литералом. Максимальная координата в этом пути — 471: реальные контуры
// авторятся в системе координат канваса ~512×512, а не в единицах пикселей
// ячейки на экране — важно для теста слоя в StickerMedia.silhouette.test.tsx.
const REAL_PATH_B64 =
  'GQivAdxGBYBMBGdPB0kDekkGaFcCtF4AhwJ3kQBulwSRj46kpKm4h59lq3uwYohxZkcFc3hdSgiVTAKHA1G+lJAAiQiPAb9HsUcJiwh0i4WaiKORjo6Ao0mvY7VJAYgITwaIBw=='
const REAL_PATH_D =
  'M258,471c-65,0-124-39-157-93-58-96-40-232,52-300,72-55,170-46,234,17,15,14,36,36,41,56,7,31-37,43-59,48-34,8-49-38-75-51-56-29-108,21-122,73-17,62,20,160,98,151,63-7,49-79,118-52,11,5,26,8,35,17,14,14,0,35-9,47-35,53-91,88-156,87z'

describe('getPathFromBytes', () => {
  // Синтетическая последовательность байт — каждый байт бьёт в свою ветку
  // алгоритма Telegram (см. https://core.telegram.org/api/files#vector-thumbnails):
  //   204        -> буква из lookup-таблицы (num >= 192)          -> 'M'
  //   5          -> цифра без разделителя (num < 64)               -> '5'
  //   70         -> цифра с минусом (64 <= num < 128, 70&63=6)      -> '-6'
  //   130        -> цифра с запятой (128 <= num < 192, 130&63=2)    -> ',2'
  //   199        -> буква из lookup-таблицы                        -> 'H'
  // Дополняет реальный кейс ниже: тот бьёт не во все ветки одинаково явно,
  // этот прицельно проверяет каждую границу диапазона по отдельности.
  it('разбирает контур по формату photoPathSize', () => {
    const d = getPathFromBytes(new Uint8Array([204, 5, 70, 130, 199]))
    expect(d).toBe('MM5-6,2Hz')
  })

  it('пустой контур — просто M...z', () => {
    expect(getPathFromBytes(new Uint8Array([]))).toBe('Mz')
  })

  // Реальные байты (не синтетика) — ревью L6: синтетика с маленькими числами
  // не ловит класс багов, завязанных на реальный масштаб координат (до ~500).
  it('разбирает реальный контур из выгрузки побайтово верно', () => {
    const bin = atob(REAL_PATH_B64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

    expect(getPathFromBytes(bytes)).toBe(REAL_PATH_D)
  })
})

describe('createSvgFromBytes', () => {
  it('строит svg с viewBox из переданных размеров и непустым d, начинающимся с M', () => {
    const { svg, path } = createSvgFromBytes(new Uint8Array([204, 5, 70, 130, 199]), 100, 80)

    expect(svg.tagName).toBe('svg')
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 80')
    expect(svg.contains(path)).toBe(true)

    const d = path.getAttribute('d')
    expect(d).toBeTruthy()
    expect(d?.startsWith('M')).toBe(true)
  })

  it('без явных размеров падает на дефолт 512x512 (tweb createSvgFromBytes)', () => {
    const { svg } = createSvgFromBytes(new Uint8Array([204]))
    expect(svg.getAttribute('viewBox')).toBe('0 0 512 512')
  })
})

describe('createSvgFromBase64', () => {
  it('декодирует base64 и строит тот же svg, что и createSvgFromBytes', () => {
    const built = createSvgFromBase64(REAL_PATH_B64, 320, 512)

    expect(built).toBeDefined()
    expect(built!.svg.getAttribute('viewBox')).toBe('0 0 320 512')
    expect(built!.path.getAttribute('d')).toBe(REAL_PATH_D)
  })

  // Minor (ревью L6): сеть/бэк не гарантируют валидность чужих данных — битая
  // base64 не должна бросать исключение в теле вызывающего эффекта, только
  // сигнализировать об отсутствии результата.
  it('на битой base64 не бросает, а возвращает undefined', () => {
    expect(createSvgFromBase64('not-valid-base64!!!')).toBeUndefined()
  })
})
