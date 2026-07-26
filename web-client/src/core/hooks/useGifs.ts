// src/core/hooks/useGifs.ts
//
// ViewModel-хук вкладки GIF (tweb tabs/gifs): сохранённые GIF (наш сервер,
// гидрируются метой ради размеров masonry и mime) + Tenor-поиск с debounce
// 300мс и постраничной догрузкой по курсору next. Без TENOR_API_KEY бэк отдаёт
// пустую страницу — тогда tenorAvailable=false и UI показывает только
// «Сохранённые» без поиска.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useManagers } from './useManagers'
import type { GifItem } from '../gifs'
import type { TenorGif } from '../managers/stickersManager'

const tenorToItem = (g: TenorGif): GifItem => ({
  key: `t-${g.id}`,
  width: g.width,
  height: g.height,
  mp4Url: g.mp4Url,
  previewUrl: g.previewUrl,
})

export function useGifsPanel(active: boolean, query: string) {
  const managers = useManagers()
  const [saved, setSaved] = useState<GifItem[]>([])
  const [featured, setFeatured] = useState<GifItem[]>([])
  const [tenorAvailable, setTenorAvailable] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // null — режим «без запроса» (секции), [] — поиск ничего не нашёл.
  const [results, setResults] = useState<GifItem[] | null>(null)
  const startedRef = useRef(false)
  const reqRef = useRef(0)
  const queryRef = useRef('')
  const nextRef = useRef('')
  const loadingMoreRef = useRef(false)

  // Ленивая загрузка при первом открытии вкладки (как useStickersPanel):
  // сохранённые + первая страница трендов (searchGifs('') = featured у Tenor).
  useEffect(() => {
    if (!active || startedRef.current) return
    startedRef.current = true
    let alive = true
    void (async () => {
      const [savedGifs, feat] = await Promise.all([
        managers.stickers.savedGifs().catch(() => []),
        managers.stickers.searchGifs('', '').catch(() => ({ gifs: [], next: '' })),
      ])
      const metas = await Promise.all(savedGifs.map((g) => managers.media.meta(g.mediaId).catch(() => null)))
      if (!alive) return
      setSaved(savedGifs.flatMap((g, i) => {
        const m = metas[i]
        if (!m) return []
        return [{ key: `s-${g.mediaId}`, mediaId: g.mediaId, width: m.width, height: m.height, mime: m.mime, size: m.size, fileName: m.fileName }]
      }))
      setFeatured(feat.gifs.map(tenorToItem))
      setTenorAvailable(feat.gifs.length > 0)
      setLoaded(true)
    })()
    return () => { alive = false }
  }, [active, managers])

  // Поиск: debounce 300мс, устаревшие ответы отбрасываются по счётчику запросов.
  useEffect(() => {
    const q = query.trim()
    queryRef.current = q
    const req = ++reqRef.current
    if (!q || !tenorAvailable) {
      setResults(null)
      nextRef.current = ''
      return
    }
    const timer = window.setTimeout(() => {
      managers.stickers.searchGifs(q).then(
        (p) => {
          if (req !== reqRef.current) return
          setResults(p.gifs.map(tenorToItem))
          nextRef.current = p.next
        },
        () => {
          if (req !== reqRef.current) return
          setResults([])
          nextRef.current = ''
        },
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query, tenorAvailable, managers])

  // Догрузка следующей страницы результатов (IntersectionObserver-сентинел).
  const loadMore = useCallback(() => {
    const pos = nextRef.current
    const q = queryRef.current
    if (!q || !pos || loadingMoreRef.current) return
    loadingMoreRef.current = true
    nextRef.current = '' // защита от повторного запроса той же страницы (tweb)
    const req = reqRef.current
    managers.stickers.searchGifs(q, pos).then(
      (p) => {
        loadingMoreRef.current = false
        if (req !== reqRef.current) return
        setResults((cur) => [...(cur ?? []), ...p.gifs.map(tenorToItem)])
        nextRef.current = p.next
      },
      () => { loadingMoreRef.current = false },
    )
  }, [managers])

  // ПКМ «Удалить GIF»: локально сразу, DELETE — следом (оптимистично).
  const removeSaved = useCallback((mediaId: number) => {
    setSaved((cur) => cur.filter((g) => g.mediaId !== mediaId))
    void managers.stickers.deleteGif(mediaId).catch(() => {})
  }, [managers])

  return { saved, featured, tenorAvailable, loaded, results, loadMore, removeSaved }
}
