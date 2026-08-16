// GifsMasonry — общая кладка GIF (порт роли tweb `components/gifsMasonry.ts`:
// в tweb ОДИН класс GifsMasonry обслуживает и вкладку GIF дропдауна, и экран
// «Поиск GIF» правой колонки — sidebarRight/tabs/gifs.tsx:107). Разметка ячейки —
// tweb wrapVideo внутри кладки (дампы 19-emoticons-04/05):
//   div.gifs-masonry > div.gif.grid-item.media-gif-wrapper.media-container
//     [style="width: Npx; height: Mpx"]  ← размеры документа; сетка партиала
//     _gifsMasonry.scss перебивает их !important (width auto / height 0)
//     div.preloader-container            ← components/preloader.ts, пока медиа летит
//     video.media-video / img.media-photo
// Ленивость — как в GifsTab дропдауна: медиа монтируется только видимой ячейке
// (IntersectionObserver, хук useGifsMasonryVisibility ниже).
//
// Вкладка дропдауна (emoji/GifsTab.tsx) пока держит свою копию ячейки — её
// перевод на этот модуль отложен: файлы emoji/* параллельно правит другая
// задача (перевод — за оркестратором).
import { memo, useCallback, useRef, useState, type RefObject } from 'react'
import type { GifItem } from '../core/gifs'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import { useImperativeIsland } from '../core/hooks/useImperativeIsland'
import { useLazyVisibility, type LazyVisibility } from './useLazyVisibility'
import ProgressivePreloader from './preloader'

// tweb GifsMasonry: высота ряда кладки — запас rootMargin ленивой загрузки.
const ROW_H = 117

/**
 * Ленивость кладки — общий механизм `useLazyVisibility` (порт роли tweb
 * LazyLoadQueue): один IntersectionObserver на все ячейки. Здесь он лишь
 * фиксирует запас предзагрузки кладки — высоту ряда, как в tweb gifsMasonry.
 */
export function useGifsMasonryVisibility(scrollRef: RefObject<HTMLElement | null>): LazyVisibility {
  return useLazyVisibility(scrollRef, `${ROW_H}px 0px`)
}

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
  onMenu?: (g: GifItem, x: number, y: number) => void
  register: (key: string, el: HTMLElement | null) => void
}) {
  // Сохранённые GIF — воркерным конвейером (useMediaUrl); скачивание запускает
  // только видимая ячейка (ленивость IO сохранена: id → null).
  const savedUrl = useMediaUrl(visible && g.mediaId != null ? g.mediaId : null)
  const cellRef = useRef<HTMLElement | null>(null)
  // Прелоадер поверх ячейки, пока медиа не прокрасилось (tweb wrapVideo вешает
  // ProgressivePreloader на .media-container; наш components/preloader.ts).
  const [loaded, setLoaded] = useState(false)
  const markLoaded = useCallback(() => setLoaded(true), [])

  useImperativeIsland((cell) => {
    if (!visible || loaded) return
    const preloader = new ProgressivePreloader()
    preloader.attach(cell)
    return () => preloader.detach()
  }, [visible, loaded], { host: cellRef })

  let content = null
  if (visible) {
    if (g.mediaId != null) {
      // Сохранённые: наш сервер; mime решает тег (mp4-гифка ↔ настоящий image/gif)
      if (savedUrl) {
        content = g.mime === 'image/gif'
          ? <img className="media-photo" src={savedUrl} alt="" draggable={false} onLoad={markLoaded} />
          : <video className="media-video" src={savedUrl} muted loop autoPlay playsInline onLoadedData={markLoaded} />
      }
    } else {
      // Tenor: mp4 легче gif, играет напрямую с CDN
      content = <video className="media-video" src={g.mp4Url} poster={g.previewUrl} muted loop autoPlay playsInline onLoadedData={markLoaded} />
    }
  }
  return (
    <div
      ref={(el) => { cellRef.current = el; register(g.key, el) }}
      className="gif grid-item media-gif-wrapper media-container"
      // размеры документа, как их пишет tweb wrapVideo (сетка перебьёт !important)
      style={{ width: g.width || undefined, height: g.height || undefined }}
      onClick={() => onPick(g)}
      onContextMenu={onMenu && g.mediaId != null ? (e) => { e.preventDefault(); onMenu(g, e.clientX, e.clientY) } : undefined}
    >
      {content}
    </div>
  )
})

export default function GifsMasonry({
  items,
  visible,
  onPick,
  onMenu,
  register,
}: {
  items: GifItem[]
  visible: ReadonlySet<string>
  onPick: (g: GifItem) => void
  /** ПКМ по сохранённому GIF (контекст-меню дропдауна); у Tenor-результатов меню нет */
  onMenu?: (g: GifItem, x: number, y: number) => void
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
