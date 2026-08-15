import { describe, expect, it } from 'vitest'
import getPathFromBytes, { createSvgFromBytes } from './getPathFromBytes'

describe('getPathFromBytes', () => {
  // Синтетическая последовательность байт (реальный photoPathSize из выгрузки
  // недоступен в этом ворктри) — но каждый байт бьёт в свою ветку алгоритма
  // Telegram (см. https://core.telegram.org/api/files#vector-thumbnails):
  //   204        -> буква из lookup-таблицы (num >= 192)          -> 'M'
  //   5          -> цифра без разделителя (num < 64)               -> '5'
  //   70         -> цифра с минусом (64 <= num < 128, 70&63=6)      -> '-6'
  //   130        -> цифра с запятой (128 <= num < 192, 130&63=2)    -> ',2'
  //   199        -> буква из lookup-таблицы                        -> 'H'
  it('разбирает контур по формату photoPathSize', () => {
    const d = getPathFromBytes(new Uint8Array([204, 5, 70, 130, 199]))
    expect(d).toBe('MM5-6,2Hz')
  })

  it('пустой контур — просто M...z', () => {
    expect(getPathFromBytes(new Uint8Array([]))).toBe('Mz')
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
