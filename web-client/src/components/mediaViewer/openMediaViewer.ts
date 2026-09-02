// Единый контроллер медиавьювера (Task 16) — точка входа всех трёх поверхностей
// (чат / галерея фото профиля / shared media), vanilla-аналог трёх бывших
// React-маунтов MediaLightbox. Аналог tweb-глобали `window.appMediaViewer`
// (index.ts:2379 писал в _openMedia, base.ts:1005-1007 снимал в close): ОДИН
// живой инстанс на приложение; повторный вызов при открытом — игнор (в tweb
// полноэкранный вьювер перекрывает источники кликов, сюда просто не попасть —
// у нас та же страховка кодом).
//
// Esc/Back: tweb вешает navigationItem 'media' в _openMedia (base.ts:2432-2447,
// appNavigationController: Esc и браузерный Back снимают item → close). Сам
// item живёт там же, где у оригинала, — в `mediaViewer/base.ts` (он один знает
// про полёт мувера и картинку-в-картинке); отсюда едет только ПОСТАНОВКА его в
// очередь навигации.
//
// ОСТАТОК #108: у оригинала `base.ts` зовёт `appNavigationController` НАПРЯМУЮ,
// а у нас механика приезжает инъекцией (`viewer.navigation`) — так было
// заведено, когда контроллера не существовало вовсе. Контроллер портирован, и
// вызов ниже уже его; сам шов (инъекция вместо прямого импорта) снимается
// вместе со следующим касанием `base.ts` — там же ждёт своей очереди ветка
// `canAnimate` (:2438-2440), которой этот параметр наконец есть чем питать.
import appNavigationController, { type NavigationItem } from '@core/navigation/appNavigationController'
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

  // Постановка записи вьювера в общую очередь навигации (tweb
  // appNavigationController.pushItem/removeItem, тип 'media' — base.ts:2433).
  // Вето (полёт мувера) и пауза на время картинки-в-картинке живут в самом
  // вьювере: сюда доезжает готовый `onPop`.
  let navigationItem: NavigationItem | undefined
  viewer.navigation = {
    pushItem: (item) => {
      navigationItem = appNavigationController.pushItem({
        type: 'media',
        onPop: () => item.onPop(),
      })
    },
    removeItem: () => {
      if (navigationItem) appNavigationController.removeItem(navigationItem)
      navigationItem = undefined
    },
  }

  viewer.onClose = () => {
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
