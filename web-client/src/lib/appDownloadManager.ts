/**
 * Ванильный аналог tweb `src/lib/appDownloadManager.ts` в объёме файла-документа
 * (`components/wrappers/document.ts`): один владелец скачивания файла на диск,
 * который отдаёт `CancellablePromise` с прогрессом `{done, total}` и отменой.
 *
 * Именно такую форму ждёт `ProgressivePreloader` (`components/preloader.ts`,
 * порт tweb): `attach(el, false, promise)` подписывается на `addNotifyListener`
 * и рисует дугу кольца, а `onClick` зовёт `promise.cancel()`. Поэтому наш
 * стрим-фетч завёрнут в `deferredPromise`, а не отдан как «голый» `fetch`, —
 * иначе кольцо не с чем связать.
 *
 * ОТЛИЧИЯ ОТ ОРИГИНАЛА (следствие транспорта, не вкусовщина):
 *   • у tweb загрузка идёт через `apiFileManager` (MTProto, чанки, докачка),
 *     у нас — прямой `fetch` по токен-URL медиа-эндпоинта. Это санкционированный
 *     путь для БАЙТОВ не-картинок («МОЖНО: bytes прямым fetch», web-client/CLAUDE.md):
 *     бинарь идёт на главный поток, а не сериализуется через worker-RPC;
 *   • `downloadMediaURL`/`getUpload`/`downloadToDisc(…, onlyCache)` не портированы:
 *     URL картинок у нас принадлежит воркеру (`core/media/ensureMediaUrl`), а
 *     прогресс АПЛОАДА живёт в `stores/uploadsStore` и приезжает в бабл отдельно —
 *     ветка `uploadingFileName` враппера документа поэтому тоже не портирована
 *     (см. шапку `components/wrappers/document.ts`).
 */
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import makeError from '@helpers/makeError'
import { resolveMediaContentUrl } from '@core/mediaUrl'

export interface DownloadArgs {
  /** файл на медиа-эндпоинте (у tweb — `doc.id` документа MTProto) */
  mediaId: number
  /** имя, под которым файл ляжет на диск (tweb `doc.file_name`) */
  fileName: string
  /** MIME для Blob (tweb `doc.mime_type`) */
  mime?: string
  /** размер из сообщения — `total` прогресса, пока не пришёл `content-length` */
  size?: number
}

/** Живые загрузки по mediaId — аналог `apiFileManager.isDownloading`. */
const downloads = new Map<number, CancellablePromise<Blob>>()

/** Идёт ли скачивание этого файла прямо сейчас (tweb `apiFileManager.isDownloading`). */
export function isDownloading(mediaId: number): boolean {
  return downloads.has(mediaId)
}

/** Промис живой загрузки — чтобы пересозданный бабл снова прицепил к ней кольцо. */
export function getDownload(mediaId: number): CancellablePromise<Blob> | undefined {
  return downloads.get(mediaId)
}

/** Отдать blob пользователю как файл (tweb делает это в `downloadToDisc`). */
function saveToDisc(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Скачать файл на диск. Возвращает `CancellablePromise<Blob>`: `notifyAll`
 * шлёт `{done, total}` (формат tweb `Progress`), `cancel()` рвёт поток.
 *
 * `justAttach` — второй аргумент tweb `appDownloadManager.downloadToDisc(options,
 * justAttach)` (appDownloadManager.ts:257,300): «качай, но НЕ отдавай файл
 * пользователю». Так работает автозагрузка: она приезжает симулированным кликом
 * (`isTrusted === false`), и весь блок создания якоря сохранения в оригинале
 * стоит под `if(!justAttach)`. Без этого «автозагрузка файлов» роняла бы каждый
 * документ ленты в папку «Загрузки» без ведома пользователя.
 */
export function downloadToDisc(
  { mediaId, fileName, mime, size }: DownloadArgs,
  justAttach?: boolean,
): CancellablePromise<Blob> {
  const running = downloads.get(mediaId)
  if(running) {
    return running
  }

  const deferred = deferredPromise<Blob>()
  const controller = new AbortController()
  deferred.cancel = () => {
    controller.abort()
    deferred.reject?.(makeError('CANCELED'))
  }

  downloads.set(mediaId, deferred)
  const forget = () => {
    if(downloads.get(mediaId) === deferred) downloads.delete(mediaId)
  }
  void deferred.then(forget, forget)

  void (async() => {
    try {
      const url = await resolveMediaContentUrl(mediaId)
      const res = await fetch(url, { signal: controller.signal })
      if(!res.ok || !res.body) {
        throw makeError('NO_FILE')
      }

      const total = Number(res.headers.get('content-length')) || size || 0
      const reader = res.body.getReader()
      const chunks: BlobPart[] = []
      let done = 0
      for(;;) {
        const chunk = await reader.read()
        if(chunk.done) break
        chunks.push(chunk.value)
        done += chunk.value.byteLength
        deferred.notifyAll?.({ done, total })
      }

      const blob = new Blob(chunks, { type: mime || 'application/octet-stream' })
      if(!justAttach) {
        saveToDisc(blob, fileName)
      }
      deferred.resolve?.(blob)
    } catch(err) {
      deferred.reject?.(err)
    }
  })()

  return deferred
}
