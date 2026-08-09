import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import SidebarSection from '../../shared/ui/SidebarSection'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import TgSwitch from '../TgSwitch'
import liteMode from '../../helpers/liteMode'
import { NAVIGATION_TRANSITION_TIME, runNavigationTransition } from '../../core/dom/navigationTransition'
import { useT } from '../../i18n'
import s from './kit.module.scss'

// «Этот экран — вкладка слайдера родителя»: вход/выход ему уже анимирует
// SettingsScreen-владелец, собственный слайд не нужен.
const InSliderContext = createContext(false)

/**
 * Полноэкранный экран настроек — порт сайдбар-слайдера tweb.
 *
 * В tweb каждый такой экран это `SliderSuperTab`, а стек экранов —
 * `SidebarSlider` (`tweb components/slider.ts:22-47`), который поверх
 * `.sidebar-slider` заводит `TransitionSlider({type: 'navigation'})`. Экраны
 * лежат СОСЕДЯМИ в одном контейнере `.tabs-container[data-animation="navigation"]`,
 * виден только `.active`, а переключение (`tweb components/transition.ts:23-42`
 * `slideNavigation`) двигает обе вкладки сразу: приходящая едет с
 * `translate3d(width, 0, 0)` в ноль, уходящая — в `-width * .25` с
 * `brightness(80%)`. Это и есть параллакс оригинала.
 *
 * Поэтому саб-экран приходит НЕ детьми, а пропом `sub`: только так он
 * оказывается вкладкой-соседом, а не потомком, и уходящему экрану есть куда
 * сдвигаться. JS-часть перехода — `core/dom/navigationTransition.ts`,
 * CSS — `styles/tweb/_slider.scss:226-241`.
 */
export function SettingsScreen({
  title,
  onBack,
  headerRight,
  zIndex = 60,
  sub = null,
  children,
}: {
  title: string
  onBack: () => void
  headerRight?: ReactNode
  zIndex?: number
  /** вложенный экран (обычно другой SettingsScreen); null — закрыт */
  sub?: ReactNode
  children: ReactNode
}) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const ownRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const inSlider = useContext(InSliderContext)

  // Последний непустой саб — чтобы на закрытии узел дожил до конца обратного
  // слайда (роль AnimatePresence; tweb снимает вкладку в `SidebarSlider.closeTab`
  // → `onCloseTab`, `slider.ts:71-84`, тоже по истечении TRANSITION_TIME).
  const lastSub = useRef<ReactNode>(null)
  if (sub != null) lastSub.current = sub

  const [mountedSub, setMountedSub] = useState(sub != null)
  if (sub != null && !mountedSub) setMountedSub(true) // подстройка состояния под проп
  const shownSub = sub ?? (mountedSub ? lastSub.current : null)

  // Первая отрисовка переходом не считается (tweb: `prevId === -1 && !animateFirst`) —
  // активную вкладку просто помечаем классом.
  //
  // Экран, открытый НЕ из соседнего экрана настроек (владелец — колонка/панель,
  // ещё не переведённая на слайдер), въезжает сам: это входная половина
  // `slideNavigation` (`tweb components/transition.ts:27-38`) —
  // `translate3d(width, 0, 0)` → 0 за `--transition-standard-in`. Уходящей
  // вкладки в этом слое нет, поэтому параллакса (`brightness(80%)`) тоже нет.
  useLayoutEffect(() => {
    ;(subRef.current ?? ownRef.current)?.classList.add('active')

    const el = containerRef.current
    if (inSlider || !el || !liteMode.isAvailable('animations')) return
    el.style.transform = 'translate3d(100%, 0, 0)'
    el.classList.add(s.entering)
    void el.offsetWidth // reflow — как tweb `void tabContent.offsetWidth`
    el.style.transform = ''
    const id = window.setTimeout(() => el.classList.remove(s.entering), 300)
    return () => window.clearTimeout(id)
  }, [inSlider])

  const openRef = useRef(sub != null)
  // таймер снятия ушедшей вкладки живёт в ref, а не в cleanup эффекта: `sub` —
  // новый JSX-объект на каждый рендер родителя, cleanup сбрасывал бы его посреди
  // анимации закрытия
  const unmountTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(unmountTimer.current), [])
  useLayoutEffect(() => {
    const container = containerRef.current
    const own = ownRef.current
    const open = sub != null
    if (!container || !own || open === openRef.current) return
    openRef.current = open

    const to = open ? subRef.current : own
    const from = open ? own : subRef.current
    window.clearTimeout(unmountTimer.current)

    if (!liteMode.isAvailable('animations')) {
      to?.classList.add('active')
      from?.classList.remove('active')
      if (!open) setMountedSub(false)
      return
    }

    runNavigationTransition({ container, to, from, toRight: open })
    if (!open) {
      unmountTimer.current = window.setTimeout(
        () => setMountedSub(false),
        NAVIGATION_TRANSITION_TIME + 100,
      )
    }
  }, [sub])

  return (
    <div
      ref={containerRef}
      className={classNames('tabs-container', s.screen)}
      data-animation="navigation"
      style={{ zIndex }}
    >
      {/* класс `active` вешает не React, а слайдер — поэтому его нет в className */}
      <div ref={ownRef} className={classNames('tabs-tab', s.tab)}>
        <div className={s.header}>
          <IconButton onClick={onBack} color="var(--secondary-text-color)">
            <TgIcon name="back" />
          </IconButton>
          <Text size={19} weight={600} color="var(--primary-text-color)" className={s.title}>
            {t(title)}
          </Text>
          {headerRight}
        </div>
        <div className={s.body}>{children}</div>
      </div>
      {shownSub != null && (
        <div ref={subRef} className={classNames('tabs-tab', s.tab)}>
          <InSliderContext.Provider value>{shownSub}</InSliderContext.Provider>
        </div>
      )}
    </div>
  )
}

/**
 * Показ/скрытие попапа классами tweb `PopupElement` (`tweb components/popups/index.ts:357-359`
 * — `void offsetWidth` + `active`; `:420-421` — `hiding` вместо `active`, узел
 * снимается по истечении перехода). Правила — в портированном
 * `styles/tweb/popups/_popup.scss:29-70`: у `.popup` анимируются opacity и
 * visibility, у `.popup-container` — `translate3d(x, 3rem, 0)` → 0.
 *
 * Возвращает класс состояния для корня `.popup` и признак «узел ещё нужен в DOM».
 */
export function usePopupTransition(open: boolean) {
  // `active` — кадром позже появления узла, иначе анимировать не от чего.
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!open) {
      setActive(false)
      return
    }
    const id = requestAnimationFrame(() => setActive(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  // `hiding` вешается только на реально открывавшийся попап (tweb ставит его в
  // destroy(), т.е. всегда после show()).
  const opened = useRef(false)
  if (open) opened.current = true
  const hiding = !open && opened.current

  // Узел живёт, пока играет затухание скрима (--popup-transition-time = .2s).
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    if (!opened.current) return
    const id = window.setTimeout(() => setMounted(false), 300)
    return () => window.clearTimeout(id)
  }, [open])

  return { mounted, cls: open && active ? 'active' : hiding ? 'hiding' : '' }
}

export function Section({
  caption,
  footer,
  children,
}: {
  caption?: string
  footer?: string
  children: ReactNode
}) {
  const t = useT()
  return (
    <div className={s.section}>
      {/* Заголовок — ВНУТРИ карточки (tweb .sidebar-left-section-name) */}
      <SidebarSection noMargin title={caption ? t(caption) : undefined}>{children}</SidebarSection>
      {footer && (
        <Text size={13.5} color="var(--secondary-text-color)" className={s.footer}>
          {t(footer)}
        </Text>
      )}
    </div>
  )
}

/** List entry: avatar/icon left + title (+ subtitle) + optional remove button. */
export function EntryRow({
  left,
  title,
  sub,
  onRemove,
}: {
  left: ReactNode
  title: string
  sub?: string
  onRemove?: () => void
}) {
  return (
    <div className={s.entry}>
      {left}
      <div className={s.entryBody}>
        <Text noWrap size={16} color="var(--primary-text-color)">{title}</Text>
        {sub && <Text noWrap size={13.5} color="var(--secondary-text-color)">{sub}</Text>}
      </div>
      {onRemove && (
        <TgIcon name="close" size={20} color="var(--secondary-text-color)" onClick={onRemove} style={{ cursor: 'pointer', flexShrink: 0 }} />
      )}
    </div>
  )
}

/** Generic tappable row: icon? + label (+ subtitle) + right value/chevron/toggle/check. */
export function Row({
  icon,
  label,
  sublabel,
  value,
  onClick,
  danger,
  accent,
  chevron,
  toggle,
  checked,
  selected,
  translate = true,
  multiline,
}: {
  icon?: ReactNode
  label: string
  sublabel?: string
  value?: string
  onClick?: () => void
  danger?: boolean
  accent?: boolean
  chevron?: boolean
  toggle?: boolean
  checked?: boolean
  selected?: boolean
  translate?: boolean
  /** многострочный заголовок (tweb Row.Title class="pre-wrap" — Bio с переносами) */
  multiline?: boolean
}) {
  const t = useT()
  const color = danger ? '#ff595a' : accent ? 'var(--primary-color)' : 'var(--primary-text-color)'
  return (
    <div className={classNames(s.row, onClick ? s.rowClickable : '')} onClick={onClick}>
      {icon && <div className={s.rowIcon}>{icon}</div>}
      <div className={s.rowBody}>
        <Text
          noWrap={!multiline}
          size={16}
          color={color}
          style={multiline ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } : undefined}
        >
          {translate ? t(label) : label}
        </Text>
        {sublabel && (
          <Text noWrap size={13.5} color="var(--secondary-text-color)">
            {sublabel}
          </Text>
        )}
      </div>
      {value != null && (
        <Text size={15} color="var(--secondary-text-color)" className={s.rowValue}>{value}</Text>
      )}
      {toggle && <TgSwitch checked={!!checked} />}
      {selected && <TgIcon name="check" size={22} color="var(--primary-color)" />}
      {chevron && <TgIcon name="next" size={22} color="var(--secondary-text-color)" />}
    </div>
  )
}
