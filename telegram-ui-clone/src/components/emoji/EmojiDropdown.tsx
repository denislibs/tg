// Эмодзи-дропдаун — React-порт tweb EmoticonsDropdown (components/emoticonsDropdown).
// Вёрстка и поведение 1:1:
//  - открытие по hover с задержкой 200 мс (tweb DropdownHover TOGGLE_TIMEOUT), клик — toggle;
//  - анимация scale(.85)→1 + fade за .2s через класс .active (не unmount — сохраняем скролл);
//  - ленивый рендер: содержимое категории живёт в DOM только пока категория видима
//    (tweb VisibilityIntersector), у невидимых — заранее посчитанный minHeight,
//    чтобы скролл не прыгал (tweb setCategoryItemsHeight);
//  - меню категорий сверху со скролл-подсветкой, поиск со сдвигом панели вверх
//    (tweb .is-searching / emoticons-will-move-*), полоска emoji-групп справа от поиска;
//  - нижние табы: search / emoji / stickers / backspace (tweb .emoji-tabs); обе
//    вкладки живут в DOM (переключение display), состояние/скролл сохраняются.
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
import type { Sticker } from '../../core/managers/stickersManager'
import { CATEGORIES, DEFAULT_FREQUENT, QUICK_CHIPS, searchEmojisByWord } from './emojiData'
import { useT } from '../../i18n'
import classNames from '../../shared/lib/classNames'
import s from './EmojiDropdown.module.scss'

// tweb DropdownHover: TOGGLE_TIMEOUT = 200 (hover open/close), ANIMATION_DURATION = 200
const TOGGLE_TIMEOUT = 200
const ANIMATION_DURATION = 200
const IS_TOUCH = typeof window !== 'undefined' && 'ontouchstart' in window

// Метрики сетки из tweb: ячейка 42px (--esg-emoji-total-size), column-gap 4px,
// горизонтальный padding .super-emojis 8px×2 (emoji-padding).
const CELL = 42
const GAP_X = 4
const GRID_PADDING = 16

const RECENT_KEY = 'tg-emoji-recent'
const RECENT_MAX = 32 // tweb RECENT_MAX_LENGTH

// tgico-иконки категорий (порядок и глифы — tweb EMOJI_CATEGORIES; у категории
// symbols в tweb нет своей вкладки, глиф language — ближайший по смыслу).
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

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  } catch {
    return []
  }
}

// ── Hover-открытие (tweb DropdownHover.attachButtonListener) ─────────────────
// Кнопка: mouseenter → таймер 200 мс → open; mouseleave → таймер 200 мс → close.
// Панель: mouseenter отменяет закрытие, mouseleave снова взводит. Клик — toggle.
// Touch: только клик. Клик вне панели/кнопки закрывает (кроме ignore-целей).
export function useDropdownHover(ignore?: (target: Node) => boolean) {
  const [open, setOpen] = useState(false)
  const openTimer = useRef(0)
  const closeTimer = useRef(0)
  const buttonRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const ignoreRef = useRef(ignore)
  ignoreRef.current = ignore

  const clearTimers = useCallback(() => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
  }, [])
  const close = useCallback(() => {
    clearTimers()
    setOpen(false)
  }, [clearTimers])

  // out-click (tweb onButtonClick → window click listener)
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (buttonRef.current?.contains(t) || panelRef.current?.contains(t)) return
      if (ignoreRef.current?.(t)) return
      close()
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open, close])

  const buttonProps = {
    onMouseEnter: () => {
      if (IS_TOUCH) return
      window.clearTimeout(closeTimer.current)
      window.clearTimeout(openTimer.current)
      openTimer.current = window.setTimeout(() => setOpen(true), TOGGLE_TIMEOUT)
    },
    onMouseLeave: () => {
      if (IS_TOUCH) return
      window.clearTimeout(openTimer.current)
      window.clearTimeout(closeTimer.current)
      closeTimer.current = window.setTimeout(() => setOpen(false), TOGGLE_TIMEOUT)
    },
    onClick: () => {
      clearTimers()
      setOpen((o) => !o)
    },
  }
  const panelProps = {
    onMouseEnter: () => window.clearTimeout(closeTimer.current),
    onMouseLeave: () => {
      if (IS_TOUCH) return
      window.clearTimeout(closeTimer.current)
      closeTimer.current = window.setTimeout(() => setOpen(false), TOGGLE_TIMEOUT)
    },
  }

  useEffect(() => clearTimers, [clearTimers])

  return { open, close, buttonRef, panelRef, buttonProps, panelProps }
}

// ── Ячейка эмодзи (tweb appendEmoji: span.super-emoji > img.emoji) ───────────
// Плейсхолдер-кружок до загрузки + fade-in; уже загружавшиеся URL пропускают
// плейсхолдер (tweb loadedURLs), чтобы не мигать при перемонтировании категории.
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
  if (attempt >= 2) {
    content = <span className={s.emojiNative}>{e}</span>
  } else {
    const file = emojiCodepoints(e, attempt === 1)
    content = (
      <>
        {!loaded && <span className={s.emojiPlaceholder} />}
        <img
          className={classNames(s.emojiImg, loaded ? s.loaded : '')}
          src={`${EMOJI_CDN_BASE}${file}.png`}
          alt={e}
          loading="lazy"
          draggable={false}
          onLoad={() => {
            loadedEmojis.add(e)
            setLoaded(true)
          }}
          onError={() => setAttempt((a) => a + 1)}
        />
      </>
    )
  }
  return (
    <span className={s.superEmoji} onClick={() => onPick(e)}>
      {content}
    </span>
  )
})

// ── Категория (tweb emoji-category) ──────────────────────────────────────────
// Сетка резервирует высоту (rows × 42px) всегда; сами ячейки рендерятся только
// когда категория видима (tweb onCategoryVisibility replaceChildren).
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
    <div ref={(el) => register(catKey, el)} className={s.emojiCategory}>
      <div className={s.categoryTitle}>{title}</div>
      <div className={s.superEmojis} style={{ minHeight: rows * CELL }}>
        {visible && emojis.map((e, i) => <EmojiCell key={`${e}-${i}`} e={e} onPick={onPick} />)}
      </div>
    </div>
  )
})

// ── Дропдаун ─────────────────────────────────────────────────────────────────
export default function EmojiDropdown({
  open,
  onPick,
  onPickSticker,
  onClose,
  onDelete,
  onExitComplete,
  className,
  panelProps,
}: {
  open: boolean
  onPick: (emoji: string) => void
  /** включает вкладку стикеров (композер); выбор закрывает дропдаун (tweb) */
  onPickSticker?: (st: Sticker) => void
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
  // Вкладки нижней панели (tweb tabs-container): обе в DOM, переключение display;
  // вкладка стикеров монтируется лениво при первом открытии.
  const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji')
  const [stickersMounted, setStickersMounted] = useState(false)
  if (tab === 'stickers' && !stickersMounted) setStickersMounted(true)

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
      el.classList.add(s.active)
    } else {
      el.classList.remove(s.active)
      hideTimer.current = window.setTimeout(() => {
        el.style.display = 'none'
        onExitComplete?.()
      }, ANIMATION_DURATION)
    }
    // onExitComplete намеренно вне deps: важен только момент смены open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
  }, [])

  const register = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) {
      el.dataset.catKey = key
      catElsRef.current.set(key, el)
    } else {
      catElsRef.current.delete(key)
    }
  }, [])

  // Scroll-spy: активная категория в меню + автоподскролл меню к её иконке.
  const spyRaf = useRef(0)
  const onScroll = () => {
    cancelAnimationFrame(spyRaf.current)
    spyRaf.current = requestAnimationFrame(() => {
      const sc = scrollRef.current
      if (!sc) return
      const top = sc.scrollTop + 50
      let cur = cats[0]?.key
      for (const c of cats) {
        const el = catElsRef.current.get(c.key)
        if (el && el.offsetTop <= top) cur = c.key
      }
      if (cur) setActiveCat(cur)
    })
  }
  useEffect(() => {
    menuRef.current
      ?.querySelector(`.${s.active}`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [activeCat])

  const scrollToCat = (key: string) => {
    const el = catElsRef.current.get(key)
    scrollRef.current?.scrollTo({ top: el ? el.offsetTop : 0, behavior: 'smooth' })
    setActiveCat(key)
  }

  // Поиск (tweb EmoticonsSearch): текст или выбранная emoji-группа.
  const effectiveQuery = query.trim() || group?.q || ''
  const results = useMemo(
    () => (effectiveQuery ? searchEmojisByWord(effectiveQuery, 200, 1) : null),
    [effectiveQuery],
  )
  // .is-searching: панель сдвигается вверх при фокусе/запросе/группе (tweb tab.ts)
  const searching = focused || !!query.trim() || !!group
  // Вход в поиск — к началу, чтобы результаты не оказались вне вьюпорта
  const hasResults = results != null
  useEffect(() => {
    if (hasResults) scrollRef.current?.scrollTo({ top: 0 })
  }, [hasResults])

  return (
    <div
      ref={rootRef}
      className={classNames(s.emojiDropdown, className ?? '')}
      style={{ display: 'none' }}
      {...panelProps}
    >
      <div className={s.emojiContainer}>
        <div className={s.tabsContainer}>
          <div
            className={classNames(s.emoticonsContainer, searching ? s.isSearching : '')}
            style={tab === 'emoji' ? undefined : { display: 'none' }}
          >
            {/* menu-wrapper: лента иконок категорий */}
            <div className={classNames(s.menuWrapper, s.willMoveUp)}>
              <nav ref={menuRef} className={s.emoticonsMenu}>
                {cats.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={classNames(s.menuItem, activeCat === c.key ? s.active : '')}
                    onClick={() => scrollToCat(c.key)}
                  >
                    <TgIcon name={CAT_ICON[c.key]} size={24} />
                  </button>
                ))}
              </nav>
            </div>

            <div className={s.emoticonsContent}>
              <div ref={scrollRef} className={classNames(s.scrollable, s.willMoveUp)} onScroll={onScroll}>
                {/* строка поиска + emoji-группы (tweb emoticons-search-container) */}
                <div className={classNames(s.searchContainer, s.willMoveDown)}>
                  {group ? (
                    <button type="button" className={s.searchArrow} onClick={() => setGroup(null)}>
                      <TgIcon name="arrow_prev" size={24} />
                    </button>
                  ) : (
                    <TgIcon name="search" size={20} className={s.searchIcon} />
                  )}
                  <input
                    ref={inputRef}
                    className={s.searchInput}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder={t('Search Emoji')}
                  />
                  <div className={classNames(s.searchGroups, query.trim() ? s.hidden : '')}>
                    {QUICK_CHIPS.map((c) => (
                      <div
                        key={c.e}
                        className={classNames(s.searchGroup, group?.e === c.e ? s.active : '')}
                        onClick={() => setGroup((g) => (g?.e === c.e ? null : c))}
                      >
                        <Emoji e={c.e} size={24} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* категории; при поиске скрываются, показываются результаты */}
                <div
                  className={classNames(s.categoriesContainer, s.willMoveDown)}
                  style={results ? { display: 'none' } : undefined}
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
                </div>
                {results &&
                  (results.length ? (
                    <div className={classNames(s.superEmojis, s.willMoveDown)}>
                      {results.map((e) => (
                        <EmojiCell key={e} e={e} onPick={pickEmoji} />
                      ))}
                    </div>
                  ) : (
                    <span className={s.notFound}>{t('No emoji found.')}</span>
                  ))}
              </div>
            </div>
          </div>
          {/* вкладка стикеров: keep-mounted после первого открытия (tweb tabs) */}
          {stickersMounted && onPickSticker && (
            <div style={tab === 'stickers' ? { height: '100%' } : { display: 'none' }}>
              <StickersTab
                active={open && tab === 'stickers'}
                onPick={(st) => {
                  onPickSticker(st)
                  onClose()
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* нижние табы: search / emoji / stickers / delete (tweb .emoji-tabs) */}
      <div className={s.emojiTabs}>
        {tab === 'emoji' && (
          <button
            type="button"
            className={classNames(s.tabBtn, s.tabSearch)}
            onClick={() => inputRef.current?.focus()}
          >
            <TgIcon name="search" size={24} />
          </button>
        )}
        <button
          type="button"
          className={classNames(s.tabBtn, tab === 'emoji' ? s.active : '')}
          onClick={() => setTab('emoji')}
        >
          <TgIcon name="smile" size={24} />
        </button>
        {onPickSticker && (
          <button
            type="button"
            className={classNames(s.tabBtn, tab === 'stickers' ? s.active : '')}
            onClick={() => setTab('stickers')}
          >
            <TgIcon name="stickers_face" size={24} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className={classNames(s.tabBtn, s.tabDelete)}
            onClick={onDelete}
          >
            <TgIcon name="deleteleft" size={24} />
          </button>
        )}
      </div>
    </div>
  )
}
