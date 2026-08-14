// Вкладка GIF эмодзи-дропдауна — порт tweb emoticonsDropdown/tabs/gifs
// (`noMenu: true`): контейнер `.tabs-tab.emoticons-container.no-menu.gifs-padding`,
// без ленты категорий, сверху поиск. Кладка — tweb GifsMasonry:
// `div.gifs-masonry > div.gif.grid-item` (gifsMasonry.ts:171), внутри
// `video.media-video` / `img.media-photo`; геометрию задаёт партиал
// styles/tweb/_gifsMasonry.scss (grid 3×, gap .125rem, ряды 1fr).
// Превью ленивое: <video>/<img> монтируется только когда ячейка в вьюпорте
// (IntersectionObserver). Внизу результатов поиска — сентинел догрузки Tenor.
import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import TgIcon from '../TgIcon'
import EmoticonsTab, { EmoticonsSearch } from './EmoticonsTab'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import { useGifsPanel } from '../../core/hooks/useGifs'
import type { GifItem } from '../../core/gifs'
import { useMediaUrl } from '../../core/hooks/useMediaUrl'
import { useT } from '../../i18n'
// Одно глобальное правило геометрии ячейки `.gif.grid-item` — импорт ради
// сайд-эффекта, локальных классов в файле нет (см. комментарий там).
import './EmojiDropdown.module.scss'

// tweb GifsMasonry: высота ряда кладки — запас для rootMargin ленивой загрузки.
const ROW_H = 117

const GifCell = memo(function GifCell({
  g,
  visible,
  onPick,
  onMenu,
  register,
}: {
  g: GifItem
  visible: boolean
  onPick: (g: GifItem) => void
  onMenu: (g: GifItem, x: number, y: number) => void
  register: (key: string, el: HTMLElement | null) => void
}) {
  // Task 7: сохранённые GIF — воркерным конвейером (useMediaUrl); скачивание
  // запускает только видимая ячейка (ленивость IO сохранена: id → null).
  const savedUrl = useMediaUrl(visible && g.mediaId != null ? g.mediaId : null)
  let content = null
  if (visible) {
    if (g.mediaId != null) {
      // Сохранённые: наш сервер; mime решает тег (mp4-гифка ↔ настоящий image/gif)
      if (savedUrl) {
        content = g.mime === 'image/gif'
          ? <img className="media-photo" src={savedUrl} alt="" draggable={false} />
          : <video className="media-video" src={savedUrl} muted loop autoPlay playsInline />
      }
    } else {
      // Tenor: mp4 легче gif, играет напрямую с CDN
      content = <video className="media-video" src={g.mp4Url} poster={g.previewUrl} muted loop autoPlay playsInline />
    }
  }
  return (
    <div
      ref={(el) => register(g.key, el)}
      className="gif grid-item"
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
  onPick,
  onMenu,
  register,
}: {
  items: GifItem[]
  visible: ReadonlySet<string>
  onPick: (g: GifItem) => void
  onMenu: (g: GifItem, x: number, y: number) => void
  register: (key: string, el: HTMLElement | null) => void
}) {
  return (
    <div className="gifs-masonry">
      {items.map((g) => (
        <GifCell key={g.key} g={g} visible={visible.has(g.key)} onPick={onPick} onMenu={onMenu} register={register} />
      ))}
    </div>
  )
}

export default function GifsTab({
  active,
  inited,
  open,
  inputRef,
  onPick,
}: {
  /** выбранная вкладка (tweb `.tabs-tab.active`) */
  active: boolean
  /** слайд на эту вкладку доигран — только тогда tweb зовёт `tab.init()`
   * (onTransitionEnd, index.ts:289); до этого вкладка пустая, чтобы
   * построение ленты не съедало кадры анимации */
  inited: boolean
  /** дропдаун открыт — триггер ленивой загрузки данных */
  open: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onPick: (g: GifItem) => void
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const panel = useGifsPanel(open && active && inited, query)
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
  const searchingResults = panel.results != null
  const loadMore = panel.loadMore
  useEffect(() => {
    const el = sentinelRef.current
    const sc = scrollRef.current
    if (!searchingResults || !el || !sc) return
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore() },
      { root: sc, rootMargin: `${ROW_H * 2}px 0px` },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [searchingResults, loadMore])

  const openCtxMenu = useCallback((g: GifItem, x: number, y: number) => setCtxMenu({ g, x, y }), [])

  const empty = panel.loaded && !searchingResults && panel.saved.length === 0 && !panel.tenorAvailable

  return (
    <>
      <EmoticonsTab
        padding="gifs-padding"
        contentId="content-gifs"
        noMenu
        active={active}
        // `is-searching` у noMenu-вкладки в tweb тоже выставляется (tab.ts:176),
        // но сдвигать нечего: классов emoticons-will-move-* у неё нет.
        searching={focused || !!query.trim()}
        scrollRef={scrollRef}
        search={
          <EmoticonsSearch
            inputRef={inputRef}
            value={query}
            onChange={setQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={t('Search GIFs')}
            focused={focused || !!query.trim()}
          />
        }
        result={
          searchingResults
            ? panel.results!.length
              ? (
                <div className="emoticons-categories-container emoticons-has-search animated-item">
                  <Masonry items={panel.results!} visible={visible} onPick={onPick} onMenu={openCtxMenu} register={register} />
                  <div ref={sentinelRef} style={{ height: 1 }} />
                </div>
              )
              : <span className="emoticons-not-found animated-item">{t('No GIFs found')}</span>
            : undefined
        }
      >
        {/* сохранённые GIF — кладка прямо в categories-container, без
            обёртки-категории и заголовка (tweb gifs.ts init:
            `this.categoriesContainer.append(gifsContainer)`) */}
        {panel.saved.length > 0 && (
          <Masonry items={panel.saved} visible={visible} onPick={onPick} onMenu={openCtxMenu} register={register} />
        )}
        {/* отступление от tweb: трендов Tenor в его ESG-вкладке нет вовсе
            (только сохранённые), у нас бэк отдаёт featured — показываем их
            отдельной категорией с заголовком, чтобы отделить от сохранённых */}
        {panel.featured.length > 0 && (
          <div className="emoji-category">
            <div className="category-title">{t('Trending')}</div>
            <Masonry items={panel.featured} visible={visible} onPick={onPick} onMenu={openCtxMenu} register={register} />
          </div>
        )}
        {empty && <span className="emoticons-not-found">{t('No GIFs found')}</span>}
      </EmoticonsTab>

      {/* ПКМ по сохранённому GIF (tweb gif context menu) */}
      {ctxMenu && (
        <Menu
          open
          onClose={() => setCtxMenu(null)}
          zIndex={2100}
          corner="bottom-right"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 220), top: Math.min(ctxMenu.y, window.innerHeight - 60) }}
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
    </>
  )
}
