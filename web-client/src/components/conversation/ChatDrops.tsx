// Полноэкранная зона перетаскивания файлов поверх чата — порт tweb
// `appImManager.attachDragAndDropListeners()` (lib/appImManager.ts:2286-2506)
// вместе с `ChatDragAndDrop`.
//
// Дерево 1:1 с tweb: контейнер `div.drops-container[.is-visible][.backwards]`
// приклеивается ПОСЛЕДНИМ ребёнком колонки чата (`this.chat.container.append(
// _dropsContainer)`), внутри — одна или две зоны `.drop`. Стили — глобальный
// `styles/tweb/_chatDrop.scss` (позиция/анимация появления) плюс `.chat
// .drops-container` из `_chat.scss` (отступы, верх под топбаром).
//
// На время перетаскивания на <body> вешается `is-dragging` — партиал по нему
// глушит `pointer-events` у `.page-chats`, чтобы drop не попал в ленту.
//
// НЕ портировано: вторая пара зон (`mediaDropsContainer`) — она принимает файлы
// поверх уже открытого попапа отправки медиа, а наш SendMediaPopup дозагрузку
// перетаскиванием пока не умеет. И перенос файла на строку чат-листа
// (`lastDialogElement` + смена пира) — это зона чат-листа, не чата.
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import ChatDragAndDrop from './ChatDragAndDrop'
import classNames from '../../shared/lib/classNames'
import { useT } from '../../i18n'

type DropKind = 'document' | 'media'

// tweb `environment/imageMimeTypesSupport.ts` + `videoMimeTypesSupport.ts`:
// «медиа» — то, что браузер покажет сам; остальное уходит документом.
// Опциональные форматы (jxl/avif/mov) tweb определяет пробой рантайма — здесь
// берём фиксированный список плюс .mov, который tweb и так добавляет вручную
// («a .mov counts as media — it gets converted to mp4 in the send popup»).
const MEDIA_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/bmp', 'image/webp',
  'image/gif', 'video/mp4', 'video/webm', 'video/quicktime',
])

/** Порт `getFilesFromEvent(e, true)`: только mime-типы перетаскиваемых файлов. */
function getDraggedTypes(dt: DataTransfer): string[] {
  if (dt.files.length && !dt.items.length) return Array.from(dt.files, (f) => f.type)
  return Array.from(dt.items).filter((i) => i.kind === 'file').map((i) => i.type)
}

// Фазы = классы, которые вешает tweb SetTransition(200ms):
//   hidden — контейнер без `is-visible` (партиал прячет его display:none)
//   in     — `is-visible.forwards` (+`animating` пока идёт fade-in-opacity)
//   out    — `is-visible.backwards.animating`, через 200мс → hidden
type Phase = 'hidden' | 'in' | 'out'

export default function ChatDrops({
  enabled,
  onDropFiles,
}: {
  /** аналог tweb `canDrag()`: в этот чат вообще можно слать медиа */
  enabled: boolean
  onDropFiles: (files: File[], asFile: boolean) => void
}) {
  const t = useT()
  const [phase, setPhase] = useState<Phase>('hidden')
  const [animating, setAnimating] = useState(false)
  const [drops, setDrops] = useState<DropKind[]>([])

  const mounted = useRef(false)
  const counter = useRef(0)
  const dragTimeout = useRef<number | undefined>(undefined)
  const animTimeout = useRef<number | undefined>(undefined)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const onDropFilesRef = useRef(onDropFiles)
  onDropFilesRef.current = onDropFiles

  const toggle = useCallback((dt: DataTransfer | null, wantMount: boolean) => {
    let mount = wantMount
    if (mount === mounted.current) return

    const types = dt ? Array.from(dt.types) : []
    const isFiles = types.includes('SharedFilesTab2')

    if (mount) {
      if (!isFiles || !enabledRef.current) mount = false // * skip dragging text case
      if (mount === mounted.current) return
    }

    if (mount && dt) {
      const mimes = getDraggedTypes(dt)
      const force = isFiles && !mimes.length // * can't get file items not from 'drop' on Safari
      const foundMedia = mimes.filter((m) => MEDIA_MIME_TYPES.has(m))
      // Права send_docs у нас всегда есть, поэтому «как файл» принимает и медиа
      // (tweb: `foundDocuments.push(...foundMedia)`).
      const foundDocuments = mimes.filter((m) => !MEDIA_MIME_TYPES.has(m)).concat(foundMedia)

      const next: DropKind[] = []
      if (foundDocuments.length || force) next.push('document')
      if (foundMedia.length || force) next.push('media')
      setDrops(next)
    }

    mounted.current = mount
    setPhase(mount ? 'in' : 'out')
    setAnimating(true)
    if (animTimeout.current !== undefined) clearTimeout(animTimeout.current)
    animTimeout.current = window.setTimeout(() => {
      animTimeout.current = undefined
      setAnimating(false)
      if (!mount) { setPhase('hidden'); setDrops([]) }
    }, 200)

    if (!mount) {
      counter.current = 0
      if (dragTimeout.current !== undefined) clearTimeout(dragTimeout.current)
    }

    document.body.classList.toggle('is-dragging', mount)
  }, [])

  useEffect(() => {
    const body = document.body

    const onDragEnter = () => { ++counter.current }

    const onDragOver = (e: globalThis.DragEvent) => {
      toggle(e.dataTransfer, true)
      e.preventDefault()

      // 'dragover' сыплется всё время, пока тянут над страницей, и обрывается,
      // как только курсор ушёл из окна или файл отпустили снаружи. Для внешнего
      // файла источника в документе нет, поэтому ни 'drop', ни 'dragend' в этом
      // случае не придут — без сторожа зона (и pointer-events-замок
      // body.is-dragging) залипли бы навсегда. Взводим его заново на каждом
      // 'dragover': пауза прячет зону, живой drag тут же показывает обратно.
      if (dragTimeout.current !== undefined) clearTimeout(dragTimeout.current)
      dragTimeout.current = window.setTimeout(() => {
        counter.current = 0
        toggle(e.dataTransfer, false)
      }, 500)
    }

    const onDragLeave = (e: globalThis.DragEvent) => {
      if (--counter.current === 0) toggle(e.dataTransfer, false)
    }

    const onBodyDrop = (e: globalThis.DragEvent) => {
      // отступление от tweb: tweb гасит событие только в самой зоне
      // (`onDocumentPaste` → cancelEvent), а промах мимо зоны оставляет
      // браузеру — и тот уходит на file:// вместо приложения. Гасим здесь.
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('SharedFilesTab2')) e.preventDefault()
      toggle(e.dataTransfer, false)
    }

    body.addEventListener('dragenter', onDragEnter)
    body.addEventListener('dragover', onDragOver)
    body.addEventListener('dragleave', onDragLeave)
    body.addEventListener('drop', onBodyDrop)
    return () => {
      body.removeEventListener('dragenter', onDragEnter)
      body.removeEventListener('dragover', onDragOver)
      body.removeEventListener('dragleave', onDragLeave)
      body.removeEventListener('drop', onBodyDrop)
      if (dragTimeout.current !== undefined) clearTimeout(dragTimeout.current)
      if (animTimeout.current !== undefined) clearTimeout(animTimeout.current)
      mounted.current = false
      document.body.classList.remove('is-dragging')
    }
  }, [toggle])

  const handleDrop = (asFile: boolean) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer?.files ?? [])
    toggle(e.dataTransfer, false)
    if (files.length) onDropFilesRef.current(files, asFile)
  }

  return (
    <div
      className={classNames(
        'drops-container',
        phase === 'hidden' ? '' : 'is-visible',
        phase === 'in' ? 'forwards' : phase === 'out' ? 'backwards' : '',
        animating ? 'animating' : '',
      )}
    >
      {drops.map((kind) => (kind === 'document' ? (
        <ChatDragAndDrop
          key="document"
          icon="dragfiles"
          header={t('Chat.DropTitle')}
          subtitle={t('Chat.DropAsFilesDesc')}
          onDrop={handleDrop(true)}
        />
      ) : (
        <ChatDragAndDrop
          key="media"
          icon="dragmedia"
          header={t('Chat.DropTitle')}
          subtitle={t('Chat.DropQuickDesc')}
          onDrop={handleDrop(false)}
        />
      )))}
    </div>
  )
}
