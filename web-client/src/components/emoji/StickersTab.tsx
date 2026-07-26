// Вкладка стикеров эмодзи-дропдауна — порт tweb emoticonsDropdown/tabs/stickers:
// сверху menu-wrapper с превью категорий (recent, faved, первый стикер каждого
// набора), ниже скролл с секциями. Ленивый рендер секций тем же
// IntersectionObserver-паттерном, что эмодзи (ячейки только у видимых, minHeight
// зарезервирован заранее). Сетка — tweb .super-stickers: ячейка 72px
// (--esg-sticker-size), gap .25rem, padding 0 .1875rem.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import TgIcon, { type IconName } from '../TgIcon'
import StickerMedia from '../StickerMedia'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import { useStickersPanel } from '../../core/hooks/useStickers'
import type { Sticker } from '../../core/managers/stickersManager'
import { useT } from '../../i18n'
import classNames from '../../shared/lib/classNames'
import s from './EmojiDropdown.module.scss'

// tweb base.scss: --esg-sticker-size 72px (desktop), gap .25rem, padding 0 .1875rem
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
    <span
      className={s.superSticker}
      onClick={() => onPick(st)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(st, e.clientX, e.clientY)
      }}
    >
      <StickerMedia mediaId={st.mediaId} width={CELL - 8} height={CELL - 8} playOnHover loop />
    </span>
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
  onPick,
}: {
  /** вкладка открыта (дропдаун виден и выбран таб стикеров) — триггер ленивой загрузки */
  active: boolean
  onPick: (st: Sticker) => void
}) {
  const t = useT()
  const panel = useStickersPanel(active)
  const scrollRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLElement>(null)
  const catElsRef = useRef(new Map<string, HTMLDivElement>())
  const [visibleCats, setVisibleCats] = useState<ReadonlySet<string>>(new Set())
  const [activeCat, setActiveCat] = useState('recent')
  const [cols, setCols] = useState(5)
  const [ctxMenu, setCtxMenu] = useState<{ st: Sticker; x: number; y: number } | null>(null)

  const sections = useMemo<Section[]>(() => {
    const list: Section[] = []
    if (panel.recent.length) list.push({ key: 'recent', title: t('Frequently Used'), icon: 'recent', stickers: panel.recent })
    if (panel.faved.length) list.push({ key: 'faved', title: t('Favorites'), icon: 'favourites', stickers: panel.faved })
    for (const { set, stickers } of panel.sets) {
      if (stickers.length) list.push({ key: `set-${set.slug}`, title: set.title, thumb: stickers[0].mediaId, stickers })
    }
    return list
  }, [panel.recent, panel.faved, panel.sets, t])

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
      ?.querySelector(`.${s.active}`)
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

  return (
    <div className={s.emoticonsContainer}>
      <div className={s.menuWrapper}>
        <nav ref={menuRef} className={s.emoticonsMenu}>
          {sections.map((c) => (
            <button
              key={c.key}
              type="button"
              className={classNames(s.menuItem, activeCat === c.key ? s.active : '')}
              onClick={() => scrollToCat(c.key)}
            >
              {c.icon ? <TgIcon name={c.icon} size={24} /> : c.thumb != null ? <StickerMedia mediaId={c.thumb} width={24} height={24} /> : null}
            </button>
          ))}
        </nav>
      </div>

      <div className={s.emoticonsContent}>
        <div ref={scrollRef} className={s.stickersScrollable} onScroll={onScroll}>
          <div className={s.categoriesContainer}>
            {sections.map((c) => {
              const rows = Math.ceil(c.stickers.length / cols)
              return (
                <div key={c.key} ref={(el) => register(c.key, el)} className={s.emojiCategory}>
                  <div className={s.categoryTitle}>{c.title}</div>
                  <div className={s.superStickers} style={{ minHeight: rows * CELL }}>
                    {visibleCats.has(c.key) &&
                      c.stickers.map((st) => (
                        <StickerCell key={st.id} st={st} onPick={pick} onMenu={openCtxMenu} />
                      ))}
                  </div>
                </div>
              )
            })}
            {panel.loaded && sections.length === 0 && (
              <span className={s.notFound}>{t('No stickers found')}</span>
            )}
          </div>
        </div>
      </div>

      {/* ПКМ/long-press по стикеру: избранное (tweb sticker context menu) */}
      {ctxMenu && (
        <Menu
          open
          onClose={() => setCtxMenu(null)}
          zIndex={2100}
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 220), top: Math.min(ctxMenu.y, window.innerHeight - 60), transformOrigin: 'top left' }}
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
    </div>
  )
}
