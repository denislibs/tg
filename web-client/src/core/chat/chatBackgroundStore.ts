// Порт tweb `src/lib/chatBackgroundStore.ts` (812502980) в объёме, который у нас
// есть чем наполнить: адрес файла обоев по slug (`getBackground`), размытая
// копия (`blurWallPaperImage`, `blur(url, 12, 4)`) и засев адресом локального
// файла на время отгрузки (`setBackgroundUrlToCache`/`deleteBackgroundUrlFromCache`).
//
// Расхождение О-40 (у строк ниже): у tweb файл обоев — документ серверных обоев
// (`getWallPaperBySlug` + `downloadMediaURL`) с постоянным кэшем
// `CacheStorageController('cachedBackgrounds')` и общими между вкладками
// object URL (`createSharedObjectURL`). Серверных обоев у нас нет (О-11): своё
// фото — обычное медиа, и его адрес отдаёт медиа-конвейер (`cachedMediaUrl` —
// синхронное зеркало, `ensureMediaUrl` — единственная точка входа за ним),
// который сам держит постоянный кэш. Поэтому здесь только память вкладки.
import blur from '@helpers/blur'
import { cachedMediaUrl } from '@core/mediaCache'
import { ensureMediaUrl } from '@core/media/ensureMediaUrl'
import { getMediaIdFromWallPaperSlug } from '@/wallpapers'

type GetBackgroundArgs = {
  slug: string
  blur?: boolean
}

const backgroundPromises: { [storageUrl: string]: string | Promise<string> } = {}

const getWallPaperStorageUrl = (slug: string, blur?: boolean) => `backgrounds/${slug}${blur ? '?blur' : ''}`

const ChatBackgroundStore = {
  /**
   * tweb `:88-148`. Строка — адрес уже есть (фон покажет обои без перехода),
   * промис — файл ещё едет.
   */
  getBackground({ slug, blur: needBlur }: GetBackgroundArgs): string | Promise<string> {
    const storageUrl = getWallPaperStorageUrl(slug, needBlur)
    const existing = backgroundPromises[storageUrl]
    if(existing) {
      return existing
    }

    // О-40: вместо документа серверных обоев — медиа по id из slug.
    const mediaId = getMediaIdFromWallPaperSlug(slug)
    if(mediaId === undefined) {
      return Promise.reject(new Error('NO_ENTRY_FOUND'))
    }

    const cached = cachedMediaUrl(mediaId)
    if(cached !== undefined && !needBlur) {
      return backgroundPromises[storageUrl] = cached
    }

    const promise = (cached !== undefined ? Promise.resolve(cached) : ensureMediaUrl(mediaId)).then((url) => {
      return needBlur ? ChatBackgroundStore.blurWallPaperImage(url) : url
    }).then((url) => {
      if(backgroundPromises[storageUrl] === promise) {
        backgroundPromises[storageUrl] = url
      }
      return url
    })
    // * a transient failure must not stay cached — let the next call retry (tweb :141-145)
    promise.catch(() => {
      if(backgroundPromises[storageUrl] === promise) {
        delete backgroundPromises[storageUrl]
      }
    })
    backgroundPromises[storageUrl] = promise
    return promise
  },

  /** tweb `:150-155`. */
  blurWallPaperImage(url: string) {
    const { canvas, promise } = blur(url, 12, 4)
    return promise.then(() => {
      return canvas.toDataURL()
    })
  },

  /** tweb `:181-187` — засев адресом локального файла (превью отгрузки). */
  setBackgroundUrlToCache({ slug, url, blur }: GetBackgroundArgs & { url: string }) {
    backgroundPromises[getWallPaperStorageUrl(slug, blur)] = url
  },

  /** tweb `:189-199`; object URL освобождает его создатель (вкладка «Обои»). */
  deleteBackgroundUrlFromCache({ slug, blur }: GetBackgroundArgs) {
    delete backgroundPromises[getWallPaperStorageUrl(slug, blur)]
  },
}

export default ChatBackgroundStore
