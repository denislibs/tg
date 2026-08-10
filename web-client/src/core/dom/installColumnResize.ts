// Ручка ресайза колонки — порт tweb `src/helpers/installColumnResize.ts`.
// Вешает `.sidebar-resize-handle` на колонку, тянет ширину через
// setUserPreferredLeft/Right (они владеют CSS-переменными и персистом) и держит
// `body.resizing-left-sidebar` / `body.resizing-right-sidebar` на время драга
// (по этому классу CSS выключает transition, чтобы чат не отставал от курсора —
// styles/tweb/_chat.scss:447 и _leftSidebar.scss:76).
//
// Отступления от tweb:
//   • у нас нет SwipeHandler — драг собран на mousedown/mousemove/mouseup прямо
//     здесь; порядок колбэков тот же (onStart на нажатие, onSwipe на движение,
//     onReset на отпускание). Тач-ветку не делаем: ручка скрыта на handhelds
//     (`.sidebar-resize-handle { display: none }` до floating-left-sidebar);
//   • onReset вызывается на КАЖДОЕ отпускание, а не только когда было движение:
//     у tweb (swipeHandler.ts:251 `if(this.hadMove)`) простой клик по ручке
//     оставляет `body.resizing-*` и `.is-active` навсегда;
//   • возвращаем функцию снятия слушателей — вызывающий код React'овый и
//     обязан убирать за собой в cleanup эффекта.
import rootScope from '@lib/rootScope'
import { useI18nStore } from '../../i18n'
import { useSettingsStore } from '../../settings'
import {
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSE_FACTOR,
  setUserPreferredLeft,
  setUserPreferredRight,
} from './updateColumnWidths'

export type ColumnResizeSide = 'left' | 'right'

export interface InstallColumnResizeOptions {
  /** Колонка, к которой крепится ручка. Она же — `.relative`-родитель ручки. */
  columnEl: HTMLElement
  side: ColumnResizeSide
  /**
   * Хуки только для левой колонки: дёргаются, когда драг переходит порог
   * сворачивания, чтобы вызывающий код повесил `is-collapsed` и связанное с ним
   * состояние.
   */
  isCollapsed?: () => boolean
  setCollapsed?: (collapsed: boolean) => void
  /** Вызывается, когда свёрнутость реально переключилась. */
  onCollapsedChange?: () => void
  /**
   * Проверка порога сворачивания: вернула true — драг свернуть не может
   * (например, внутри открыта вкладка). Только для левой колонки.
   */
  preventCollapse?: () => boolean
  /** Побочный эффект на каждый тик драга (после обновления ширины). */
  onSwipeTick?: () => void
}

/**
 * Прикрепляет `.sidebar-resize-handle` к колонке. Когда во время драга зажат
 * Shift — ВТОРАЯ колонка тянется синхронно с той, за которую тянут.
 */
export default function installColumnResize(opts: InstallColumnResizeOptions): () => void {
  const { columnEl, side, isCollapsed, setCollapsed, onCollapsedChange, preventCollapse, onSwipeTick } = opts
  const bodyClass = side === 'left' ? 'resizing-left-sidebar' : 'resizing-right-sidebar'

  const handle = document.createElement('div')
  handle.classList.add('sidebar-resize-handle', `sidebar-resize-handle-${side}`)
  columnEl.append(handle)

  const onMove = (e: MouseEvent) => {
    const rect = columnEl.getBoundingClientRect()
    // Ручка сидит на внутренней кромке своей колонки; ширина — расстояние от
    // ВНЕШНЕЙ кромки до курсора.
    const rawWidth = side === 'left'
      ? Math.round(e.clientX - rect.left)
      : Math.round(rect.right - e.clientX)

    const isShift = e.shiftKey === true

    if (side === 'left') {
      const wasCollapsed = !!isCollapsed?.()
      const collapsed = !preventCollapse?.() && rawWidth < MIN_SIDEBAR_WIDTH * SIDEBAR_COLLAPSE_FACTOR
      setUserPreferredLeft(collapsed ? 0 : rawWidth)
      setCollapsed?.(collapsed)
      if (collapsed !== wasCollapsed) onCollapsedChange?.()
      if (isShift) {
        // Зеркалим в правую колонку — она зажимается в свой диапазон и не умеет
        // сворачиваться; клампом занимается setUserPreferredRight.
        setUserPreferredRight(collapsed ? MIN_SIDEBAR_WIDTH : rawWidth)
      }
    } else {
      setUserPreferredRight(rawWidth)
      if (isShift) setUserPreferredLeft(rawWidth)
    }

    onSwipeTick?.()
  }

  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    handle.classList.remove('is-active')
    document.body.classList.remove(bodyClass)
    document.body.style.removeProperty('cursor')
  }

  const onDown = (e: MouseEvent) => {
    // tweb SwipeHandler пропускает только основную и среднюю кнопки.
    if (![0, 1].includes(Math.max(0, e.button))) return
    e.preventDefault()
    handle.classList.add('is-active')
    document.body.classList.add(bodyClass)
    // tweb ставит курсор на overlay-root на время драга (setCursorTo), чтобы он
    // не прыгал, когда курсор уходит с самой ручки.
    document.body.style.setProperty('cursor', 'col-resize', 'important')
    if (!useSettingsStore.getState().seenSidebarResizeTip) {
      useSettingsStore.getState().update({ seenSidebarResizeTip: true })
      rootScope.dispatchEvent('ui:toast', useI18nStore.getState().t('Hold Shift to resize both columns at once'))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  handle.addEventListener('mousedown', onDown)

  return () => {
    onUp()
    handle.removeEventListener('mousedown', onDown)
    handle.remove()
  }
}
