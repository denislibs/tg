// src/core/hooks/useStickers.ts
//
// ViewModel-хуки стикеров: данные вкладки пикера (recent/faved/наборы) и
// стикеры-саджесты по эмодзи (tweb StickersHelper). Компоненты рендерят,
// сюда стянуты фетчи через managers и локальные апдейты (LIFO recent,
// fave/unfave) — как tweb appStickersManager, но состояние живёт в компоненте
// на время сессии пикера.
import { useEffect, useRef, useState } from 'react'
import rootScope from '@lib/rootScope'
import { useManagers } from './useManagers'
import { useMiddlewareHelper } from './useMiddlewareHelper'
import type { Sticker, StickerSet } from '../managers/stickersManager'
import { ANIMATED_EMOJI_SLUG } from '../animatedEmoji'

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
  const middlewareHelper = useMiddlewareHelper()
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
        const full = await Promise.all(mySets.map((s) => managers.stickers.getStickerSet({ shortName: s.slug })))
        if (alive) setData({ recent, faved, sets: full, loaded: true })
      } catch {
        if (alive) setData((d) => ({ ...d, loaded: true }))
      }
    })()
    return () => { alive = false }
  }, [active, managers])

  // Установка/удаление набора приходит объявлением (tweb emoticonsDropdown/
  // tabs/stickers.ts:247 renderStickerSet на 'stickers_installed', :271
  // deleteCategory на 'stickers_deleted'). Без этой подписки панель узнавала бы
  // о новом наборе только при следующем открытии дропдауна: загрузка данных
  // одноразовая (startedRef выше).
  useEffect(() => {
    // Догрузка состава установленного набора — асинхронна, поэтому под
    // middleware-скоупом этого прогона эффекта (web-client/CLAUDE.md).
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    const onInstalled = (set: StickerSet) => {
      void managers.stickers.getStickerSet({ shortName: set.slug }).then(
        (full) => {
          if (!middleware() || full.stickers.length === 0) return
          setData((d) => (d.sets.some((x) => x.set.id === set.id) ? d : { ...d, sets: [...d.sets, full] }))
        },
        () => {},
      )
    }
    const onDeleted = (set: StickerSet) => {
      setData((d) => ({ ...d, sets: d.sets.filter((x) => x.set.id !== set.id) }))
    }
    rootScope.addEventListener('stickers_installed', onInstalled)
    rootScope.addEventListener('stickers_deleted', onDeleted)
    return () => {
      rootScope.removeEventListener('stickers_installed', onInstalled)
      rootScope.removeEventListener('stickers_deleted', onDeleted)
      scope.destroy()
    }
  }, [managers, middlewareHelper])

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

  // Очистка недавних (tweb appStickersManager.clearRecentStickers): у сервера
  // стирается список, локально секция recent схлопывается сразу.
  const clearRecent = () => {
    setData((d) => ({ ...d, recent: [] }))
    void managers.stickers.clearRecent().catch(() => {})
  }

  return { ...data, markUsed, fave, unfave, clearRecent }
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

// Наборы кастом-эмодзи для вкладки эмодзи (tweb getCustomEmojis /
// getEmojiStickers): установленные наборы kind='emoji' + сид-набор
// animated_emoji (та же инфра, что big-emoji), чтобы вкладка не была пустой,
// пока пользователь не установил свои. Ленивая загрузка при первом открытии.
export function useCustomEmojiSets(active: boolean): { set: StickerSet; stickers: Sticker[] }[] {
  const managers = useManagers()
  const [sets, setSets] = useState<{ set: StickerSet; stickers: Sticker[] }[]>([])
  const startedRef = useRef(false)

  useEffect(() => {
    if (!active || startedRef.current) return
    startedRef.current = true
    let alive = true
    void (async () => {
      try {
        const mySets = await managers.stickers.mySets()
        const slugs = Array.from(
          new Set([ANIMATED_EMOJI_SLUG, ...mySets.filter((x) => x.kind === 'emoji').map((x) => x.slug)]),
        )
        const full = await Promise.all(slugs.map((sl) => managers.stickers.getStickerSet({ shortName: sl }).catch(() => null)))
        if (alive) setSets(full.filter((x): x is { set: StickerSet; stickers: Sticker[] } => !!x && x.stickers.length > 0))
      } catch {
        /* нет наборов — вкладка кастом-эмодзи просто пустая */
      }
    })()
    return () => { alive = false }
  }, [active, managers])

  return sets
}
