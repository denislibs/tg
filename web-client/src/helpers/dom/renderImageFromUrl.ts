// Порт tweb `src/helpers/dom/renderImageFromUrl.ts` в объёме вьювера (Task 13):
// назначение src с decode-гейтом (`loader.decode()` до колбэка — недекодированная
// картинка при drawImage/свапе даёт пустой кадр) и кэшем уже загруженных URL
// (blob:-URL декодируются один раз — повторный рендер синхронный).
// Не портированы (помечено):
//   • SVGImageElement-ветка (`setAttributeNS href`) — SVG-медиа у нас нет;
//   • `processImageOnLoad` — ни один наш вызов его не передаёт.
//
// Видео-ветка (`onMediaLoad(elem).then(callback)`, tweb :39-41) восстановлена:
// в первой редакции этого порта её обошли колбэком сразу после назначения src,
// потому что `helpers/onMediaLoad.ts` тогда ещё не был портирован. Он приехал —
// отступление устарело. Ждать здесь обязательно: у видео назначение `src` НЕ
// означает готовности, и колбэк «сразу» отдаёт вызывающему элемент с
// readyState 0 — кадра ещё нет, размеров ещё нет.
import onMediaLoad from '@helpers/onMediaLoad'

export const loadedURLs: { [url: string]: boolean } = {}

const set = (elem: HTMLElement | HTMLImageElement | HTMLVideoElement, url: string) => {
  if (elem instanceof HTMLImageElement || elem instanceof HTMLVideoElement) elem.src = url
  else elem.style.backgroundImage = 'url(' + url + ')'
}

// проблема функции в том, что она не подходит для ссылок, пригодна только для
// blob'ов, потому что обычным ссылкам нужен 'load' каждый раз (комментарий tweb)
export default function renderImageFromUrl(
  elem: HTMLElement | HTMLImageElement | HTMLVideoElement,
  url: string,
  callback?: () => void,
  useCache = true,
): void | Promise<void> {
  if (!url) {
    console.error('renderImageFromUrl: no url?', elem, url)
    callback?.()
    return
  }

  const isVideo = elem instanceof HTMLVideoElement
  if ((loadedURLs[url] && useCache) || isVideo) {
    set(elem, url)

    if (callback) {
      if (isVideo) {
        return onMediaLoad(elem).then(callback)
      }

      callback()
    }

    return
  }

  const isImage = elem instanceof HTMLImageElement
  const loader = isImage ? elem : new Image()

  const onLoad = () => {
    if (!isImage) {
      set(elem, url)
    }

    loadedURLs[url] = true
    callback?.()
  }

  const onError = (err: DOMException) => {
    if (!err.message?.includes('cannot be decoded')) {
      console.error('Render image from url failed:', err, url, loader)
    }

    callback?.()
  }

  loader.decoding = 'async'
  loader.src = url
  return loader.decode().then(onLoad, onError)
}

export function renderImageFromUrlPromise(
  elem: Parameters<typeof renderImageFromUrl>[0],
  url: string,
  useCache?: boolean,
) {
  return new Promise<void>((resolve) => {
    void renderImageFromUrl(elem, url, resolve, useCache)
  })
}
