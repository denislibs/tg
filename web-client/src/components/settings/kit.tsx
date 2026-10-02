import type { LangPackKey } from '@/lang'
import { cloneElement, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import SidebarSection from '../../shared/ui/SidebarSection'
import Checkbox from '../../shared/ui/Checkbox'
import { useRipple } from '../../shared/ui/Ripple/useRipple'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import type { IconName } from '@core/tgico-icons'
import { getRowIconBackgroundImage } from '@helpers/rowIconBackground'
import { ROW_CHECKBOX_FIELD_CLASS, ROW_CHECKBOX_FIELD_TOGGLE_CLASS } from '../rowFieldClasses'
import TgSwitch from '../TgSwitch'
import liteMode from '../../helpers/liteMode'
import { clearPendingTransitionCleanup, NAVIGATION_TRANSITION_TIME, runNavigationTransition } from '../transition'
import Scrollable from '../scrollable'
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
 * сдвигаться. JS-часть перехода — `components/transition.ts`,
 * CSS — `styles/tweb/_slider.scss:226-241`.
 */
export function SettingsScreen({
  title,
  titleText,
  onBack,
  headerRight,
  zIndex = 60,
  sub = null,
  hidden = false,
  children,
}: {
  title?: LangPackKey
  /** Готовый текст вместо ключа — для заголовков из данных (имя ссылки-приглашения). */
  titleText?: string
  onBack: () => void
  headerRight?: ReactNode
  zIndex?: number
  /** вложенный экран (обычно другой SettingsScreen); null — закрыт */
  sub?: ReactNode
  /**
   * ВРЕМЕННО до 0б-1: экран спрятан (`hide`), пока поверх открыта Solid-вкладка
   * правой колонки. Оверлей лежит соседом вкладок в `.sidebar-slider` со своим
   * `z-index`, и открытая из него вкладка слайдера оказалась бы ПОД ним.
   */
  hidden?: boolean
  children: ReactNode
}) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const ownRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inSlider = useContext(InSliderContext)

  // Шапка у верхнего края — без плашки и линии, с ними — только после
  // прокрутки. Классы ведёт тот же `Scrollable`, что у вкладки слайдера
  // (`sliderTab.ts::_constructor`, tweb `sliderTab.ts:66-67`, `:84`):
  // `attachBorderListeners` сразу ставит `scrolled-start scrolled-end
  // scrollable-y-bordered` и дальше переключает их по позиции, а правило
  // `.scrollable-y-bordered:not(.scrolled-start) .sidebar-header`
  // (`styles/tweb/_sidebar.scss:89`, tweb :95-100) горит только при прокрутке.
  // Прежде кит ставил `scrollable-y-bordered` статически и без слушателя — и
  // плашка с линией стояли на каждом React-экране всегда (задача 3 плана 2D).
  // Пятый аргумент — ГОТОВЫЙ узел: `new Scrollable(el)` переложил бы детей в
  // свой div, а этим узлом владеет React (тот же приём — `useSearchSuper.ts`).
  // Кит — временный двойник вкладки до переезда экранов на Solid (снос —
  // задача 31 плана), своего правила шапки не заводит.
  useLayoutEffect(() => {
    const tab = ownRef.current
    const scroller = scrollRef.current
    if (!tab || !scroller) return
    const scrollable = new Scrollable(undefined, undefined, undefined, undefined, scroller)
    scrollable.attachBorderListeners(tab)
    return () => scrollable.destroy()
  }, [])

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
      className={classNames('tabs-container', s.screen, hidden ? 'hide' : '')}
      data-animation="navigation"
      style={{ zIndex }}
    >
      {/* Вкладка слайдера — вендорный каркас tweb (дампы 15-right-12/16):
          `div.tabs-tab.sidebar-slider-item` >
          `div.sidebar-header` (кнопка `sidebar-close-button` + `__title`) +
          `div.sidebar-content > div.scrollable.scrollable-y`.
          Класс `active` вешает не React, а слайдер — его здесь нет;
          `scrollable-y-bordered`/`scrolled-*` — `Scrollable` (эффект выше). */}
      <div ref={ownRef} className="tabs-tab sidebar-slider-item">
        <div className="sidebar-header">
          <button type="button" className="btn-icon sidebar-close-button" onClick={onBack} aria-label={t('Common.Back')}>
            <TgIcon name="back" />
          </button>
          <div className="sidebar-header__title">{title ? t(title) : titleText}</div>
          {headerRight}
        </div>
        <div className="sidebar-content">
          <div ref={scrollRef} className="scrollable scrollable-y">{children}</div>
        </div>
      </div>
      {/* Обёртка саба — наш узел (у tweb вкладка-сосед и есть экран): своего
          скроллера у неё нет, поэтому и `scrollable-y-bordered` нет — иначе
          правило плашки по предку горело бы на шапке вложенного экрана. */}
      {shownSub != null && (
        <div ref={subRef} className="tabs-tab sidebar-slider-item">
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
  captionText,
  footer,
  children,
}: {
  caption?: LangPackKey
  /** Готовый текст вместо ключа — например «12 joined», собранное из числа. */
  captionText?: string
  footer?: LangPackKey
  children: ReactNode
}) {
  const t = useT()
  // 1:1 с tweb `section.tsx` (812502980), разметку держит `SidebarSection`:
  // заголовок — `.sidebar-left-h2.sidebar-left-section-name` первым в
  // `.sidebar-left-section-content`, подпись — соседом карточки в
  // `.sidebar-left-section-container` (дампы 15-right-12, 14-left-14). Своей
  // обёртки у секции нет: расстояние между карточками — `padding-bottom`
  // контейнера (`_section.scss`).
  return (
    <SidebarSection
      title={caption ? t(caption) : captionText}
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
  /** Подпись — `ReactNode` по той же причине, что у `Row.sublabel`: сюда едут
   *  живые узлы дат (`shared/ui/dateNodes`). */
  sub?: ReactNode
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
 * Это React-двойник строки: Solid-порт — `components/rowTsx.solid.tsx`
 * (ванильный `components/row.ts` снят задачей 29 плана 2D). Двойника не сводили
 * и не будут: React-версия обслуживает React-экраны настроек, которых в tweb нет
 * вовсе, и умрёт вместе с ними. Пока живы оба, правка разметки строки обязана
 * ехать в ОБА файла — расхождение между ними видно глазом на одном экране.
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
 *     + span.row-icon.row-icon-colored     (плашка — АБСОЛЮТНАЯ, слева; tweb 2197fee9c)
 *         > span.tgico.row-icon-icon
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
 *   `icon`     → плашка + глиф (`row.ts:201-210` в 2197fee9c) — плюс
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
  className,
}: {
  icon?: ReactNode
  label: string
  /** Подпись под заголовком. `ReactNode`, а не строка: сюда едут и живые узлы
   *  дат (`shared/ui/dateNodes`) — их нельзя выразить строкой, иначе подпись
   *  застывает в языке момента рендера (задача #121). */
  sublabel?: ReactNode
  /** Правое значение строки — по той же причине `ReactNode`. */
  value?: ReactNode
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
  /** доп. класс строки (подсветка активного пункта корня настроек) */
  className?: string
}) {
  const t = useT()
  const { onPointerDown, ripple } = useRipple()

  // Иконка приходит готовой нодой. Глиф `<TgIcon/>` становится цветной плашкой,
  // как у tweb 2197fee9c (`row.ts:201-210`, `rowTsx.tsx` `Row.Icon`):
  // `span.row-icon.row-icon-colored` с градиентом inline
  // (`helpers/rowIconBackground.ts`), глиф — `span.tgico.row-icon-icon` внутри.
  // Кегль и цвет глифа задаёт плашка (`_row.scss`: `.row-icon` 1.5rem,
  // `.row-icon-colored` #fff), поэтому `size`/`color` вызывающего снимаются.
  // Не-глиф (аватар, чекбокс, эмодзи — у tweb это `row-media`/`checkboxField`,
  // а не иконка) получает только класс `row-icon`, как раньше. Так же и строки
  // `accent`/`danger`: у tweb это не `Row`, а `Button('btn-primary
  // btn-transparent [danger]', {icon})` — глиф цвета текста, без плашки.
  const iconNode = isValidElement<{ name: IconName }>(icon) && icon.type === TgIcon && !accent && !danger
    ? (
      <span
        className="row-icon row-icon-colored"
        style={{ backgroundImage: getRowIconBackgroundImage(icon.props.name) }}
      >
        <TgIcon name={icon.props.name} size="inherit" className="row-icon-icon" />
      </span>
    )
    : isValidElement<{ className?: string }>(icon)
      ? cloneElement(icon, { className: classNames('row-icon', icon.props.className ?? '') })
      : icon

  // tweb 803f9599d: тумблер строки — `row-checkbox-field-toggle` (без
  // `row-checkbox-field`, отступление — в `rowFieldClasses.ts`).
  const titleRight = toggle
    ? <TgSwitch checked={!!checked} restriction={restriction} className={ROW_CHECKBOX_FIELD_TOGGLE_CLASS} />
    : selected
      ? <TgIcon name="check" size={22} color="var(--primary-color)" />
      : value ?? null

  const title = (
    <div className={classNames('row-title', multiline ? 'pre-wrap' : '')}>
      {/* РАСКОЛ КОНТРАКТА, ОСТАВШИЙСЯ У REACT-СТОРОНЫ — ЗАДАЧА #112: при `translate`
          здесь ключ, без него — готовый текст (имя пира, номер телефона), и по типу
          они не различаются (`label: string`). Приведение честнее молчаливого
          `string`, но самого раскола не снимает: `<Row label={key}>` без `translate`
          напечатает пользователю латинское имя ключа, и тайпчек смолчит. Задача 7
          сняла этот раскол в ВАНИЛЬНОМ слое (там роль поля выражена ТИПОМ — ключ и
          готовое содержимое лежат в разных полях с непересекающимися типами); здесь
          он снимается вместе с React-двойником `Row`, и это #112 — остатки волны 2,
          где React-двойники уже перечислены. */}
      {translate ? t(label as LangPackKey) : label}
    </div>
  )

  // tweb `row.ts:129,145-150,212-214`: havePadding включают иконка и НЕ-тумблерный
  // чекбокс — оба живут в абсолютном левом слоте, под который контейнер и
  // раздвигается классом `row-with-padding`.
  const havePadding = !!icon || !!checkbox
  const Tag = toggle || checkbox ? 'label' : 'div'
  // Строка с полем — `label`, и клик по её тексту браузер досылает полю
  // (активация label): второй `click` с целью-инпутом всплывал в тот же
  // `onClick`, а React между ними успевал перерисоваться, — тумблер щёлкал
  // туда и обратно, и настройка не менялась. Досылку гасим отменой ПЕРВОГО
  // клика (отменённый клик label не активирует) — в фазе захвата, чтобы
  // отмена стояла до того, как событие дойдёт до label; клик прямо по полю
  // (оно накрывает тумблер целиком, `_checkbox.scss:292-297`) проходит как
  // есть. У tweb такой пары нет: строка с полем слушает `change` самого поля
  // (`row.ts` + `checkboxField.ts`), а не клик контейнера. Кит — двойник до
  // переезда экранов на Solid (задача 31 плана 2D).
  const onLabelClickCapture = onClick && Tag === 'label'
    ? (e: MouseEvent<HTMLElement>) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
    }
    : undefined
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
        className ?? '',
      )}
      onClick={onClick}
      onClickCapture={onLabelClickCapture}
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
          className={`checkbox-field-absolute disable-hover ${ROW_CHECKBOX_FIELD_CLASS}`}
        />
      )}
      {sublabel && <div className="row-subtitle">{sublabel}</div>}
      {iconNode}
      {right && <div className="row-right">{right}</div>}
    </Tag>
  )
}
