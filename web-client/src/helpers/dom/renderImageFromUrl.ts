// Порт tweb `src/helpers/dom/renderImageFromUrl.ts` в объёме вьювера (Task 13):
// назначение src с decode-гейтом (`loader.decode()` до колбэка — недекодированная
// картинка при drawImage/свапе даёт пустой кадр) и кэшем уже загруженных URL
// (blob:-URL декодируются один раз — повторный рендер синхронный).
// Не портированы (помечено):
//   • SVGImageElement-ветка (`setAttributeNS href`) — SVG-медиа у нас нет;
//   • `processImageOnLoad` — ни один наш вызов его не передаёт;
//   • видео-колбэк через `onMediaLoad(elem)` — хелпера onMediaLoad в дереве ещё
//     нет, приедет с vanilla-плеером в Task 15; до него видео-ветка зовёт
//     колбэк сразу после назначения src (у картинок поведение 1:1).

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
    callback?.() // видео: onMediaLoad-ожидание — Task 15 (см. шапку)
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
