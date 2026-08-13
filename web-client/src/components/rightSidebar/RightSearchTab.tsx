// RightSearchTab — общий каркас экранов «Поиск GIF» / «Поиск стикеров» правой
// колонки. Скелет — 1:1 живой DOM tweb (дампы 19-emoticons-04/06):
//   div.sidebar-content.sidebar-slider.tabs-container [data-animation=navigation]
//     div.tabs-tab.sidebar-slider-item.scrolled-start[.scrolled-end]
//         .scrollable-y-bordered.active [id]
//       div.sidebar-header
//         button.btn-icon.sidebar-close-button > span.tgico.button-icon
//           (tweb sliderTab.ts:57 — ButtonIcon('left …', {noRipple: true}))
//         div.input-search > input… (shared/ui/InputSearch — наш порт tweb InputSearch)
//       div.sidebar-content > div.scrollable.scrollable-y > контент экрана
// Классы scrolled-start/scrolled-end на контейнере — порт
// Scrollable.attachBorderListeners (components/scrollable.ts:465-473): ставятся
// оба сразу, дальше — по scroll-событию. Сам Scrollable здесь не инстанцируем:
// его единственный владелец — лента (useChatScroll), перевод остальных
// скроллеров — отдельная задача (см. web-client/CLAUDE.md «Скролл»); паттерн
// ручного scrolled-start — как DatePickerPopup.
// Позиция панели — модуль (см. RightSearchTab.module.scss); портал в
// #main-columns, как #column-right (UserInfoPanel).
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import classNames from '../../shared/lib/classNames'
import useMediaQuery from '../../shared/lib/useMediaQuery'
import IconButton from '../../shared/ui/IconButton'
import InputSearch from '../../shared/ui/InputSearch'
import TgIcon from '../TgIcon'
import type { PopupApi } from '../../stores/popupStore'
import s from './RightSearchTab.module.scss'

// Порог догрузки по скроллу вниз — tweb Scrollable onScrollOffset (300).
const SCROLLED_BOTTOM_OFFSET = 300

/**
 * kind экранов поиска правой колонки: открытие второго экрана закрывает первый —
 * замена вкладки в слайдере tweb (popupStore гасит одноимённые попапы).
 */
export const RIGHT_SEARCH_POPUP_KIND = 'right-search'

/**
 * Обёртка instant-попапа под kind-замену: popupStore при открытии одноимённого
 * попапа лишь ставит предыдущему open=false — снять себя со стека обязан сам
 * попап. Анимации закрытия у экранов нет (instant-контракт, как
 * AddContact/EditContact), поэтому снимаемся сразу.
 */
export function RightSearchPopup({ api, children }: { api: PopupApi; children: ReactNode }) {
  const { open, onExitComplete } = api
  useEffect(() => {
    if (!open) onExitComplete()
  }, [open, onExitComplete])
  return open ? <>{children}</> : null
}

export default function RightSearchTab({
  id,
  containerClassName,
  placeholder,
  value,
  onChange,
  onClose,
  onScrolledBottom,
  scrollRef: scrollRefProp,
  children,
}: {
  /** id контейнера-вкладки: search-gifs-container / stickers-container (дампы) */
  id: string
  /** доп. классы контейнера (стикеры: chatlist-container, tweb stickers.tsx:149) */
  containerClassName?: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  onClose: () => void
  /** догрузка следующей страницы (tweb scrollable.onScrolledBottom) */
  onScrolledBottom?: () => void
  /** внешний ref скроллера — корень IntersectionObserver кладки GIF */
  scrollRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const narrow = useMediaQuery('(max-width:900px)')
  const ownScrollRef = useRef<HTMLDivElement>(null)
  const scrollRef = scrollRefProp ?? ownScrollRef
  // attachBorderListeners: оба класса стоят с монтирования, обновляются скроллом
  const [scrolledStart, setScrolledStart] = useState(true)
  const [scrolledEnd, setScrolledEnd] = useState(true)

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const rest = el.scrollHeight - el.scrollTop - el.clientHeight
    setScrolledStart(el.scrollTop <= 0)
    setScrolledEnd(rest <= 1)
    if (rest <= SCROLLED_BOTTOM_OFFSET) onScrolledBottom?.()
  }

  return createPortal(
    // Панель — геометрия tweb #column-right (модуль); портал в #main-columns,
    // как портал правой колонки (UserInfoPanel), фолбэк body — для тестов.
    <div className={narrow ? s.panelNarrow : s.panelWide}>
      <div className="sidebar-content sidebar-slider tabs-container" data-animation="navigation">
        <div
          id={id}
          className={classNames(
            'tabs-tab',
            'sidebar-slider-item',
            'scrollable-y-bordered',
            'active',
            scrolledStart ? 'scrolled-start' : '',
            scrolledEnd ? 'scrolled-end' : '',
            containerClassName ?? '',
          )}
        >
          <div className="sidebar-header">
            <IconButton className="sidebar-close-button" noRipple onClick={onClose} color="var(--secondary-text-color)">
              <TgIcon name="left" className="button-icon" />
            </IconButton>
            <InputSearch value={value} onChange={onChange} placeholder={placeholder} onClear={() => onChange('')} />
          </div>
          <div className="sidebar-content">
            <div ref={scrollRef} className="scrollable scrollable-y" onScroll={onScroll}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('main-columns') ?? document.body,
  )
}
