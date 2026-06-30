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
  next: () => void
  prev: () => void
  openViewers: () => void
  bg: string
} {
  const managers = useManagers()
  const groups = useStoriesStore((s) => s.groups)
  const markViewed = useStoriesStore((s) => s.markViewed)
  const meId = useChatsStore((s) => s.meId)

  const group = groups[groupIndex]
  const stories = group?.stories ?? []
  const isMe = group != null && meId != null && group.author.id === meId

  const [current, setCurrent] = useState(0)
  const [mediaUrl, setMediaUrl] = useState<string>('')
  const [isVideo, setIsVideo] = useState(false)
  const [showViewers, setShowViewers] = useState(false)
  const [viewers, setViewers] = useState<Viewer[] | null>(null)

  const story = stories[current]

  const next = () => {
    if (current >= stories.length - 1) onClose()
    else {
      setCurrent((c) => c + 1)
      setShowViewers(false)
    }
  }
  const prev = () => {
    setCurrent((c) => Math.max(0, c - 1))
    setShowViewers(false)
  }

  // Esc-to-close (unchanged from the mock).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    next,
    prev,
    openViewers,
    bg,
  }
}
