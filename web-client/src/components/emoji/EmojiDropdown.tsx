// Эмодзи-дропдаун — React-порт tweb EmoticonsDropdown (components/emoticonsDropdown).
// Дерево и классы 1:1 с живыми дампами docs/tweb/dom/dumps/19-emoticons-0*.json:
//
//   div.emoji-dropdown[.active]
//     div.emoji-container > div.tabs-container[data-animation="tabs"]
//       > три .tabs-tab.emoticons-container (слайд смены — порт TransitionSlider)
//     div.emoji-tabs.menu-horizontal-div.emoticons-menu.no-stripe > 5×button.btn-icon
//
// Поведение тоже из tweb:
//  - открытие по hover с задержкой 200 мс (DropdownHover TOGGLE_TIMEOUT), клик — toggle;
//  - анимация scale(.85)→1 + fade за .2s классом `.active` (не unmount — сохраняем скролл),
//    переход целиком из партиала styles/tweb/_emojiDropdown.scss;
//  - ленивый рендер: содержимое категории живёт в DOM только пока категория видима
//    (VisibilityIntersector), у невидимых — заранее посчитанный minHeight
//    (StickersTabCategory.setCategoryItemsHeight), чтобы скролл не прыгал;
//  - лента категорий: recent отдельной кнопкой, остальные — в схлопывающемся
//    `.menu-horizontal-inner` (emoji.ts:463-467), наборы кастом-эмодзи после него;
//  - поиск сдвигает панель вверх (`.is-searching` + `emoticons-will-move-*`);
//  - нижние табы: search / emoji / stickers / gifs / delete, `.hide` по правилам
//    index.ts:459-460. Все вкладки живут в DOM (`.tabs-tab.active` → display:flex).
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import TgIcon, { type IconName } from '../TgIcon'
import Emoji, { EMOJI_CDN_BASE, emojiCodepoints } from './Emoji'
import StickersTab from './StickersTab'
import GifsTab from './GifsTab'
import EmoticonsTab, { EmoticonsSearch, MenuTab } from './EmoticonsTab'
import useEmoticonsStickySpy from './useEmoticonsStickySpy'
import IS_EMOJI_SUPPORTED from '@environment/emojiSupport'
import IconButton from '../../shared/ui/IconButton'
import StickerMedia from '../StickerMedia'
import type { Sticker } from '../../core/managers/stickersManager'
import { useCustomEmojiSets } from '../../core/hooks/useStickers'
import { setThumbMediaId } from '../../core/stickers/setThumb'
import type { GifItem } from '../../core/gifs'
import { CATEGORIES, DEFAULT_FREQUENT, QUICK_CHIPS, searchEmojisByWord } from './emojiData'
import { useT } from '../../i18n'
import classNames from '../../shared/lib/classNames'
import { pushEsc } from '../../core/hotkeys'
import { openGifsSearchTab } from '../rightSidebar/GifsSearchTab'
import { openStickersSearchTab } from '../rightSidebar/StickersSearchTab'

// tweb DropdownHover: ANIMATION_DURATION = 200 (scale/fade). Hover-открытие живёт
// отдельным модулем useDropdownHover (Composer держит его в главном чанке).
const ANIMATION_DURATION = 200

// Метрики сетки из tweb: ячейка 42px (EMOJI_ELEMENT_SIZE / --esg-emoji-total-size),
// column-gap 4px (EmoticonsTabStyles.Emoji.gapX), padding 16px (styles.padding).
const CELL = 42
const GAP_X = 4
const GRID_PADDING = 16

const RECENT_KEY = 'tg-emoji-recent'
const RECENT_MAX = 32 // tweb RECENT_MAX_LENGTH

// tgico-иконки категорий: порядок и глифы — tweb EMOJI_CATEGORIES (emoji.ts:139).
// отступление от tweb: у нас есть отдельная категория symbols (в tweb её строка
// закомментирована, символы размазаны по остальным) — глиф language ближайший
// по смыслу. Данные эмодзи (emojiData.ts) свои, вырезать категорию нельзя.
const CAT_ICON: Record<string, IconName> = {
  recent: 'recent',
  smileys: 'smile',
  animals: 'animals',
  food: 'eats',
  travel: 'car',
  activity: 'sport',
  objects: 'lamp',
  symbols: 'language',
  flags: 'flag',
}

type TabId = 'emoji' | 'stickers' | 'gifs'

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  } catch {
    return []
  }
}

// ── Ячейка эмодзи (tweb appendEmoji, emoji.ts:50-116) ────────────────────────
// На системах с нативной отрисовкой эмодзи (IS_EMOJI_SUPPORTED: macOS/iOS) tweb
// НЕ подставляет картинку: wrapEmojiText → wrapRichText отдаёт
// `span.emoji.emoji-native` с самим глифом (wrapRichText.ts:503-505). Только без
// поддержки идёт img-ветка с плейсхолдером:
//   span.super-emoji.super-emoji-regular > img.emoji + span.emoji-placeholder
// Плейсхолдер добавляется ТОЛЬКО пока URL не в loadedURLs, opacity гоняется
// инлайном (emoji.ts:88-105) — так же и здесь.
const loadedEmojis = new Set<string>()

const EmojiCell = memo(function EmojiCell({
  e,
  onPick,
}: {
  e: string
  onPick: (emoji: string) => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(() => loadedEmojis.has(e))

  let content
  if (IS_EMOJI_SUPPORTED || attempt >= 2) {
    // при поддержке — нативный рендер 1:1 tweb; иначе это фолбэк нашей
    // CDN-ветки (отступление от tweb: у него набор PNG в бандле и фолбэка нет)
    content = <span className="emoji emoji-native">{e}</span>
  } else {
    const file = emojiCodepoints(e, attempt === 1)
    content = (
      <>
        <img
          className="emoji"
          src={`${EMOJI_CDN_BASE}${file}.png`}
          alt={e}
          loading="lazy"
          draggable={false}
          style={loaded ? undefined : { opacity: 0 }}
          onLoad={() => {
            loadedEmojis.add(e)
            setLoaded(true)
          }}
          onError={() => setAttempt((a) => a + 1)}
        />
        {!loaded && <span className="emoji-placeholder" style={{ opacity: 1 }} />}
      </>
    )
  }
  return (
    <span className="super-emoji super-emoji-regular" onClick={() => onPick(e)}>
      {content}
    </span>
  )
})

// ── Категория (tweb StickersTabCategory: .emoji-category > .category-title +
// .category-items). Сетка резервирует высоту (rows × 42px) всегда; ячейки
// рендерятся только когда категория видима (tweb _onCategoryVisibility). ──────
const EmojiCategory = memo(function EmojiCategory({
  catKey,
  title,
  emojis,
  cols,
  visible,
  onPick,
  register,
}: {
  catKey: string
  title: string
  emojis: string[]
  cols: number
  visible: boolean
  onPick: (emoji: string) => void
  register: (key: string, el: HTMLDivElement | null) => void
}) {
  const rows = Math.ceil(emojis.length / cols)
  return (
    <div ref={(el) => register(catKey, el)} className="emoji-category">
      {/* локальная категория (tweb createLocalCategory, tab.ts:345-347):
          заголовок `i18n(title)` = span.i18n + класс disable-hover */}
      <div className="category-title disable-hover">
        <span className="i18n">{title}</span>
      </div>
      <div className="category-items super-emojis" style={{ minHeight: rows * CELL }}>
        {visible && emojis.map((e, i) => <EmojiCell key={`${e}-${i}`} e={e} onPick={onPick} />)}
      </div>
    </div>
  )
})

// ── Ячейка кастом-эмодзи (tweb appendEmoji с docId: span.super-emoji.super-emoji-custom) ──
const CustomEmojiCell = memo(function CustomEmojiCell({
  st,
  onPick,
}: {
  st: Sticker
  onPick: (documentId: number, emoji: string) => void
}) {
  return (
    <span className="super-emoji super-emoji-custom" onClick={() => onPick(st.mediaId, st.emoji)}>
      <StickerMedia mediaId={st.mediaId} width={34} height={34} playOnHover thumb={st.thumb} />
    </span>
  )
})

// ── Категория кастом-эмодзи (набор kind='emoji') ─────────────────────────────
const CustomEmojiCategory = memo(function CustomEmojiCategory({
  catKey,
  title,
  stickers,
  cols,
  visible,
  onPick,
  register,
}: {
  catKey: string
  title: string
  stickers: Sticker[]
  cols: number
  visible: boolean
  onPick: (documentId: number, emoji: string) => void
  register: (key: string, el: HTMLDivElement | null) => void
}) {
  const rows = Math.ceil(stickers.length / cols)
  return (
    <div ref={(el) => register(catKey, el)} className="emoji-category">
      {/* категория-набор НЕ локальная: заголовок — голый текст (wrapEmojiText),
          без span.i18n и без disable-hover (tweb createCategory) */}
      <div className="category-title">{title}</div>
      <div className="category-items super-emojis" style={{ minHeight: rows * CELL }}>
        {visible && stickers.map((st) => <CustomEmojiCell key={st.id} st={st} onPick={onPick} />)}
      </div>
    </div>
  )
})

// ── Дропдаун ─────────────────────────────────────────────────────────────────
export default function EmojiDropdown({
  open,
  onPick,
  onPickCustomEmoji,
  onPickSticker,
  onPickGif,
  onClose,
  onDelete,
  onExitComplete,
  className,
  panelProps,
}: {
  open: boolean
  onPick: (emoji: string) => void
  /** выбор кастом-эмодзи (композер): вставляет entity custom_emoji в инпут.
   * Наличие включает наборы кастом-эмодзи во вкладке эмодзи (tweb). */
  onPickCustomEmoji?: (documentId: number, emoji: string) => void
  /** включает вкладку стикеров (композер); выбор закрывает дропдаун (tweb) */
  onPickSticker?: (st: Sticker) => void
  /** включает вкладку GIF (композер, не реакции); выбор закрывает дропдаун */
  onPickGif?: (g: GifItem) => void
  onClose: () => void
  /** показать кнопку backspace в нижних табах (композер) */
  onDelete?: () => void
  /** exit-анимация доиграла (владелец может размонтировать) */
  onExitComplete?: () => void
  /** переопределение позиционирования (по умолчанию — абсолютно над композером) */
  className?: string
  /** hover-обработчики панели из useDropdownHover (не дать закрыться под мышью) */
  panelProps?: { onMouseEnter: () => void; onMouseLeave: () => void }
}) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stickersInputRef = useRef<HTMLInputElement>(null)
  const gifsInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLElement>(null)
  const catElsRef = useRef(new Map<string, HTMLDivElement>())
  const hideTimer = useRef(0)

  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [activeCat, setActiveCat] = useState('recent')
  const [visibleCats, setVisibleCats] = useState<ReadonlySet<string>>(new Set())
  const [cols, setCols] = useState(8)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<{ e: string; q: string } | null>(null)
  const [focused, setFocused] = useState(false)
  // tweb index.ts:651 — `no-border-top` держится, пока скролл вкладки на нуле.
  const [atTop, setAtTop] = useState(true)

  // tweb `tabsToRender` (index.ts:270): в композере три вкладки, в standalone —
  // сколько передали. У нас набор задан наличием колбэков.
  const tabs = useMemo<TabId[]>(
    () => ['emoji', ...(onPickSticker ? (['stickers'] as const) : []), ...(onPickGif ? (['gifs'] as const) : [])],
    [onPickSticker, onPickGif],
  )
  const [tab, setTab] = useState<TabId>('emoji')
  // Наполнение вкладки — строго ПОСЛЕ слайда. В tweb `tab.init()` висит на
  // `onTransitionEnd` слайдера (index.ts:288-291 — четвёртый аргумент
  // horizontalMenu, см. horizontalMenu.ts:145), поэтому переход играет по ещё
  // пустой вкладке. Если инициализировать в том же кадре, что и переключение,
  // построение сотен узлов стикеров/GIF съедает первые кадры анимации — слайд
  // виден рывком ровно один раз, при первом открытии вкладки.
  // Вкладка эмодзи инициализирована сразу (tweb index.ts:376).
  const [initedTabs, setInitedTabs] = useState<ReadonlySet<TabId>>(() => new Set<TabId>(['emoji']))
  const markInited = useCallback((id: TabId) => {
    setInitedTabs((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])

  // ── Слайд смены вкладок — порт tweb TransitionSlider типа 'tabs'
  // (transition.ts: selectTab 240-372 + slideTabs 44-96); в tweb его создаёт
  // horizontalMenu из EmoticonsDropdown.init (index.ts:287). Контейнер несёт
  // `data-animation="tabs"` (transition.ts:186), переход играет CSS-правило
  // `.tabs-container[data-animation="tabs"] .tabs-tab { transition: transform }`
  // (_slider.scss). React в том же коммите уже переставил `active` на новую
  // вкладку — эффект возвращает его уходящей на время слайда (в tweb `active`
  // держится на обеих до конца перехода) и ведёт классы
  // `animating`/`backwards`/`from`/`to` + инлайновые transform.
  const tabsContainerRef = useRef<HTMLDivElement>(null)
  const prevTabRef = useRef<TabId>('emoji')
  useLayoutEffect(() => {
    const prev = prevTabRef.current
    if (prev === tab) return
    prevTabRef.current = tab
    const content = tabsContainerRef.current
    if (!content) return
    const fromIdx = tabs.indexOf(prev)
    const toIdx = tabs.indexOf(tab)
    const from = content.children[fromIdx] as HTMLElement | undefined
    const to = content.children[toIdx] as HTMLElement | undefined
    if (!from || !to || from === to) {
      markInited(tab)
      return
    }
    // гейт «Без анимаций» (tweb liteMode.isAvailable('animations'), transition.ts:258).
    // Слайда нет — значит нет и onTransitionEnd: инициализируем сразу
    // (в tweb ту же роль играет мгновенная ветка selectTab, transition.ts:258-270).
    if (document.body.classList.contains('animation-level-0')) {
      markInited(tab)
      return
    }

    // transition.ts:300-322
    const toRight = fromIdx < toIdx
    content.classList.add('animating')
    content.classList.toggle('backwards', !toRight)
    from.classList.remove('to')
    from.classList.add('from', 'active')
    to.classList.remove('from')
    to.classList.add('to')

    // slideTabs (transition.ts:56-70): стартовые transform → reflow → приходящий к 0
    const width = from.getBoundingClientRect().width
    const els = toRight ? [from, to] : [to, from]
    els[0].style.transform = `translate3d(${-width}px, 0, 0)`
    els[1].style.transform = `translate3d(${width}px, 0, 0)`
    void to.offsetWidth // reflow
    to.style.transform = ''

    const finish = () => {
      window.clearTimeout(timeout)
      from.removeEventListener('transitionend', onEnd)
      from.classList.remove('active', 'from')
      to.classList.remove('to')
      from.style.transform = ''
      content.classList.remove('animating', 'backwards')
      // tweb: onTransitionEnd → tab.init() (index.ts:289)
      markInited(tab)
    }
    const onEnd = (e: TransitionEvent) => {
      if (e.target === from) finish()
    }
    from.addEventListener('transitionend', onEnd)
    // фолбэк-таймер transitionTime + 100 (transition.ts:349); его id
    // остаётся в data-transition-timeout и не подчищается — как в tweb
    // (transition.ts:360 пишет и никогда не удаляет атрибут)
    const timeout = window.setTimeout(finish, ANIMATION_DURATION + 100)
    from.dataset.transitionTimeout = String(timeout)
    // повторное переключение до конца слайда доигрывает предыдущий мгновенно
    return finish
    // tabs меняется только вместе с колбэками-владельцами — на живом дропдауне
    // это константа, из deps намеренно исключён
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Открытие/закрытие 1:1 tweb DropdownHover.toggle: display='' → форс-reflow →
  // класс active (transition играет); закрытие: снять active → через 200 мс display:none.
  // Панель не размонтируется — скролл и состояние сохраняются между открытиями.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    if (open) {
      window.clearTimeout(hideTimer.current)
      el.style.display = ''
      void el.offsetLeft // force reflow
      el.classList.add('active')
    } else {
      el.classList.remove('active')
      hideTimer.current = window.setTimeout(() => {
        el.style.display = 'none'
        onExitComplete?.()
      }, ANIMATION_DURATION)
    }
    // onExitComplete намеренно вне deps: важен только момент смены open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  // Esc — через глобальный Esc-стек (core/hotkeys): дропдаун закрывается
  // верхним, событие не доходит до фолбэка «закрыть чат».
  useEffect(() => {
    if (!open) return
    return pushEsc(onClose)
  }, [open, onClose])

  // Recent: LIFO, лимит 32 (tweb modifyRecentEmoji), сид POPULAR_EMOJI.
  const pickEmoji = useCallback(
    (e: string) => {
      onPick(e)
      setRecent((prev) => {
        const next = [e, ...prev.filter((x) => x !== e)].slice(0, RECENT_MAX)
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
        return next
      })
    },
    [onPick],
  )

  const frequent = recent.length ? recent : DEFAULT_FREQUENT
  const cats = useMemo(
    () => [{ key: 'recent', label: 'Frequently Used', emojis: frequent }, ...CATEGORIES],
    [frequent],
  )

  // Наборы кастом-эмодзи (композер): грузятся лениво при открытой вкладке эмодзи
  // и рендерятся отдельными категориями после нативных (tweb custom emoji sets).
  const customSets = useCustomEmojiSets(open && tab === 'emoji' && !!onPickCustomEmoji)
  const customCats = useMemo(
    () =>
      customSets
        .map(({ set, stickers }) => ({ key: `ce-${set.slug}`, title: set.title, thumb: setThumbMediaId(set, stickers), stickers }))
        .filter((c) => c.stickers.length > 0),
    [customSets],
  )

  // Число колонок — из фактической ширины скролл-контейнера (tweb setCategoryItemsHeight).
  useLayoutEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const compute = () => {
      const w = sc.clientWidth - GRID_PADDING
      setCols(Math.max(1, Math.floor((w + GAP_X) / (CELL + GAP_X))))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [])

  // Ленивая видимость категорий (tweb VisibilityIntersector).
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const io = new IntersectionObserver(
      (entries) => {
        setVisibleCats((prev) => {
          const next = new Set(prev)
          for (const en of entries) {
            const key = (en.target as HTMLElement).dataset.catKey
            if (!key) continue
            if (en.isIntersecting) next.add(key)
            else next.delete(key)
          }
          return next
        })
      },
      { root: sc },
    )
    for (const el of catElsRef.current.values()) io.observe(el)
    return () => io.disconnect()
    // пересоздаём при появлении кастом-категорий (грузятся асинхронно), чтобы IO
    // начал наблюдать их элементы (как StickersTab пересоздаёт на sections.length)
  }, [customCats.length])

  const register = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) {
      el.dataset.catKey = key
      catElsRef.current.set(key, el)
    } else {
      catElsRef.current.delete(key)
    }
  }, [])

  // `no-border-top` — по позиции скролла (tweb onAdditionalScroll, index.ts:646-651).
  const onScroll = () => {
    const sc = scrollRef.current
    if (sc) setAtTop(sc.scrollTop <= 0)
  }
  // Scroll-spy активной категории — StickyIntersector (он же вешает сентинелы
  // sticky_sentinel--top в каждую категорию), порт tweb menuOnClick.
  const { markJump } = useEmoticonsStickySpy({
    scrollRef,
    catEls: catElsRef,
    count: cats.length + customCats.length,
    onActive: setActiveCat,
  })
  useEffect(() => {
    menuRef.current
      ?.querySelector('.menu-horizontal-div-item.active')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [activeCat])

  const scrollToCat = (key: string) => {
    const el = catElsRef.current.get(key)
    const top = el ? el.offsetTop : 0
    markJump(top)
    scrollRef.current?.scrollTo({ top, behavior: 'smooth' })
    setActiveCat(key)
  }

  // Поиск (tweb EmoticonsSearch): текст или выбранная emoji-группа.
  const effectiveQuery = query.trim() || group?.q || ''
  const results = useMemo(
    () => (effectiveQuery ? searchEmojisByWord(effectiveQuery, 200, 1) : null),
    [effectiveQuery],
  )
  // .is-searching: панель сдвигается вверх при фокусе/запросе/группе (tweb tab.ts:176)
  const searching = focused || !!query.trim() || !!group
  // Вход в поиск — к началу, чтобы результаты не оказались вне вьюпорта
  const hasResults = results != null
  useEffect(() => {
    if (hasResults) scrollRef.current?.scrollTo({ top: 0 })
  }, [hasResults])

  // Лента категорий: recent — отдельной кнопкой, остальные — внутри
  // схлопывающегося `.menu-horizontal-inner` (tweb emoji.ts:463-467, раскрыт
  // классом `active`, когда активна одна из вложенных категорий — index.ts:538).
  const innerCats = cats.slice(1)
  const innerActive = innerCats.some((c) => c.key === activeCat)

  const emojiMenu = (
    <>
      <MenuTab active={activeCat === 'recent'} onClick={() => scrollToCat('recent')}>
        <TgIcon name={CAT_ICON.recent} size="inherit" />
      </MenuTab>
      <div
        className={classNames('menu-horizontal-inner', innerActive ? 'active' : '')}
        // tweb index.ts:600-606: клик по схлопнутой ленте выбирает её первый пункт
        onClick={innerActive ? undefined : () => innerCats[0] && scrollToCat(innerCats[0].key)}
      >
        <div className={classNames('scrollable', 'scrollable-x', 'menu-horizontal-inner-scroll')}>
          {innerCats.map((c) => (
            <MenuTab key={c.key} active={activeCat === c.key} onClick={() => scrollToCat(c.key)}>
              <TgIcon name={CAT_ICON[c.key]} size="inherit" />
            </MenuTab>
          ))}
        </div>
      </div>
      {customCats.map((c) => (
        <MenuTab key={c.key} notLocal active={activeCat === c.key} onClick={() => scrollToCat(c.key)}>
          {c.thumb != null ? <StickerMedia mediaId={c.thumb} width={32} height={32} /> : null}
        </MenuTab>
      ))}
    </>
  )

  // Нижние табы (tweb renderEmojiDropdownElement, index.ts:66-90). Кнопки есть
  // всегда — прячется по правилам index.ts:459-460 отдельная кнопка либо вся
  // полоса (`tabsToRender.length <= 1`). data-tab фиксирован разметкой tweb
  // (index.ts:77-88: search/delete −1, emoji 0, stickers 1, gifs 2).
  const tabButton = (id: TabId, dataTab: number, cls: string, icon: IconName) => (
    <IconButton
      noRipple
      data-tab={dataTab}
      className={classNames('menu-horizontal-div-item', cls, tab === id ? 'active' : '')}
      onClick={() => tabs.includes(id) && setTab(id)}
    >
      <TgIcon name={icon} size="inherit" className="button-icon" />
    </IconButton>
  )

  return (
    <div
      ref={rootRef}
      className={classNames('emoji-dropdown', className ?? '')}
      style={{ display: 'none' }}
      {...panelProps}
    >
      <div className="emoji-container">
        {/* data-animation="tabs" ставит TransitionSlider (transition.ts:186) */}
        <div ref={tabsContainerRef} className="tabs-container" data-animation="tabs">
          <EmoticonsTab
            padding="emoji-padding"
            contentId="content-emoji"
            active={tab === 'emoji'}
            searching={searching}
            noBorderTop={atTop || searching}
            menuRef={menuRef}
            menu={emojiMenu}
            scrollRef={scrollRef}
            onScroll={onScroll}
            search={
              <EmoticonsSearch
                inputRef={inputRef}
                value={query}
                onChange={setQuery}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={t('Search Emoji')}
                focused={searching}
                hasGroup={!!group}
                onGroupClear={() => setGroup(null)}
                chips={QUICK_CHIPS.map((c) => (
                  <div
                    key={c.e}
                    className={classNames(
                      'emoticons-search-input-category',
                      group?.e === c.e ? 'active' : '',
                    )}
                    onClick={() => setGroup((g) => (g?.e === c.e ? null : c))}
                  >
                    <div className="emoticons-search-input-category-sticker">
                      <Emoji e={c.e} size={24} />
                    </div>
                  </div>
                ))}
              />
            }
            result={
              results
                ? results.length
                  ? (
                    <div className="emoticons-categories-container emoticons-will-move-down emoticons-has-search animated-item">
                      {/* категория результатов: без заголовка и меню, paddingTop
                          .5rem и minHeight инлайном (tweb emoji.ts:288-289) */}
                      <div className="emoji-category" style={{ paddingTop: '.5rem' }}>
                        <div
                          className="category-items super-emojis"
                          style={{ minHeight: Math.ceil(results.length / cols) * CELL }}
                        >
                          {results.map((e) => (
                            <EmojiCell key={e} e={e} onPick={pickEmoji} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                  : <span className="emoticons-not-found animated-item">{t('No emoji found.')}</span>
                : undefined
            }
          >
            {cats.map((c) => (
              <EmojiCategory
                key={c.key}
                catKey={c.key}
                title={t(c.label)}
                emojis={c.emojis}
                cols={cols}
                visible={visibleCats.has(c.key)}
                onPick={pickEmoji}
                register={register}
              />
            ))}
            {onPickCustomEmoji &&
              customCats.map((c) => (
                <CustomEmojiCategory
                  key={c.key}
                  catKey={c.key}
                  title={c.title}
                  stickers={c.stickers}
                  cols={cols}
                  visible={visibleCats.has(c.key)}
                  onPick={onPickCustomEmoji}
                  register={register}
                />
              ))}
          </EmoticonsTab>
          {onPickSticker && (
            <StickersTab
              active={tab === 'stickers'}
              inited={initedTabs.has('stickers')}
              open={open}
              inputRef={stickersInputRef}
              onPick={(st) => {
                onPickSticker(st)
                onClose()
              }}
            />
          )}
          {onPickGif && (
            <GifsTab
              active={tab === 'gifs'}
              inited={initedTabs.has('gifs')}
              open={open}
              inputRef={gifsInputRef}
              onPick={(g) => {
                onPickGif(g)
                onClose()
              }}
            />
          )}
        </div>
      </div>

      {/* нижние табы (tweb .emoji-tabs.menu-horizontal-div.emoticons-menu.no-stripe) */}
      <div
        className={classNames(
          'emoji-tabs',
          'menu-horizontal-div',
          'emoticons-menu',
          'no-stripe',
          tabs.length <= 1 ? 'hide' : '',
        )}
      >
        {/* search: экраны поиска правой колонки — tweb index.ts:295-303
            (вкладка стикеров → AppStickersTab, иначе → AppGifsTab) */}
        <IconButton
          noRipple
          data-tab={-1}
          className={classNames(
            'menu-horizontal-div-item',
            'emoji-tabs-search',
            'justify-self-start',
            tab === 'emoji' ? 'hide' : '',
          )}
          onClick={() =>
            tab === 'stickers'
              ? openStickersSearchTab({ onPickSticker })
              : openGifsSearchTab({ onPick: onPickGif })
          }
        >
          <TgIcon name="search" size="inherit" className="button-icon" />
        </IconButton>
        {tabButton('emoji', 0, 'emoji-tabs-emoji', 'smile')}
        {tabButton('stickers', 1, 'emoji-tabs-stickers', 'stickers_face')}
        {tabButton('gifs', 2, 'emoji-tabs-gifs', 'gifs')}
        <IconButton
          noRipple
          data-tab={-1}
          className={classNames(
            'menu-horizontal-div-item',
            'emoji-tabs-delete',
            'justify-self-end',
            tab === 'emoji' ? '' : 'hide',
          )}
          onClick={onDelete}
        >
          <TgIcon name="deleteleft" size="inherit" className="button-icon" />
        </IconButton>
      </div>
    </div>
  )
}
