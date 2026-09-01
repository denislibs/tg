/**
 * Порт tweb `src/components/wrappers/document.ts` (`wrapDocument`) — ванильный,
 * без React: DOM строится императивно, временем жизни поколения владеет
 * `middleware`, форма — функция, как в оригинале.
 *
 * Развилка та же, что у tweb (document.ts:116-152): аудио/голосовое/кружок
 * делегируются в `AudioElement` (`@components/audio`, порт), всё остальное
 * рисуется здесь как `.document`.
 *
 * Возврат СИНХРОННЫЙ, хотя в tweb это `Promise<HTMLElement>`. Асинхронным
 * оригинал делают ровно три await'а — `wrapPhoto` обложки, `wrapSenderToPeer` и
 * `apiFileManager.isDownloading`; ни одного из них здесь нет (см. «что не
 * портировано»), а состояние загрузки читается синхронно из
 * `@lib/appDownloadManager`. Когда приедет обложка файла, сигнатура вернётся
 * к промису вместе с ней.
 *
 * ЧТО НЕ ПОРТИРОВАНО (и почему):
 *   • ОБЛОЖКА ФАЙЛА (`document-with-thumb`, `.document-download`, tweb
 *     document.ts:178-213) — она строится через `wrapPhoto`, которого у нас ещё
 *     нет (портирует параллельная задача). Без обложки tweb идёт ровно по нашей
 *     ветке: `downloadDiv = docDiv.querySelector('.document-download') || icoDiv`
 *     (document.ts:400,408) — то есть кольцо садится на иконку расширения, и это
 *     не «наш упрощённый вариант», а второй штатный путь оригинала;
 *   • ВЕТКА АПЛОАДА (`uploadingFileName`, tweb document.ts:422-427) — прогресс
 *     отдачи живёт в `stores/uploadsStore` и приезжает в бабл отдельно; вынос
 *     оптимистичного медиа на императивную ленту — отдельный этап;
 *   • `withTime`/`showSender` (`formatFullSentTime`, `wrapSenderToPeer`,
 *     `wrapSentTime`, tweb document.ts:225-239,263-265) — это режим
 *     поиска/shared-media, а не ленты; соответствующих врапперов у нас нет.
 *     Ветка «нет времени и нет отправителя» (скрытый дубль размера ради
 *     стабильной ширины, document.ts:233-239) портирована — в ленте работает
 *     именно она;
 *   • markdown-instant-view, pdf-ветка и предупреждение про IP-раскрывающие
 *     расширения (tweb document.ts:349-385) — фич нет;
 *   • `span.i18n` вокруг размера (виден в живом дампе `03-document.json`) —
 *     в tweb это ЖИВОЙ элемент langPack, который сам перерисовывается при смене
 *     языка. У нас DOM-элемента i18n нет (перевод — React-стор), и класс без
 *     механики был бы таким же пустым слепком, как `audio-element` до этого
 *     порта. Текст кладётся прямо в `span`, остальная структура дампа совпадает.
 */
import { formatBytes } from '@core/mediaCache'
import type { MyDocument } from '@core/media/messageMedia'
import type { MediaTypeSizes } from '@core/dom/mediaSizes'
import type { CancellablePromise } from '@helpers/cancellablePromise'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import type { Middleware } from '@helpers/middleware'
import noop from '@helpers/noop'
import ProgressivePreloader from '@components/preloader'
import { MiddleEllipsisElement } from '@components/middleEllipsis'
import AudioElement, { type AudioElementMessage } from '@components/audio'
import { downloadToDisc, getDownload, isDownloading } from '@lib/appDownloadManager'
import type { AudioTrack } from '@stores/audioStore'
import { useI18nStore } from '../../i18n'

export interface WrapDocumentOptions {
  /** документ вложения (tweb `doc: MyDocument`) */
  doc: MyDocument
  /** сообщение-владелец (tweb `message`) */
  message?: AudioElementMessage
  /** зона актуальности вызывающего (tweb `middleware`) */
  middleware: Middleware
  /** tweb `fontWeight` (по умолчанию 500) */
  fontWeight?: number
  /** tweb `fontSize` (по умолчанию 16) */
  fontSize?: number
  /** tweb `sizeType` — по какому боксу `MiddleEllipsisElement` меряет ширину */
  sizeType?: keyof MediaTypeSizes
  /** tweb `getSize` — живой геттер ширины для того же расчёта */
  getSize?: () => number
  /** порог автозагрузки (tweb `autoDownloadSize`); 0 — грузить только по клику */
  autoDownloadSize?: number
  /** трек для плеера (аудио/голосовое) — см. `AudioElement.track` */
  track?: AudioTrack
}

export default function wrapDocument(options: WrapDocumentOptions): HTMLElement {
  const { doc, middleware, autoDownloadSize, getSize } = options
  const message = options.message ?? {}
  const fontWeight = options.fontWeight ?? 500
  const fontSize = options.fontSize ?? 16
  const sizeType = options.sizeType
  const noAutoDownload = autoDownloadSize === 0

  // tweb document.ts:116-152 — аудио/голосовое/кружок рисует AudioElement.
  const type = doc.type
  if(type === 'audio' || type === 'voice' || type === 'round') {
    const audioElement = new AudioElement()
    audioElement.doc = doc
    audioElement.message = message
    audioElement.middleware = middleware
    // Трек для контроллера коллекции — наш узел поверх оригинала (tweb кладёт
    // в плейлист сам документ). ID3-теги живут в атрибуте, а не в файле:
    // `audioAttribute?.title ?? doc.file_name` (tweb audio.ts:159).
    const audioAttribute = doc.attributes.find((attribute) => attribute._ === 'documentAttributeAudio')
    audioElement.track = options.track ?? {
      mediaId: doc.id,
      title: audioAttribute?.title ?? doc.file_name ?? '',
      performer: audioAttribute?.performer,
      date: message.date,
      peerId: message.peerId,
      msgId: message.mid,
      type,
    }
    audioElement.dataset.fontWeight = '' + fontWeight
    audioElement.dataset.fontSize = '' + fontSize
    if(sizeType) audioElement.dataset.sizeType = sizeType
    if(message.out) audioElement.classList.add('is-out')
    audioElement.render()
    return audioElement
  }

  // tweb document.ts:154-158 — расширение из имени файла.
  const extSplitted = doc.file_name ? doc.file_name.split('.') : ''
  const ext = extSplitted.length > 1 && Array.isArray(extSplitted) ?
    clearBadCharsAndTrim(extSplitted.pop()!.split(' ', 1)[0].toLowerCase()) :
    'file'

  const docDiv = document.createElement('div')
  docDiv.classList.add('document', `ext-${ext}`)
  docDiv.dataset.docId = '' + doc.id

  const icoDiv = document.createElement('div')
  icoDiv.classList.add('document-ico')
  const icoTextEl = document.createElement('span')
  icoTextEl.classList.add('document-ico-text')
  icoTextEl.textContent = ext
  icoDiv.append(icoTextEl)

  const t = useI18nStore.getState().t
  const fileName = doc.file_name || 'Unknown.file'
  const bytesContainer = document.createElement('span')
  const bytesJoiner = ' / '

  // tweb document.ts:241-245. Разметка статическая (пользовательских данных в
  // ней нет) — как и в оригинале.
  const nameDiv = document.createElement('div')
  nameDiv.classList.add('document-name')
  const sizeDiv = document.createElement('div')
  sizeDiv.classList.add('document-size')
  docDiv.append(nameDiv, sizeDiv)

  const middleEllipsisEl = new MiddleEllipsisElement()
  middleEllipsisEl.dataset.fontWeight = '' + fontWeight
  middleEllipsisEl.dataset.fontSize = '' + fontSize
  if(sizeType) middleEllipsisEl.dataset.sizeType = sizeType
  if(getSize) (middleEllipsisEl as HTMLElement & { getSize?: () => number }).getSize = getSize
  // Пользовательское имя файла — текстовым узлом, никогда разметкой.
  middleEllipsisEl.textContent = fileName
  nameDiv.append(middleEllipsisEl)

  // tweb document.ts:220-239: размер и его СКРЫТЫЙ дубль (' / N') — он держит
  // ширину строки, чтобы она не прыгала, когда во время скачивания появится
  // «сколько скачано / всего».
  const bytesEl = doc.size ? formatBytes(doc.size, t) : ''
  const hiddenMax = document.createElement('span')
  hiddenMax.append(bytesJoiner, bytesEl)
  hiddenMax.style.visibility = 'hidden'
  bytesContainer.append(bytesEl, hiddenMax)
  sizeDiv.append(bytesContainer)

  docDiv.prepend(icoDiv)

  let downloadDiv: HTMLElement | null = null
  let preloader: ProgressivePreloader | null = null

  // tweb document.ts:280-309. У tweb здесь развилка по `canSaveToCache`
  // (`doc.size <= MAX_FILE_SAVE_SIZE`): помещающийся в кэш файл получает класс
  // `downloaded` и теряет кольцо навсегда, а не помещающийся — возвращает кольцо
  // в manual-состояние, чтобы его можно было скачать снова. У нас файл уходит
  // НА ДИСК и в кэш приложения не кладётся никогда, поэтому всегда работает
  // вторая, тоже штатная ветка оригинала.
  const onLoad = () => {
    docDiv.classList.remove('downloading')

    if(preloader) {
      preloader.setManual()
      preloader.attach(downloadDiv!)
      preloader.preloader.classList.add('manual')
      preloader.setDownloadFunction(load)
    }
  }

  // tweb document.ts:311-338 — «скачано / всего» вместо размера, пока идёт загрузка.
  const addByteProgress = <T>(promise: CancellablePromise<T>) => {
    docDiv.classList.add('downloading')

    const sizeContainer = document.createElement('span')
    sizeContainer.style.position = 'absolute'
    sizeContainer.style.left = '0'

    void promise.then(onLoad, noop).finally(() => {
      bytesContainer.style.visibility = ''
      sizeContainer.remove()
    })

    let d = document.createTextNode(formatBytes(0, t))
    bytesContainer.style.visibility = 'hidden'
    sizeContainer.append(d, bytesJoiner, bytesEl)
    bytesContainer.parentElement?.append(sizeContainer)

    promise.addNotifyListener?.((...args: unknown[]) => {
      const progress = args[0] as { done: number, total: number }
      const _d = document.createTextNode(formatBytes(progress.done, t))
      d.replaceWith(_d)
      d = _d
    })
  }

  // tweb document.ts:341-396 (`load`)
  const load = (e?: Event) => {
    // tweb document.ts:342 — `const save = !e || e.isTrusted`. Отличает НАСТОЯЩИЙ
    // клик пользователя от симулированного: автозагрузка приезжает через
    // `simulateClickEvent` (:420), у которого `isTrusted === false`, и должна
    // только положить байты в кэш, а не ронять файл в «Загрузки».
    const save = !e || e.isTrusted
    const download = downloadToDisc({
      mediaId: doc.id,
      fileName,
      mime: doc.mime_type,
      size: doc.size,
    }, !save)

    void download.catch(() => {
      docDiv.classList.remove('downloading')
    })

    if(downloadDiv) {
      preloader?.attach(downloadDiv, true, download)
      addByteProgress(download)
    }

    return { download }
  }

  // tweb document.ts:398-428 — уже качается / ещё не скачано.
  const running = isDownloading(doc.id) ? getDownload(doc.id) : undefined
  if(running) {
    downloadDiv = icoDiv
    preloader = new ProgressivePreloader()
    preloader.attach(downloadDiv, false, running)
    preloader.setDownloadFunction(load)
    addByteProgress(running)
  } else {
    downloadDiv = icoDiv
    preloader = new ProgressivePreloader()
    preloader.construct?.()
    preloader.setManual()
    preloader.attach(downloadDiv)
    preloader.setDownloadFunction(load)

    // tweb document.ts:419-421 зовёт `simulateClickEvent(preloader.preloader)`;
    // `simulateClickEvent` у нас не портирован (см. шапку `helpers/dom/clickEvent.ts`),
    // поэтому дёргается тот же обработчик напрямую — но ОБЯЗАТЕЛЬНО с событием:
    // именно по `isTrusted === false` синтетического клика `load` понимает, что
    // это автозагрузка, и не сохраняет файл на диск (см. `save` в `load`).
    // Вызов без аргумента дал бы `save === true` — молчаливое сохранение.
    if(!noAutoDownload && autoDownloadSize !== undefined && doc.size !== undefined && autoDownloadSize >= doc.size) {
      preloader.onClick(new Event('click'))
    }
  }

  // tweb document.ts:430-440
  attachClickEvent(docDiv, (e) => {
    if(findUpClassName(e.target as HTMLElement, 'time')) { // клик по времени не качает
      return
    }

    if(preloader) {
      preloader.onClick(e)
    } else {
      load()
    }
  })

  return docDiv
}

/**
 * Порт tweb `helpers/cleanSearchText` в объёме одного вызова из `wrapDocument`:
 * из расширения выбрасываются символы, которые не должны попасть в имя класса
 * `ext-<ext>`.
 */
function clearBadCharsAndTrim(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, '').trim()
}
