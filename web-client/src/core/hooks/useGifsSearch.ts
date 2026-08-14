// useGifsSearch — ViewModel экрана «Поиск GIF» правой колонки (порт логики tweb
// sidebarRight/tabs/gifs.tsx): одна лента результатов Tenor, пустой запрос —
// тренды (у tweb — инлайн-выдача @gif с пустым q), догрузка следующей страницы
// по скроллу вниз (onScrolledBottom), «loadedAll» по пустой странице. Ввод
// дебаунсится 300мс (tweb InputSearch), первый прогон (тренды при открытии) —
// сразу, как search('') в onMount tweb-таба.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useManagers } from './useManagers'
import type { GifItem } from '../gifs'
import type { TenorGif } from '../managers/stickersManager'

// Tenor-результат → элемент кладки. Дубль приватного маппера из useGifs.ts:
// вынести общий нельзя, пока файлы вкладки дропдауна заморожены параллельной
// задачей (см. GifsMasonry.tsx) — свести к одному экспорту при её вливании.
const tenorToItem = (g: TenorGif): GifItem => ({
  key: `t-${g.id}`,
  width: g.width,
  height: g.height,
  mp4Url: g.mp4Url,
  previewUrl: g.previewUrl,
})

export function useGifsSearch(query: string) {
  const managers = useManagers()
  const [items, setItems] = useState<GifItem[]>([])
  // Устаревшие ответы отбрасываются счётчиком поколений (как useGifs/useGifsPanel).
  const reqRef = useRef(0)
  const queryRef = useRef('')
  const nextRef = useRef('')
  const searchingRef = useRef(false) // tweb: if(searchPromise) return
  const loadedAllRef = useRef(false) // tweb: loadedAll
  const firstRef = useRef(true)

  const runSearch = useCallback((q: string, req: number) => {
    searchingRef.current = true
    managers.stickers.searchGifs(q, '').then(
      (p) => {
        searchingRef.current = false
        if (req !== reqRef.current) return
        setItems(p.gifs.map(tenorToItem))
        nextRef.current = p.next
        loadedAllRef.current = p.gifs.length === 0
      },
      () => {
        searchingRef.current = false
        if (req !== reqRef.current) return
        setItems([])
        nextRef.current = ''
      },
    )
  }, [managers])

  useEffect(() => {
    const q = query.trim()
    queryRef.current = q
    const req = ++reqRef.current
    nextRef.current = ''
    loadedAllRef.current = false
    if (firstRef.current) {
      // тренды при открытии — без задержки (tweb onMount → search(''))
      firstRef.current = false
      runSearch(q, req)
      return
    }
    const timer = window.setTimeout(() => runSearch(q, req), 300)
    return () => window.clearTimeout(timer)
  }, [query, runSearch])

  // Следующая страница по курсору Tenor (tweb onScrolledBottom → search(q, false)).
  const loadMore = useCallback(() => {
    const pos = nextRef.current
    if (!pos || searchingRef.current || loadedAllRef.current) return
    const req = reqRef.current
    searchingRef.current = true
    nextRef.current = '' // защита от повторного запроса той же страницы
    managers.stickers.searchGifs(queryRef.current, pos).then(
      (p) => {
        searchingRef.current = false
        if (req !== reqRef.current) return
        setItems((cur) => [...cur, ...p.gifs.map(tenorToItem)])
        nextRef.current = p.next
        if (!p.gifs.length) loadedAllRef.current = true
      },
      () => { searchingRef.current = false },
    )
  }, [managers])

  return { items, loadMore }
}
