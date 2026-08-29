import { cloneElement, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import SidebarSection from '../../shared/ui/SidebarSection'
import Checkbox from '../../shared/ui/Checkbox'
import { useRipple } from '../../shared/ui/Ripple/useRipple'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import TgSwitch from '../TgSwitch'
import liteMode from '../../helpers/liteMode'
import { clearPendingTransitionCleanup, NAVIGATION_TRANSITION_TIME, runNavigationTransition } from '../../core/dom/navigationTransition'
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
      // Мгновенная ветка обязана снять чужую отложенную уборку так же, как это
      // делает `runNavigationTransition`: узел, который только что уходил, всё
      // ещё держит таймер, снимающий с него `active`, — иначе экран опустеет
      // через `NAVIGATION_TRANSITION_TIME` после мгновенного возврата. Только с
      // ПРИХОДЯЩЕЙ: `own`/`sub` чередуются, и уходящая здесь — это приходящая
      // прошлого перехода, таймера на ней не бывает.
      if (to) clearPendingTransitionCleanup(to)
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
      {/* Вкладка слайдера — вендорный каркас tweb (дампы 15-right-12/16):
          `div.tabs-tab.sidebar-slider-item.scrollable-y-bordered` >
          `div.sidebar-header` (кнопка `sidebar-close-button` + `__title`) +
          `div.sidebar-content > div.scrollable.scrollable-y`.
          Класс `active` вешает не React, а слайдер — его здесь нет. */}
      <div ref={ownRef} className="tabs-tab sidebar-slider-item scrollable-y-bordered">
        <div className="sidebar-header">
          <button type="button" className="btn-icon sidebar-close-button" onClick={onBack} aria-label={t('Back')}>
            <TgIcon name="back" />
          </button>
          <div className="sidebar-header__title">{t(title)}</div>
          {headerRight}
        </div>
        <div className="sidebar-content">
          <div className="scrollable scrollable-y">{children}</div>
        </div>
      </div>
      {shownSub != null && (
        <div ref={subRef} className="tabs-tab sidebar-slider-item scrollable-y-bordered">
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
  // 1:1 с tweb `SettingSection` (дамп 15-right-12): и заголовок, и подпись
  // живут ВНУТРИ `.sidebar-left-section` — заголовок как
  // `.sidebar-left-section-name`, подпись как второй
  // `.sidebar-left-section-content.sidebar-left-section-caption`. Своей обёртки
  // у секции нет: расстояние между карточками даёт сам
  // `.sidebar-left-section-container` (`_section.scss`).
  return (
    <SidebarSection
      title={caption ? t(caption) : undefined}
      caption={footer ? t(footer) : undefined}
    >
      {children}
    </SidebarSection>
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
  // Та же `.row`, что и всюду: медиа-слот слева (`row-media` — аватар/иконка,
  // `row.ts:216-224`), заголовок с подписью и кнопка справа в `row-right`
  // (`row.ts:280-283`). Своей вёрстки у списочной строки в tweb нет.
  return (
    <div className={classNames('row', sub ? '' : 'no-subtitle', 'row-with-padding')}>
      {left != null && <div className="row-media">{left}</div>}
      <div className="row-title">{title}</div>
      {sub && <div className="row-subtitle">{sub}</div>}
      {onRemove && (
        <div className="row-right">
          <button type="button" className="btn-icon rp" onClick={onRemove} aria-label="✕">
            <TgIcon name="close" size={20} />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Строка настроек — порт `tweb components/row.ts` на глобальные классы tweb
 * (`styles/tweb/_row.scss`), своего CSS-модуля у неё нет.
 *
 * ── ОСТАТОК ВОЛНЫ (#112) ─────────────────────────────────────────────────
 * Это ВТОРОЙ порт того же `tweb components/row.ts`: первый —
 * `components/row.ts`, класс на императивном DOM. Двойника не сводили и не
 * будут: React-версия обслуживает React-экраны настроек, которых в tweb нет
 * вовсе, и умрёт вместе с ними. Пока живы оба, любая правка разметки строки
 * обязана ехать в ОБА файла — расхождение между ними видно глазом на одном
 * экране.
 *
 * Дерево, которое собирает `Row` в tweb (см. дампы
 * `docs/tweb/dom/dumps/15-right-02-edit-channel`, `…-12-edit-group`,
 * `07-right-sidebar`):
 *
 *   div|label.row[.no-subtitle][.row-with-icon][.row-with-padding]
 *                [.row-with-toggle][.row-clickable.hover-effect.rp]
 *     > div.c-ripple                       (ripple(), только у кликабельной)
 *     > div.row-title                      — когда правого блока нет
 *       | div.row-row.row-title-row        — когда есть (`titleRight`)
 *           > div.row-title
 *           + div.row-title.row-title-right[.row-title-right-secondary]
 *     + div.row-subtitle                   (при наличии подписи)
 *     + span.tgico.row-icon                (иконка — АБСОЛЮТНАЯ, слева)
 *     + div.row-right                      (`rightContent`, `row.ts:280-283`:
 *                                           контейнер получает ещё `row-grid`)
 *
 * Соответствие пропов оригиналу:
 *   `value`    → `titleRightSecondary` (`row.ts:192-194`, дамп 08-general-settings);
 *   `toggle`   → `checkboxField` c `toggle: true` (`row.ts:140-143`): тег строки
 *                становится `label`, контейнер получает `row-with-toggle`,
 *                а сам тумблер уезжает в `titleRight`;
 *   `checkbox` → `checkboxField` БЕЗ `toggle` (`row.ts:145-150`) — вторая, ничем
 *                не похожая на тумблер форма: тег строки тоже `label`, но
 *                `label.checkbox-field` (`div.checkbox-box` + `svg.checkbox-box-check`)
 *                кладётся ОТДЕЛЬНЫМ ребёнком контейнера и абсолютно позиционируется
 *                слева (`checkbox-field-absolute` + `.row .checkbox-field` в
 *                `_row.scss:361-384`), контейнер получает `row-with-padding`.
 *                Дампы: «Chat history for new members» в `15-right-12-edit-group`,
 *                под-права аккордеона «Send Media» в `15-right-13-group-permissions`;
 *   `icon`     → `Icon(icon, 'row-icon')` (`row.ts:201-210`) — плюс
 *                `row-with-icon` и `row-with-padding` на контейнере;
 *   `danger`/`accent` → классы `.danger`/`.primary` из tweb `base.scss:602-617`
 *                (портированы в `styles/tweb/_bridge.scss`).
 *
 * ОТСТУПЛЕНИЕ (#112): `selected` (список-переключатель «Off / 1 day / 1 week
 * …») в tweb — это `radioField`, а не галочка справа, и отметку мы кладём в
 * тот же `row-title-right`, что и тумблер. Прежняя мотивировка («RadioField мы
 * не портировали») НЕВЕРНА: `components/radioField.ts` портирован этой же
 * волной, шагом 1. Настоящая причина в том, что этот `Row` — React-компонент,
 * а `RadioField` строит DOM императивно: вставить его сюда можно только
 * ref-монтированием, то есть переписав React-строку на мост ради экрана,
 * который сам уезжает на слайдер. Расхождение снимается переездом экрана, а
 * не правкой этой строки.
 */
export function Row({
  icon,
  label,
  sublabel,
  value,
  onClick,
  danger,
  accent,
  toggle,
  checkbox,
  restriction,
  checked,
  selected,
  translate = true,
  multiline,
  right,
}: {
  icon?: ReactNode
  label: string
  sublabel?: string
  value?: string
  onClick?: () => void
  danger?: boolean
  accent?: boolean
  /** тумблер справа (tweb `checkboxFieldOptions: {toggle: true}`) */
  toggle?: boolean
  /** квадратный чекбокс слева (tweb `checkboxFieldOptions` без `toggle`) */
  checkbox?: boolean
  /** tweb `restriction: true` — «выключено» красит тумблер в --danger-color */
  restriction?: boolean
  checked?: boolean
  selected?: boolean
  translate?: boolean
  /** многострочный заголовок (tweb Row.Title class="pre-wrap" — Bio с переносами) */
  multiline?: boolean
  /** правый слот строки (tweb `rightContent` → `.row-right` + `.row-grid`) */
  right?: ReactNode
}) {
  const t = useT()
  const { onPointerDown, ripple } = useRipple()

  // Иконка приходит готовой нодой (обычно `<TgIcon/>`, а он уже рендерит
  // `span.tgico`) — доклеиваем ей класс `row-icon`, как это делает
  // `Icon(options.icon, 'row-icon')` в tweb.
  const iconNode = isValidElement<{ className?: string }>(icon)
    ? cloneElement(icon, { className: classNames('row-icon', icon.props.className ?? '') })
    : icon

  const titleRight = toggle
    ? <TgSwitch checked={!!checked} restriction={restriction} />
    : selected
      ? <TgIcon name="check" size={22} color="var(--primary-color)" />
      : value ?? null

  const title = (
    <div className={classNames('row-title', multiline ? 'pre-wrap' : '')}>
      {translate ? t(label) : label}
    </div>
  )

  // tweb `row.ts:129,145-150,212-214`: havePadding включают иконка и НЕ-тумблерный
  // чекбокс — оба живут в абсолютном левом слоте, под который контейнер и
  // раздвигается классом `row-with-padding`.
  const havePadding = !!icon || !!checkbox
  const Tag = toggle || checkbox ? 'label' : 'div'
  return (
    <Tag
      className={classNames(
        'row',
        sublabel ? '' : 'no-subtitle',
        icon ? 'row-with-icon' : '',
        havePadding ? 'row-with-padding' : '',
        toggle ? 'row-with-toggle' : '',
        onClick ? 'row-clickable' : '',
        onClick ? 'hover-effect' : '',
        onClick ? 'rp' : '',
        right ? 'row-grid' : '', // tweb row.ts:282 — правый слот включает grid-раскладку
        danger ? 'danger' : accent ? 'primary' : '',
      )}
      onClick={onClick}
      onPointerDown={onClick ? onPointerDown : undefined}
    >
      {/* `.c-ripple` — ПЕРВЫМ ребёнком (tweb `ripple()` делает prepend) */}
      {onClick ? ripple : null}
      {titleRight != null ? (
        <div className="row-row row-title-row">
          {title}
          <div
            className={classNames(
              'row-title',
              'row-title-right',
              !toggle && !selected ? 'row-title-right-secondary' : '',
            )}
          >
            {titleRight}
          </div>
        </div>
      ) : (
        title
      )}
      {/* tweb: `checkbox-field-absolute` — потому что подписи (span) у нас нет
          никогда (`row.ts:146-148`), `disable-hover` — `row.ts:165`. */}
      {checkbox && (
        <Checkbox
          checked={!!checked}
          shape="square"
          className="checkbox-field-absolute disable-hover"
        />
      )}
      {sublabel && <div className="row-subtitle">{sublabel}</div>}
      {iconNode}
      {right && <div className="row-right">{right}</div>}
    </Tag>
  )
}
