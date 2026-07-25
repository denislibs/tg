// src/core/hooks/useStoryViewer.ts
//
// ViewModel for the full-screen StoryViewer: reads the selected author's story
// group from the stories store, resolves each shown story's media via
// managers.media, marks it viewed (server + store), and drives navigation /
// the viewers sheet. The Esc-to-close listener lives here as a side-effect.
import { useEffect, useState } from 'react'
import { useStoriesStore } from '../../stores/storiesStore'
import { useChatsStore } from '../../stores/chatsStore'
import { useManagers } from './useManagers'
import { uiEvents } from './uiEvents'
import { gradientFor } from '../dialogToChat'
import type { StoryGroup, StoryItem } from '../managers/storiesManager'

interface Viewer {
  id: number
  displayName: string
  avatarUrl: string
}

interface UseStoryViewerArgs {
  groupIndex: number
  onClose: () => void
}

export function useStoryViewer({ groupIndex, onClose }: UseStoryViewerArgs): {
  group: StoryGroup | undefined
  stories: StoryItem[]
  story: StoryItem | undefined
  isMe: boolean
  current: number
  mediaUrl: string
  isVideo: boolean
  showViewers: boolean
  setShowViewers: (v: boolean) => void
  viewers: Viewer[] | null
  showStats: boolean
  openStats: () => void
  closeStats: () => void
  next: () => void
  prev: () => void
  openViewers: () => void
  bg: string
  paused: boolean
  togglePause: () => void
  setPaused: (v: boolean) => void
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

  const [current, setCurrent] = useState(0)
  const [mediaUrl, setMediaUrl] = useState<string>('')
  const [isVideo, setIsVideo] = useState(false)
  const [showViewers, setShowViewers] = useState(false)
  const [viewers, setViewers] = useState<Viewer[] | null>(null)
  // Оверлей «Статистика истории» (только своя история). Пока открыт — прогресс
  // авто-перехода стоит на паузе, чтобы история не сменилась под панелью.
  const [showStats, setShowStats] = useState(false)
  // Пауза авто-прогресса (Space) — таймер сегмента замирает, видео встаёт.
  const [paused, setPaused] = useState(false)

  const story = stories[current]

  const next = () => {
    setPaused(false)
    if (current >= stories.length - 1) onClose()
    else {
      setCurrent((c) => c + 1)
      setShowViewers(false)
    }
  }
  const prev = () => {
    setPaused(false)
    setCurrent((c) => Math.max(0, c - 1))
    setShowViewers(false)
  }
  const togglePause = () => setPaused((p) => !p)

  // Клавиатура сториз (tweb): Esc/↓ — закрыть, →/← — навигация, Space — пауза.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // preventDefault — сигнал глобальному Esc-фолбэку (core/hotkeys), что Esc обработан
      if (e.key === 'Escape' || e.key === 'ArrowDown') { e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); return }
      if (e.key === ' ') { e.preventDefault(); togglePause() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, current, stories.length])

  // Empty / out-of-range group → nothing to show.
  useEffect(() => {
    if (group == null || stories.length === 0) onClose()
  }, [group, stories.length, onClose])

  // Resolve the current story's media + mark it viewed (once per story shown).
  useEffect(() => {
    if (!story) return
    let alive = true
    setMediaUrl('')
    setIsVideo(false)
    void Promise.all([managers.media.contentUrl(story.mediaId), managers.media.meta(story.mediaId)]).then(
      ([url, meta]) => {
        if (!alive) return
        setMediaUrl(url)
        setIsVideo(meta.mime.startsWith('video/'))
      },
    )
    // mark viewed and reflect it in the store so the unseen ring clears.
    // Skip own stories — the author isn't counted among their own viewers.
    if (!isMe && !story.viewed) {
      void managers.stories.view(story.id)
      markViewed(group!.author.id, story.id)
    }
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id])

  const openViewers = () => {
    if (!story) return
    setShowViewers(true)
    void managers.stories.viewers(story.id).then(setViewers)
  }

  const openStats = () => {
    if (!story) return
    setPaused(true)
    setShowStats(true)
  }
  const closeStats = () => {
    setShowStats(false)
    setPaused(false)
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

  const bg = group ? gradientFor(group.author.id) : ''

  return {
    group,
    stories,
    story,
    isMe,
    current,
    mediaUrl,
    isVideo,
    showViewers,
    setShowViewers,
    viewers,
    showStats,
    openStats,
    closeStats,
    next,
    prev,
    openViewers,
    bg,
    paused,
    togglePause,
    setPaused,
    myReaction: story?.myReaction ?? null,
    reactionsCount: story?.reactionsCount ?? 0,
    toggleReaction,
    sendReply,
    del,
    pinned: story?.pinned ?? false,
    edited: story?.edited ?? false,
    togglePinned,
  }
}
