// Порт tweb `src/helpers/onMediaLoad.ts` — «медиа готово играть» промисом.
//
// Зачем отдельный хелпер, а не слушатель на месте: событие готовности зависит от
// платформы (iOS не шлёт `canplay` до жеста — там ждут `loadeddata`), а ошибку
// нужно уметь ПРОГЛОТИТЬ (см. `shouldIgnoreVideoError`), не роняя вызывающего.
// Оба правила обязаны быть в одном месте — иначе каждый потребитель (враппер
// видео, вьювер, плеер) переизобретает их по-своему.
//
// НЕ ПОРТИРОВАНА ветка crbug 1250841 (`appDocsManager.fixChromiumMp4` →
// `tryPatchMp4`): это перезапись `esds`-атома mp4 на стороне владельца файла с
// повторной выдачей нового URL. Механизм у нас ЕСТЬ, но живёт только в
// DNP-канале (`mediaManager.streamUrl` добавляет `&mp4fix=1`, патч делает
// SW-сборщик 206); чтобы им закрыть и токенный путь, нужен новый метод
// менеджера-владельца (скачать → пропатчить → отдать blob-URL) — это работа в
// воркере, вне периметра враппера. Детект тут оставлен: без него ошибка
// молча гасится и видео «просто не играет».
import { IS_APPLE_MOBILE } from '@environment/userAgent'

// tweb `helpers/fixChromiumMp4.constants.ts` 1:1
export const CRBUG_1250841_ERROR = 'DECODER_ERROR_NOT_SUPPORTED: Audio configuration specified 2 channels, but FFmpeg thinks the file contains 1 channels'

export function isCrbug1250841Error(err: MediaError): boolean {
  return err.code === 4 && err.message === CRBUG_1250841_ERROR
}

/**
 * Порт tweb `shouldIgnoreVideoError`: ошибку, которая ничего не значит для
 * пользователя (гонка `URL safety check` при подмене src), глотаем — иначе
 * бабл получит красный крест на ровном месте.
 */
export function shouldIgnoreVideoError(e: Event): boolean {
  try {
    const target = e.target as HTMLVideoElement
    const error = target.error

    if (!error || error.message.includes('URL safety check')) {
      console.warn('will ignore video error', e)
      return true
    }

    if (isCrbug1250841Error(error)) {
      // см. шапку: чинить нечем, но знать об этом надо
      console.error('chrome video error', e)
    }
  } catch { /* empty */ }

  return false
}

/** Порт tweb `onMediaLoad` 1:1. */
export default function onMediaLoad(
  media: HTMLMediaElement,
  readyState = media.HAVE_METADATA,
  useCanplayOnIos?: boolean,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (media.readyState >= readyState) {
      resolve()
      return
    }

    const loadEventName = IS_APPLE_MOBILE && !useCanplayOnIos ? 'loadeddata' : 'canplay'
    const errorEventName = 'error'
    const onLoad = () => {
      media.removeEventListener(errorEventName, onError)
      resolve()
    }
    const onError = (e: Event) => {
      if (shouldIgnoreVideoError(e)) {
        return
      }

      media.removeEventListener(loadEventName, onLoad)
      media.removeEventListener(errorEventName, onError)
      reject(media.error)
    }
    media.addEventListener(loadEventName, onLoad, { once: true })
    media.addEventListener(errorEventName, onError)
  })
}
