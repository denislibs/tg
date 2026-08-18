// Единый контроллер медиавьювера (Task 16) — точка входа всех трёх поверхностей
// (чат / галерея фото профиля / shared media), vanilla-аналог трёх бывших
// React-маунтов MediaLightbox. Аналог tweb-глобали `window.appMediaViewer`
// (index.ts:2379 писал в _openMedia, base.ts:1005-1007 снимал в close): ОДИН
// живой инстанс на приложение; повторный вызов при открытом — игнор (в tweb
// полноэкранный вьювер перекрывает источники кликов, сюда просто не попасть —
// у нас та же страховка кодом).
//
// Esc/Back: tweb вешает navigationItem 'media' в _openMedia (base.ts:2437-2455,
// appNavigationController: Esc и браузерный Back снимают item → close). У нас
// те же два существующих механизма приложения, которыми жил MediaLightbox.tsx:
// LIFO Esc-стек (core/hotkeys.pushEsc) и слой Back-навигации
// (core/navigation/navigationStack.pushLayer). Оба зовут close() — закрытие с
// анимацией; программное закрытие «съедает» свою запись истории (removeLayer).
import { pushEsc } from '@core/hotkeys'
import { pushLayer, removeLayer } from '@core/navigation/navigationStack'
import AppMediaViewer, { type AppMediaViewerOptions, type ViewerItem } from './appMediaViewer'

let current: AppMediaViewer | null = null

export type OpenMediaViewerArgs = {
  items: ViewerItem[]
  index: number
  /** кликнутая миниатюра — источник полёта открытия; без неё летим от
   * items[index].element (нет и его — fade от центрального бокса) */
  target?: HTMLElement
  /** порядок items: true — по возрастанию seq (окно чата; tweb bubbles.ts:3843
   * `reverse: true`), false — newest-first (грид shared media, галерея профиля) */
  reverse?: boolean
  /** вьювер снят (после полёта закрытия и уборки DOM) */
  onClosed?: () => void
} & AppMediaViewerOptions

export function openMediaViewer(args: OpenMediaViewerArgs): Promise<void> | undefined {
  if (current) return // один живой инстанс (см. шапку)

  const { items, index, target, reverse = false, onClosed, ...opts } = args
  const item = items[index]
  if (!item) return

  const el = target ?? item.element ?? undefined
  // Натуральных размеров нет (у медиа нет ни ступени с геометрией, ни атрибута
  // кадра; недомеренное фото профиля) — бокс от прямоугольника миниатюры, как
  // originRect-фолбэк старого
  // лайтбокса: с нулями setAttachmentSize-эквивалент дал бы пустой контейнер.
  if (el && (!item.media.width || !item.media.height)) {
    const r = el.getBoundingClientRect()
    item.media.width ||= r.width
    item.media.height ||= r.height
  }

  const viewer = current = new AppMediaViewer(opts)
  const unregisterEsc = pushEsc(() => { void viewer.close() })
  const layer = pushLayer(() => { void viewer.close() })
  viewer.onClose = () => {
    unregisterEsc()
    removeLayer(layer) // после Back слой уже снят — no-op
    current = null
    onClosed?.()
  }

  return viewer.openMedia({ items, index, target: el, reverse })
}

/** Открыт ли вьювер сейчас (страховки вызывающих). */
export const isMediaViewerOpen = (): boolean => current !== null

/** Закрыть открытый вьювер с анимацией (смена чата, unmount поверхности). */
export function closeMediaViewer(): void {
  void current?.close()
}
