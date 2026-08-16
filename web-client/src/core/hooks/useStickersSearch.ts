// useStickersSearch — ViewModel экрана «Поиск стикеров» правой колонки (порт
// логики tweb sidebarRight/tabs/stickers.tsx): пустой запрос — трендовые наборы
// (renderFeatured → getFeaturedStickers; у нас GET /sticker-sets/featured),
// ввод — searchStickerSets с дебаунсом 300мс (tweb InputSearch). Кнопка
// Add/Added — toggleStickerSet: на время запроса гасится (disabled), состояние
// «установлен» ведётся по mySets (у tweb — set.installed_date).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useManagers } from './useManagers'
import type { StickerSet } from '../managers/stickersManager'

export function useStickersSearch(query: string) {
  const managers = useManagers()
  const [sets, setSets] = useState<StickerSet[]>([])
  const [installedIds, setInstalledIds] = useState<ReadonlySet<number>>(new Set())
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(new Set())
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

  useEffect(() => {
    const q = query.trim()
    const req = ++reqRef.current
    const run = () => {
      const p = q ? managers.stickers.searchSets(q) : managers.stickers.featuredSets()
      p.then(
        (res) => { if (req === reqRef.current) setSets(res) },
        () => { if (req === reqRef.current) setSets([]) },
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
  const busyRef = useRef<Set<number>>(new Set())
  const toggle = useCallback((set: StickerSet) => {
    if (busyRef.current.has(set.id)) return
    busyRef.current.add(set.id)
    setBusyIds(new Set(busyRef.current))
    const installed = installedIds.has(set.id)
    const op = installed ? managers.stickers.uninstall(set.id) : managers.stickers.install(set.id)
    void op
      .then(
        () => {
          setInstalledIds((ids) => {
            const next = new Set(ids)
            if (installed) next.delete(set.id)
            else next.add(set.id)
            return next
          })
        },
        () => {},
      )
      .finally(() => {
        busyRef.current.delete(set.id)
        setBusyIds(new Set(busyRef.current))
      })
  }, [managers, installedIds])

  return { sets, installedIds, busyIds, toggle }
}
