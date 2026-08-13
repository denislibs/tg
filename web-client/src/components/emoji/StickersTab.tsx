// Вкладка стикеров эмодзи-дропдауна — порт tweb emoticonsDropdown/tabs/stickers:
// контейнер `.tabs-tab.emoticons-container.stickers-padding`, сверху лента
// категорий (recent, faved, первый стикер каждого набора), в скролле — поиск и
// секции `.emoji-category > .category-title + .category-items.super-stickers`
// с ячейками `div.grid-item.super-sticker` (SuperStickerRenderer.ts:61).
// Ленивый рендер секций тем же IntersectionObserver-паттерном, что у эмодзи:
// ячейки только у видимых, minHeight зарезервирован заранее.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import TgIcon, { type IconName } from '../TgIcon'
import StickerMedia from '../StickerMedia'
import EmoticonsTab, { EmoticonsSearch, MenuTab } from './EmoticonsTab'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import { useStickersPanel } from '../../core/hooks/useStickers'
import type { Sticker } from '../../core/managers/stickersManager'
import { useT } from '../../i18n'

// tweb base.scss: --esg-sticker-size 72px (desktop); EmoticonsTabStyles.Stickers
// gapX/gapY 4, padding 3*2.
const CELL = 72
const GAP = 4
const PAD = 6

const StickerCell = memo(function StickerCell({
  st,
  onPick,
  onMenu,
}: {
  st: Sticker
  onPick: (st: Sticker) => void
  onMenu: (st: Sticker, x: number, y: number) => void
}) {
  return (
    <div
      className="grid-item super-sticker"
      onClick={() => onPick(st)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(st, e.clientX, e.clientY)
      }}
    >
      {/* tweb mediaSizes.active.esgSticker = 72×72 — стикер занимает всю ячейку */}
      <StickerMedia mediaId={st.mediaId} width={CELL} height={CELL} playOnHover loop thumb={st.thumb} />
    </div>
  )
})

interface Section {
  key: string
  title: string
  icon?: IconName // иконка пункта меню (recent/faved); у наборов — превью стикера
  thumb?: number // mediaId первого стикера набора для меню
  stickers: Sticker[]
}

export default function StickersTab({
  active,
  inited,
  open,
  inputRef,
  onPick,
}: {
  /** выбранная вкладка (tweb `.tabs-tab.active`) */
  active: boolean
  /** вкладку уже открывали — tweb инициализирует вкладку при первом выборе,
   * до этого `no-border-top` на неё не вешается (index.ts:658) */
  inited: boolean
  /** дропдаун открыт — триггер ленивой загрузки данных */
  open: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onPick: (st: Sticker) => void
}) {
  const t = useT()
  const panel = useStickersPanel(open && active)
  const scrollRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLElement>(null)
  const catElsRef = useRef(new Map<string, HTMLDivElement>())
  const [visibleCats, setVisibleCats] = useState<ReadonlySet<string>>(new Set())
  const [activeCat, setActiveCat] = useState('recent')
  const [cols, setCols] = useState(5)
  const [ctxMenu, setCtxMenu] = useState<{ st: Sticker; x: number; y: number } | null>(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [atTop, setAtTop] = useState(true)

  const allSections = useMemo<Section[]>(() => {
    const list: Section[] = []
    if (panel.recent.length) list.push({ key: 'recent', title: t('Frequently Used'), icon: 'recent', stickers: panel.recent })
    if (panel.faved.length) list.push({ key: 'faved', title: t('Favorites'), icon: 'favourites', stickers: panel.faved })
    for (const { set, stickers } of panel.sets) {
      if (stickers.length) list.push({ key: `set-${set.slug}`, title: set.title, thumb: stickers[0].mediaId, stickers })
    }
    return list
  }, [panel.recent, panel.faved, panel.sets, t])

  // отступление от tweb: у него поиск стикеров серверный
  // (appStickersManager.searchStickers), у нас такого запроса в managers нет —
  // фильтруем уже загруженные наборы по эмодзи стикера и названию набора.
  // Слой данных при этом не трогаем (правило проекта).
  const q = query.trim().toLowerCase()
  const results = useMemo(() => {
    if (!q) return null
    const seen = new Set<number>()
    const out: Sticker[] = []
    for (const sec of allSections) {
      const byTitle = sec.title.toLowerCase().includes(q)
      for (const st of sec.stickers) {
        if (seen.has(st.id)) continue
        if (byTitle || st.emoji?.includes(q)) {
          seen.add(st.id)
          out.push(st)
        }
      }
    }
    return out
  }, [q, allSections])

  const sections = allSections
  const searching = focused || !!q

  // Число колонок из фактической ширины (как у эмодзи-сетки).
  useLayoutEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const compute = () => {
      const w = sc.clientWidth - PAD
      setCols(Math.max(1, Math.floor((w + GAP) / (CELL + GAP))))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [])

  // Ленивая видимость секций (tweb VisibilityIntersector). Пересоздаётся при
  // изменении состава секций (данные пришли/установили набор).
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
  }, [sections.length])

  const register = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) {
      el.dataset.catKey = key
      catElsRef.current.set(key, el)
    } else {
      catElsRef.current.delete(key)
    }
  }, [])

  // Scroll-spy активной категории + автоподскролл меню (как у эмодзи).
  const spyRaf = useRef(0)
  const onScroll = () => {
    cancelAnimationFrame(spyRaf.current)
    spyRaf.current = requestAnimationFrame(() => {
      const sc = scrollRef.current
      if (!sc) return
      setAtTop(sc.scrollTop <= 0)
      const top = sc.scrollTop + 50
      let cur = sections[0]?.key
      for (const c of sections) {
        const el = catElsRef.current.get(c.key)
        if (el && el.offsetTop <= top) cur = c.key
      }
      if (cur) setActiveCat(cur)
    })
  }
  useEffect(() => {
    menuRef.current
      ?.querySelector('.menu-horizontal-div-item.active')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [activeCat])

  const scrollToCat = (key: string) => {
    const el = catElsRef.current.get(key)
    scrollRef.current?.scrollTo({ top: el ? el.offsetTop : 0, behavior: 'smooth' })
    setActiveCat(key)
  }

  const pick = (st: Sticker) => {
    panel.markUsed(st)
    onPick(st)
  }
  const openCtxMenu = useCallback((st: Sticker, x: number, y: number) => setCtxMenu({ st, x, y }), [])

  const ctxFaved = ctxMenu != null && panel.faved.some((x) => x.id === ctxMenu.st.id)

  const grid = (list: Sticker[], minHeight?: number) => (
    <div className="category-items super-stickers" style={minHeight ? { minHeight } : undefined}>
      {list.map((st) => (
        <StickerCell key={st.id} st={st} onPick={pick} onMenu={openCtxMenu} />
      ))}
    </div>
  )

  return (
    <>
      <EmoticonsTab
        padding="stickers-padding"
        active={active}
        searching={searching}
        noBorderTop={inited && (atTop || searching)}
        menuRef={menuRef}
        menu={sections.map((c) => (
          <MenuTab
            key={c.key}
            notLocal={!c.icon}
            active={activeCat === c.key}
            onClick={() => scrollToCat(c.key)}
          >
            {c.icon ? (
              <TgIcon name={c.icon} size="inherit" />
            ) : c.thumb != null ? (
              <StickerMedia mediaId={c.thumb} width={32} height={32} />
            ) : null}
          </MenuTab>
        ))}
        scrollRef={scrollRef}
        onScroll={onScroll}
        search={
          <EmoticonsSearch
            inputRef={inputRef}
            value={query}
            onChange={setQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={t('Search Stickers')}
            focused={searching}
          />
        }
        result={
          results
            ? results.length
              ? (
                <div className="emoticons-categories-container emoticons-will-move-down emoticons-has-search animated-item">
                  <div className="emoji-category">{grid(results)}</div>
                </div>
              )
              : <span className="emoticons-not-found animated-item">{t('No stickers found')}</span>
            : undefined
        }
      >
        {sections.map((c) => {
          const rows = Math.ceil(c.stickers.length / cols)
          return (
            <div key={c.key} ref={(el) => register(c.key, el)} className="emoji-category">
              <div className="category-title">{c.title}</div>
              {visibleCats.has(c.key)
                ? grid(c.stickers, rows * CELL)
                : <div className="category-items super-stickers" style={{ minHeight: rows * CELL }} />}
            </div>
          )
        })}
        {panel.loaded && sections.length === 0 && (
          <span className="emoticons-not-found">{t('No stickers found')}</span>
        )}
      </EmoticonsTab>

      {/* ПКМ/long-press по стикеру: избранное (tweb sticker context menu) */}
      {ctxMenu && (
        <Menu
          open
          onClose={() => setCtxMenu(null)}
          zIndex={2100}
          corner="bottom-right"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 220), top: Math.min(ctxMenu.y, window.innerHeight - 60) }}
        >
          <MenuItem
            icon={<TgIcon name={ctxFaved ? 'crossstar' : 'favourites'} size={20} />}
            label={t(ctxFaved ? 'Remove from Favorites' : 'Add to Favorites')}
            onClick={() => {
              if (ctxFaved) panel.unfave(ctxMenu.st)
              else panel.fave(ctxMenu.st)
              setCtxMenu(null)
            }}
          />
        </Menu>
      )}
    </>
  )
}
