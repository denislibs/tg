// Поведенческий пин видео-ветки `renderImageFromUrl` (порт tweb
// `helpers/dom/renderImageFromUrl.ts:39-41`).
//
// Почему именно эта ветка: у видео назначение `src` НЕ означает готовности —
// в этот момент readyState === 0, кадра нет, размеров нет. tweb поэтому
// пропускает колбэк через `onMediaLoad(elem)` (ждёт `canplay`). Первая редакция
// нашего порта звала колбэк сразу после `src` — самосогласованно, но не так:
// вызывающий получал управление раньше, чем видео стало готово.
import { describe, expect, it } from 'vitest'

import renderImageFromUrl from '@helpers/dom/renderImageFromUrl'

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('renderImageFromUrl — видео', () => {
  it('назначает src сразу, но колбэк придерживает до готовности (onMediaLoad)', async () => {
    const video = document.createElement('video')
    let called = 0

    const promise = renderImageFromUrl(video, 'blob:vid', () => {
      ++called
    })

    // src ставится синхронно — как в оригинале
    expect(video.getAttribute('src')).toBe('blob:vid')

    // ...а колбэк ещё нет: readyState 0, событие готовности не приходило
    await flush()
    expect(called).toBe(0)

    video.dispatchEvent(new Event('canplay'))
    await promise
    expect(called).toBe(1)
  })

  it('готовое видео (readyState >= HAVE_METADATA) зовёт колбэк без ожидания события', async () => {
    const video = document.createElement('video')
    // happy-dom не объявляет константы HTMLMediaElement (HAVE_METADATA и т.д.
    // приходят `undefined`), а `onMediaLoad` берёт порог именно из них —
    // подставляем браузерные значения, иначе ранний выход недостижим в принципе.
    Object.defineProperty(video, 'HAVE_METADATA', { value: 1, configurable: true })
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true })
    let called = 0

    await renderImageFromUrl(video, 'blob:ready', () => {
      ++called
    })

    expect(called).toBe(1)
  })

  it('без колбэка возвращает undefined и не заводит ожидание', () => {
    const video = document.createElement('video')
    expect(renderImageFromUrl(video, 'blob:no-cb')).toBeUndefined()
    expect(video.getAttribute('src')).toBe('blob:no-cb')
  })
})
