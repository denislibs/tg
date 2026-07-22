// src/core/hooks/useStickers.ts
//
// ViewModel-хуки стикеров: данные вкладки пикера (recent/faved/наборы) и
// стикеры-саджесты по эмодзи (tweb StickersHelper). Компоненты рендерят,
// сюда стянуты фетчи через managers и локальные апдейты (LIFO recent,
// fave/unfave) — как tweb appStickersManager, но состояние живёт в компоненте
// на время сессии пикера.
import { useEffect, useRef, useState } from 'react'
import { useManagers } from './useManagers'
import type { Sticker, StickerSet } from '../managers/stickersManager'

// Лимиты бэка (usecase/stickers): recent 20, faved 10.
const RECENT_MAX = 20

export interface StickersPanelData {
  recent: Sticker[]
  faved: Sticker[]
  sets: { set: StickerSet; stickers: Sticker[] }[]
  loaded: boolean
}

export function useStickersPanel(active: boolean) {
  const managers = useManagers()
  const [data, setData] = useState<StickersPanelData>({ recent: [], faved: [], sets: [], loaded: false })
  const startedRef = useRef(false)

  // Ленивая загрузка при первом открытии вкладки; кэш живёт, пока смонтирован
  // дропдаун (tweb: панель не размонтируется).
  useEffect(() => {
    if (!active || startedRef.current) return
    startedRef.current = true
    let alive = true
    void (async () => {
      try {
        const [recent, faved, mySets] = await Promise.all([
          managers.stickers.recent(),
          managers.stickers.faved(),
          managers.stickers.mySets(),
        ])
        const full = await Promise.all(mySets.map((s) => managers.stickers.setBySlug(s.slug)))
        if (alive) setData({ recent, faved, sets: full, loaded: true })
      } catch {
        if (alive) setData((d) => ({ ...d, loaded: true }))
      }
    })()
    return () => { alive = false }
  }, [active, managers])

  // Отправка стикера: recent обновляется локально (LIFO, лимит бэка), сам
  // POST /use делает sendSticker — здесь только зеркалим его эффект.
  const markUsed = (st: Sticker) => {
    setData((d) => ({
      ...d,
      recent: [st, ...d.recent.filter((x) => x.id !== st.id)].slice(0, RECENT_MAX),
    }))
  }

  const fave = (st: Sticker) => {
    setData((d) => ({ ...d, faved: [st, ...d.faved.filter((x) => x.id !== st.id)] }))
    void managers.stickers.fave(st.id).catch(() => {})
  }
  const unfave = (st: Sticker) => {
    setData((d) => ({ ...d, faved: d.faved.filter((x) => x.id !== st.id) }))
    void managers.stickers.unfave(st.id).catch(() => {})
  }

  return { ...data, markUsed, fave, unfave }
}

// Саджесты стикеров по эмодзи в композере (tweb StickersHelper.checkEmoticon):
// debounce 300мс, пустой результат скрывает панель. emoji=null — выключено.
export function useStickersByEmoji(emoji: string | null): Sticker[] {
  const managers = useManagers()
  const [list, setList] = useState<Sticker[]>([])
  const reqRef = useRef(0)

  useEffect(() => {
    const req = ++reqRef.current
    if (!emoji) {
      setList([])
      return
    }
    const timer = window.setTimeout(() => {
      managers.stickers.searchByEmoji(emoji).then(
        (res) => { if (req === reqRef.current) setList(res) },
        () => { if (req === reqRef.current) setList([]) },
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [emoji, managers])

  return emoji ? list : []
}
