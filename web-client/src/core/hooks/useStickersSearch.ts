// useStickersSearch — ViewModel экрана «Поиск стикеров» правой колонки (порт
// логики tweb sidebarRight/tabs/stickers.tsx): пустой запрос — трендовые наборы
// (renderFeatured → getFeaturedStickers; у нас GET /sticker-sets/featured),
// ввод — searchStickerSets с дебаунсом 300мс (tweb InputSearch). Кнопка
// Add/Added — toggleStickerSet: на время запроса гасится (disabled), состояние
// «установлен» ведётся по mySets (у tweb — set.installed_date).
import { useCallback, useEffect, useRef, useState } from 'react'
import rootScope from '@lib/rootScope'
import { useManagers } from './useManagers'
import { toggleStickerSet } from '../stickers/toggleStickerSet'
import type { Covers, StickerSet } from '../managers/stickersManager'

export function useStickersSearch(query: string) {
  const managers = useManagers()
  const [sets, setSets] = useState<StickerSet[]>([])
  // Превью строк (covered sets, Task 2) — первые стикеры каждого набора,
  // приехавшие ОДНИМ запросом вместе с самой выдачей. Пустая карта — до
  // первого ответа/при пустой выдаче; отдельного набора для конкретного
  // set.id может не быть (набор без стикеров) — строка тогда рисует пустые
  // ячейки-заглушки (см. StickersSearchTab).
  const [covers, setCovers] = useState<Covers>(new Map())
  const [installedIds, setInstalledIds] = useState<ReadonlySet<number>>(new Set())
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(new Set())
  // Скелетон экрана держится, пока идёт актуальный запрос (Task 6 «скелетоны
  // в панели») — включая первую загрузку трендов без ввода.
  const [loading, setLoading] = useState(true)
  // Устаревшие ответы отбрасываются счётчиком поколений (как useGifsSearch).
  const reqRef = useRef(0)
  const firstRef = useRef(true)

  // Установленные наборы — источник Add/Added (tweb installed_date).
  useEffect(() => {
    let alive = true
    managers.stickers.mySets().then(
      (mine) => { if (alive) setInstalledIds(new Set(mine.map((s) => s.id))) },
      () => {},
    )
    return () => { alive = false }
  }, [managers])

  // Набор мог быть поставлен/снят не отсюда (попап набора, другая вкладка) —
  // Add/Added пересчитывается по объявлению, а не по своему же ответу
  // (tweb sidebarLeft/tabs/stickersAndEmoji.tsx:252-260).
  useEffect(() => {
    const onInstalled = (set: StickerSet) => setInstalledIds((ids) => new Set(ids).add(set.id))
    const onDeleted = (set: StickerSet) => setInstalledIds((ids) => {
      const next = new Set(ids)
      next.delete(set.id)
      return next
    })
    rootScope.addEventListener('stickers_installed', onInstalled)
    rootScope.addEventListener('stickers_deleted', onDeleted)
    return () => {
      rootScope.removeEventListener('stickers_installed', onInstalled)
      rootScope.removeEventListener('stickers_deleted', onDeleted)
    }
  }, [])

  useEffect(() => {
    const q = query.trim()
    const req = ++reqRef.current
    const run = () => {
      setLoading(true)
      const p = q ? managers.stickers.searchSets(q) : managers.stickers.featuredSets()
      p.then(
        (res) => { if (req === reqRef.current) { setSets(res.sets); setCovers(res.covers); setLoading(false) } },
        () => { if (req === reqRef.current) { setSets([]); setCovers(new Map()); setLoading(false) } },
      )
    }
    if (firstRef.current) {
      // тренды при открытии — без задержки (tweb onMount → renderFeatured())
      firstRef.current = false
      run()
      return
    }
    const timer = window.setTimeout(run, 300)
    return () => window.clearTimeout(timer)
  }, [query, managers])

  // Add/Added — toggleStickerSet (tweb: кнопка disabled на время запроса).
  // Занятость ведёт ref (setState-апдейтер не должен нести сайд-эффекты —
  // React вправе позвать его дважды), state — только зеркало для рендера.
  // installedIds здесь не правится: результат объявляет toggleStickerSet, и
  // применяет его подписка выше — одним путём для своего и чужого действия.
  const busyRef = useRef<Set<number>>(new Set())
  const toggle = useCallback((set: StickerSet) => {
    if (busyRef.current.has(set.id)) return
    busyRef.current.add(set.id)
    setBusyIds(new Set(busyRef.current))
    void toggleStickerSet(managers.stickers, set, installedIds.has(set.id))
      .catch(() => {})
      .finally(() => {
        busyRef.current.delete(set.id)
        setBusyIds(new Set(busyRef.current))
      })
  }, [managers, installedIds])

  return { sets, covers, installedIds, busyIds, toggle, loading }
}
