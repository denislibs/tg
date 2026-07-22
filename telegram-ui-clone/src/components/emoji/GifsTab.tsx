// Вкладка GIF эмодзи-дропдауна — порт tweb emoticonsDropdown/tabs/gifs (noMenu:
// без ленты категорий, сверху поиск). Сетка — tweb gifs-masonry упрощённо:
// ряды фиксированной высоты 117px, ширина элемента по аспекту, flex-wrap.
// Превью ленивое: <video>/<img> монтируется только когда ячейка в вьюпорте
// (IntersectionObserver), до того — серый плейсхолдер той же геометрии.
// Внизу результатов поиска — сентинел догрузки следующей страницы Tenor (next).
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import TgIcon from '../TgIcon'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import { useGifsPanel } from '../../core/hooks/useGifs'
import type { GifItem } from '../../core/gifs'
import { mediaContentUrl, hasMediaToken, useMediaTokenVersion } from '../../core/mediaUrl'
import { useT } from '../../i18n'
import s from './EmojiDropdown.module.scss'

// tweb GifsMasonry: const width = 117 — высота ряда кладки
const ROW_H = 117

const GifCell = memo(function GifCell({
  g,
  visible,
  tokenReady,
  onPick,
  onMenu,
  register,
}: {
  g: GifItem
  visible: boolean
  tokenReady: boolean
  onPick: (g: GifItem) => void
  onMenu: (g: GifItem, x: number, y: number) => void
  register: (key: string, el: HTMLElement | null) => void
}) {
  // Ширина по аспекту (width*117/height); flexGrow тем же числом — ряд
  // растягивается на всю ширину без дыр (как пакует tweb GifsMasonry).
  const w = Math.round((g.height > 0 ? g.width / g.height : 1) * ROW_H) || ROW_H
  let content = null
  if (visible) {
    if (g.mediaId != null) {
      // Сохранённые: наш сервер; mime решает тег (mp4-гифка ↔ настоящий image/gif)
      if (tokenReady) {
        content = g.mime === 'image/gif'
          ? <img src={mediaContentUrl(g.mediaId)} alt="" draggable={false} />
          : <video src={mediaContentUrl(g.mediaId)} muted loop autoPlay playsInline />
      }
    } else {
      // Tenor: mp4 легче gif, играет напрямую с CDN
      content = <video src={g.mp4Url} poster={g.previewUrl} muted loop autoPlay playsInline />
    }
  }
  return (
    <div
      ref={(el) => register(g.key, el)}
      className={s.gifCell}
      style={{ width: w, flexGrow: w }}
      onClick={() => onPick(g)}
      onContextMenu={g.mediaId != null ? (e) => { e.preventDefault(); onMenu(g, e.clientX, e.clientY) } : undefined}
    >
      {content}
    </div>
  )
})

function Masonry({
  items,
  visible,
  tokenReady,
  onPick,
  onMenu,
  register,
}: {
  items: GifItem[]
  visible: ReadonlySet<string>
  tokenReady: boolean
  onPick: (g: GifItem) => void
  onMenu: (g: GifItem, x: number, y: number) => void
  register: (key: string, el: HTMLElement | null) => void
}) {
  return (
    <div className={s.gifsMasonry}>
      {items.map((g) => (
        <GifCell key={g.key} g={g} visible={visible.has(g.key)} tokenReady={tokenReady} onPick={onPick} onMenu={onMenu} register={register} />
      ))}
    </div>
  )
}

export default function GifsTab({
  active,
  onPick,
}: {
  /** вкладка открыта (дропдаун виден и выбран таб GIF) — триггер ленивой загрузки */
  active: boolean
  onPick: (g: GifItem) => void
}) {
  const t = useT()
  useMediaTokenVersion() // URL сохранённых GIF строятся синхронно из токена
  const tokenReady = hasMediaToken()
  const [query, setQuery] = useState('')
  const panel = useGifsPanel(active, query)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const cellsRef = useRef(new Map<string, HTMLElement>())
  const ioRef = useRef<IntersectionObserver | null>(null)
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set())
  const [ctxMenu, setCtxMenu] = useState<{ g: GifItem; x: number; y: number } | null>(null)

  // Один IO на все ячейки: монтируем медиа только видимым (+запас в ряд сверху/снизу).
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev)
          for (const en of entries) {
            const key = (en.target as HTMLElement).dataset.gifKey
            if (!key) continue
            if (en.isIntersecting) next.add(key)
            else next.delete(key)
          }
          return next
        })
      },
      { root: sc, rootMargin: `${ROW_H}px 0px` },
    )
    ioRef.current = io
    for (const el of cellsRef.current.values()) io.observe(el)
    return () => { io.disconnect(); ioRef.current = null }
  }, [])

  const register = useCallback((key: string, el: HTMLElement | null) => {
    const prev = cellsRef.current.get(key)
    if (el) {
      el.dataset.gifKey = key
      cellsRef.current.set(key, el)
      ioRef.current?.observe(el)
    } else if (prev) {
      ioRef.current?.unobserve(prev)
      cellsRef.current.delete(key)
    }
  }, [])

  // Infinite scroll результатов: сентинел внизу дёргает следующую страницу Tenor.
  const searching = panel.results != null
  const loadMore = panel.loadMore
  useEffect(() => {
    const el = sentinelRef.current
    const sc = scrollRef.current
    if (!searching || !el || !sc) return
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore() },
      { root: sc, rootMargin: `${ROW_H * 2}px 0px` },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [searching, loadMore])

  const openCtxMenu = useCallback((g: GifItem, x: number, y: number) => setCtxMenu({ g, x, y }), [])

  const empty = panel.loaded && !searching && panel.saved.length === 0 && !panel.tenorAvailable

  return (
    <div className={s.emoticonsContainer}>
      <div className={s.emoticonsContent}>
        <div ref={scrollRef} className={s.stickersScrollable}>
          {/* поиск (tweb emoticons-search-container); без Tenor поиска нет */}
          {panel.tenorAvailable && (
            <div className={s.searchContainer}>
              <TgIcon name="search" size={20} className={s.searchIcon} />
              <input
                className={s.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Search GIFs')}
              />
            </div>
          )}

          {searching ? (
            panel.results!.length ? (
              <>
                <Masonry items={panel.results!} visible={visible} tokenReady={tokenReady} onPick={onPick} onMenu={openCtxMenu} register={register} />
                <div ref={sentinelRef} style={{ height: 1 }} />
              </>
            ) : (
              <span className={s.notFound}>{t('No GIFs found')}</span>
            )
          ) : (
            <>
              {panel.saved.length > 0 && (
                <div className={s.emojiCategory}>
                  <div className={s.categoryTitle}>{t('Saved GIFs')}</div>
                  <Masonry items={panel.saved} visible={visible} tokenReady={tokenReady} onPick={onPick} onMenu={openCtxMenu} register={register} />
                </div>
              )}
              {panel.featured.length > 0 && (
                <div className={s.emojiCategory}>
                  <div className={s.categoryTitle}>{t('Trending')}</div>
                  <Masonry items={panel.featured} visible={visible} tokenReady={tokenReady} onPick={onPick} onMenu={openCtxMenu} register={register} />
                </div>
              )}
              {empty && <span className={s.notFound}>{t('No GIFs found')}</span>}
            </>
          )}
        </div>
      </div>

      {/* ПКМ по сохранённому GIF (tweb gif context menu) */}
      {ctxMenu && (
        <Menu
          open
          onClose={() => setCtxMenu(null)}
          zIndex={2100}
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 220), top: Math.min(ctxMenu.y, window.innerHeight - 60), transformOrigin: 'top left' }}
        >
          <MenuItem
            icon={<TgIcon name="crossgif" size={20} />}
            label={t('Delete GIF')}
            onClick={() => {
              if (ctxMenu.g.mediaId != null) panel.removeSaved(ctxMenu.g.mediaId)
              setCtxMenu(null)
            }}
          />
        </Menu>
      )}
    </div>
  )
}
