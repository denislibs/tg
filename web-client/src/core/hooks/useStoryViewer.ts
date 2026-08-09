// src/core/hooks/useStoryViewer.ts
//
// ViewModel for the full-screen StoryViewer: reads the selected author's story
// group from the stories store, marks the shown story viewed (server + store),
// and drives navigation / the viewers sheet. The Esc-to-close listener lives
// here as a side-effect. Медиа резолвит View через `useStoryPreviewMedia` —
// в карусели tweb его грузит каждый пир, а не только активный.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useStoriesStore } from '../../stores/storiesStore'
import { useChatsStore } from '../../stores/chatsStore'
import { useManagers } from './useManagers'
import { uiEvents } from './uiEvents'
import type { StoryGroup, StoryItem, MediaArea, StoryFwd } from '../managers/storiesManager'

interface Viewer {
  id: number
  displayName: string
  avatarUrl: string
}

interface UseStoryViewerArgs {
  groupIndex: number
  onClose: () => void
  // Переход между авторами (tweb getNearestStory, store.tsx:132-159): конец
  // историй пира → следующий пир, начало → предыдущий. Возвращают false, если
  // соседа нет (тогда next закрывает вьюер, prev остаётся на месте).
  onNextPeer?: () => boolean
  onPrevPeer?: () => boolean
}

// tweb getPeerInitialIndex (store.tsx:205-209): первая непрочитанная история
// пира, иначе первая.
export function initialStoryIndex(group: StoryGroup | undefined): number {
  if (!group) return 0
  return Math.max(0, group.stories.findIndex((s) => !s.viewed))
}

export function useStoryViewer({ groupIndex, onClose, onNextPeer, onPrevPeer }: UseStoryViewerArgs): {
  group: StoryGroup | undefined
  stories: StoryItem[]
  story: StoryItem | undefined
  isMe: boolean
  current: number
  showViewers: boolean
  setShowViewers: (v: boolean) => void
  viewers: Viewer[] | null
  showStats: boolean
  openStats: () => void
  closeStats: () => void
  next: () => void
  prev: () => void
  openViewers: () => void
  // Ручная пауза авто-прогресса (Space). Итоговый `paused` вьюер выводит как
  // manualPause || <открыт любой оверлей> || showStats.
  manualPause: boolean
  togglePause: () => void
  // 4b: реакции + ответ (DM автору) + удаление своей истории.
  myReaction: string | null
  reactionsCount: number
  toggleReaction: (emoji: string) => void
  sendReply: (text: string) => Promise<void>
  del: () => void
  // 4c: закреп в профиле (pin) + признак редактирования.
  pinned: boolean
  edited: boolean
  togglePinned: () => void
  // 4d: media areas поверх истории, атрибуция репоста + имя автора оригинала.
  mediaAreas: MediaArea[]
  fwdFrom: StoryFwd | undefined
  fwdAuthorName: string | null
} {
  const managers = useManagers()
  const groups = useStoriesStore((s) => s.groups)
  const markViewed = useStoriesStore((s) => s.markViewed)
  const setMyReaction = useStoriesStore((s) => s.setMyReaction)
  const removeStory = useStoriesStore((s) => s.removeStory)
  const setStoryPinned = useStoriesStore((s) => s.setStoryPinned)
  const meId = useChatsStore((s) => s.meId)

  const group = groups[groupIndex]
  const stories = group?.stories ?? []
  const isMe = group != null && meId != null && group.author.id === meId

  const [current, setCurrent] = useState(() => initialStoryIndex(group))
  const [showViewers, setShowViewers] = useState(false)
  const [viewers, setViewers] = useState<Viewer[] | null>(null)
  // Оверлей «Статистика истории» (только своя история). Пока открыт — прогресс
  // авто-перехода стоит на паузе, чтобы история не сменилась под панелью.
  const [showStats, setShowStats] = useState(false)
  // Ручная пауза авто-прогресса (Space) — таймер сегмента замирает, видео встаёт.
  // Оверлеи и статистика добавляют паузу поверх этого (см. итоговый paused во вьюере).
  const [manualPause, setManualPause] = useState(false)
  // 4d: имя автора оригинала для плашки репоста (резолвится по fwd_from.authorId).
  const [fwdAuthorName, setFwdAuthorName] = useState<string | null>(null)

  // Смена пира (клик по соседу в карусели / переход в конце историй) — сбрасываем
  // индекс на initial-индекс нового пира (tweb actions.set → peer.index,
  // store.tsx:319-330). Правка производного от пропа состояния прямо в рендере —
  // штатный React-паттерн, дешевле лишнего эффекта с промежуточным кадром.
  const [shownGroupIndex, setShownGroupIndex] = useState(groupIndex)
  if (shownGroupIndex !== groupIndex) {
    setShownGroupIndex(groupIndex)
    setCurrent(initialStoryIndex(group))
    setShowViewers(false)
    setManualPause(false)
  }

  const story = stories[current]

  const next = () => {
    setManualPause(false)
    setShowViewers(false)
    if (current < stories.length - 1) setCurrent((c) => c + 1)
    else if (!onNextPeer?.()) onClose() // последний пир — вьюер закрывается (tweb ended → close)
  }
  const prev = () => {
    setManualPause(false)
    setShowViewers(false)
    if (current > 0) setCurrent((c) => c - 1)
    else onPrevPeer?.()
  }
  const togglePause = () => setManualPause((p) => !p)

  // Клавиатура сториз (tweb): Esc/↓ — закрыть, →/← — навигация, Space — пауза.
  // Обработчики держим в ref — слушатель вешаем один раз, а внутри всегда свежие
  // замыкания (иначе после смены пира стреляли бы устаревшие next/prev).
  const keysRef = useRef({ next, prev, togglePause, onClose })
  keysRef.current = { next, prev, togglePause, onClose }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keysRef.current
      // preventDefault — сигнал глобальному Esc-фолбэку (core/hotkeys), что Esc обработан
      if (e.key === 'Escape' || e.key === 'ArrowDown') { e.preventDefault(); k.onClose(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); k.next(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); k.prev(); return }
      if (e.key === ' ') { e.preventDefault(); k.togglePause() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Empty / out-of-range group → nothing to show.
  useEffect(() => {
    if (group == null || stories.length === 0) onClose()
  }, [group, stories.length, onClose])

  // Mark the shown story viewed (once per story shown) and reflect it in the
  // store so the unseen ring clears. Skip own stories — the author isn't counted
  // among their own viewers.
  useEffect(() => {
    if (!story || isMe || story.viewed) return
    void managers.stories.view(story.id)
    markViewed(group!.author.id, story.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id])

  // 4d: резолв имени автора оригинала для плашки репоста (tweb repostInfo).
  useEffect(() => {
    const fwd = story?.fwdFrom
    if (!fwd) { setFwdAuthorName(null); return }
    let alive = true
    setFwdAuthorName(null)
    void managers.peers.getUsers([fwd.authorId]).then((users) => {
      if (alive) setFwdAuthorName(users[0]?.displayName ?? null)
    }).catch(() => {})
    return () => { alive = false }
  }, [story?.fwdFrom, managers])

  const openViewers = () => {
    if (!story) return
    setShowViewers(true)
    void managers.stories.viewers(story.id).then(setViewers)
  }

  // Статистика ставит авто-прогресс на паузу через сам showStats (итоговый paused
  // во вьюере), отдельный setPaused не нужен.
  const openStats = () => {
    if (!story) return
    setShowStats(true)
  }
  const closeStats = () => {
    setShowStats(false)
  }

  // Реакция (tweb sendReaction): тап по той же эмодзи снимает её, иначе ставит/
  // меняет. Оптимистично правим стор, затем шлём на бэк; счётчик догонит story_reaction.
  const toggleReaction = (emoji: string) => {
    if (!story) return
    const next = story.myReaction === emoji ? null : emoji
    setMyReaction(story.id, next)
    if (next) void managers.stories.setReaction(story.id, next)
    else void managers.stories.removeReaction(story.id)
  }

  // Ответ на историю = обычный DM автору (явной ссылки «ответ на историю» на бэке
  // нет — вне батча). При отсутствии лички с автором создаём её. Тост «Message sent».
  const sendReply = async (text: string) => {
    const t = text.trim()
    if (!group || !t) return
    const chatId = await managers.chats.createPrivate(group.author.id)
    const clientMsgId = `story-${chatId}-${performance.now()}-${Math.random().toString(36).slice(2)}`
    await managers.realtime.sendMessage({ chatId, text: t, clientMsgId })
    uiEvents.emit('ui:toast', 'Сообщение отправлено')
  }

  // Удаление своей истории (tweb DeleteStory): ждём ответ бэка, затем убираем из
  // стора (пустая группа исчезает → эффект ниже закрывает вьювер). Не оптимистично
  // нарочно — удаление последней истории схлопывает группу, откатить её нечем; при
  // сбое стор остаётся консистентным и показываем тост.
  const del = async () => {
    if (!story || !group) return
    try {
      await managers.stories.del(story.id)
      removeStory(group.author.id, story.id)
    } catch {
      uiEvents.emit('ui:toast', 'Не удалось удалить историю')
    }
  }

  // Закреп своей истории в профиле (tweb Story.AddToProfile/RemoveFromProfile):
  // оптимистично правим стор, затем шлём на бэк; при сбое откатываем + тост.
  const togglePinned = () => {
    if (!story) return
    const next = !story.pinned
    setStoryPinned(story.id, next)
    void managers.stories.pin(story.id, next).catch(() => {
      setStoryPinned(story.id, !next)
      uiEvents.emit('ui:toast', 'Не удалось обновить закрепление')
    })
  }

  return {
    group,
    stories,
    story,
    isMe,
    current,
    showViewers,
    setShowViewers,
    viewers,
    showStats,
    openStats,
    closeStats,
    next,
    prev,
    openViewers,
    manualPause,
    togglePause,
    myReaction: story?.myReaction ?? null,
    reactionsCount: story?.reactionsCount ?? 0,
    toggleReaction,
    sendReply,
    del,
    pinned: story?.pinned ?? false,
    edited: story?.edited ?? false,
    togglePinned,
    mediaAreas: story?.mediaAreas ?? [],
    fwdFrom: story?.fwdFrom,
    fwdAuthorName,
  }
}

interface UseStoryProgressArgs {
  // Итоговая пауза сегмента: ручная пауза/оверлеи + буферизация + «контент ещё не готов»
  // (tweb: paused || buffering, playOnReady гейтится loading(), viewer.tsx:1756-1765).
  paused: boolean
  // Длительность сегмента в мс: для видео — длительность ролика, иначе STORY_DURATION.
  duration: number
  // Меняется при смене истории/пира — прогресс начинается заново.
  resetKey: string
  onEnd: () => void
}

// Прогресс активного сегмента (tweb StorySlide, viewer.tsx:174-247): JS-тикер, а не
// CSS-анимация на фиксированные 5s. Пишем `--progress` прямо в DOM-узел сегмента —
// как tweb пишет style в свой slide; так рендер React не крутится по 60 раз в секунду.
// Пауза сохраняет накопленное время (tweb elapsedTimeOnPause, store.tsx:494-512).
export function useStoryProgress({ paused, duration, resetKey, onEnd }: UseStoryProgressArgs): RefObject<HTMLDivElement | null> {
  const slideRef = useRef<HTMLDivElement | null>(null)
  const elapsedRef = useRef(0)
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd

  useEffect(() => {
    elapsedRef.current = 0
    slideRef.current?.style.setProperty('--progress', '0%')
  }, [resetKey])

  useEffect(() => {
    if (paused) return
    const start = Date.now() - elapsedRef.current
    let raf = 0
    const tick = () => {
      const ratio = (Date.now() - start) / duration
      slideRef.current?.style.setProperty('--progress', `${Math.min(100, ratio * 100)}%`)
      if (ratio >= 1) { onEndRef.current(); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      elapsedRef.current = Date.now() - start
    }
  }, [paused, duration, resetKey])

  return slideRef
}
