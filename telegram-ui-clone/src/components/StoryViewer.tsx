import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, IconButton } from '@mui/material'
import { motion, AnimatePresence } from 'framer-motion'
import TgIcon from './TgIcon'
import { EASE, DUR } from '../motion'
import Avatar from './Avatar'
import { useStoriesStore } from '../stores/storiesStore'
import { useChatsStore } from '../stores/chatsStore'
import { startClient } from '../client/bootstrap'
import { gradientFor } from '../core/dialogToChat'

interface Viewer {
  id: number
  displayName: string
  avatarUrl: string
}

/**
 * Full-screen story viewer over the real stories feed. Shows the selected
 * author's stories in sequence, reusing the existing overlay markup, the
 * per-story progress bars + auto-advance timer, the tap-left/right zones and the
 * Esc-to-close handler. Media is resolved via `managers.media.contentUrl`; each
 * shown story is marked viewed via `managers.stories.view`. For the viewer's own
 * stories a "Просмотры (N)" affordance reveals the viewers list.
 */
export default function StoryViewer({ groupIndex, onClose }: { groupIndex: number; onClose: () => void }) {
  const groups = useStoriesStore((s) => s.groups)
  const setGroups = useStoriesStore((s) => s.setGroups)
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
    const { managers } = startClient()
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
      setGroups(
        groups.map((g) =>
          g.author.id === group!.author.id
            ? { ...g, stories: g.stories.map((s) => (s.id === story.id ? { ...s, viewed: true } : s)) }
            : g,
        ),
      )
    }
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id])

  const openViewers = () => {
    if (!story) return
    setShowViewers(true)
    const { managers } = startClient()
    void managers.stories.viewers(story.id).then(setViewers)
  }

  if (!group || !story) return null

  const bg = gradientFor(group.author.id)

  return createPortal(
    <AnimatePresence>
      <Box
        component={motion.div}
        key="story-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: DUR.in, ease: EASE } }}
        exit={{ opacity: 0, transition: { duration: DUR.out, ease: EASE } }}
        sx={{
          position: 'fixed',
          inset: 0,
          zIndex: 3000,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Story card */}
        <Box
          component={motion.div}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: EASE }}
          sx={{
            position: 'relative',
            aspectRatio: '9 / 16',
            height: 'min(92vh, 900px)',
            maxWidth: 'calc(min(92vh, 900px) * 9 / 16)',
            width: '100%',
            borderRadius: '12px',
            overflow: 'hidden',
            background: bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Media */}
          {mediaUrl ? (
            isVideo ? (
              <Box
                component="video"
                src={mediaUrl}
                autoPlay
                muted
                playsInline
                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <Box
                component="img"
                src={mediaUrl}
                alt=""
                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            )
          ) : (
            <Box sx={{ fontSize: 120, userSelect: 'none', lineHeight: 1, color: '#fff' }}>
              {group.author.displayName.charAt(0)}
            </Box>
          )}

          {/* Progress bars */}
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              right: 8,
              display: 'flex',
              gap: '3px',
              zIndex: 2,
            }}
          >
            {stories.map((s, i) => (
              <Box
                key={s.id}
                sx={{
                  flex: 1,
                  height: 2,
                  borderRadius: 2,
                  background: 'rgba(255,255,255,0.3)',
                  overflow: 'hidden',
                }}
              >
                {i < current && <Box sx={{ width: '100%', height: '100%', background: '#fff' }} />}
                {i === current && (
                  <motion.div
                    key={current}
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 5, ease: 'linear' }}
                    onAnimationComplete={next}
                    style={{ height: '100%', background: '#fff' }}
                  />
                )}
              </Box>
            ))}
          </Box>

          {/* Header */}
          <Box
            sx={{
              position: 'absolute',
              top: 18,
              left: 8,
              right: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              zIndex: 2,
            }}
          >
            <Avatar background={bg} text={group.author.displayName.charAt(0)} size={32} />
            <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>
              {group.author.displayName}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <IconButton onClick={onClose} sx={{ color: '#fff' }} size="small">
              <TgIcon name="close" />
            </IconButton>
          </Box>

          {/* Tap zones */}
          <Box
            onClick={prev}
            sx={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '33.33%', zIndex: 1, cursor: 'pointer' }}
          />
          <Box
            onClick={next}
            sx={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '66.66%', zIndex: 1, cursor: 'pointer' }}
          />

          {/* Caption */}
          {story.caption && (
            <Box
              sx={{
                position: 'absolute',
                left: 12,
                right: 12,
                bottom: isMe ? 64 : 12,
                px: 2,
                py: 1.25,
                borderRadius: '16px',
                background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                zIndex: 2,
              }}
            >
              <Typography sx={{ color: '#fff', fontSize: 15 }}>{story.caption}</Typography>
            </Box>
          )}

          {/* Own stories: viewers affordance */}
          {isMe && (
            <Box
              onClick={openViewers}
              role="button"
              aria-label="Просмотры"
              sx={{
                position: 'absolute',
                left: 12,
                right: 12,
                bottom: 12,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                borderRadius: '16px',
                background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                cursor: 'pointer',
                zIndex: 2,
              }}
            >
              <TgIcon name="eye" size={20} color="#fff" />
              <Typography sx={{ color: '#fff', fontSize: 15 }}>
                Просмотры{viewers ? ` (${viewers.length})` : ''}
              </Typography>
            </Box>
          )}

          {/* Viewers list sheet (own stories) */}
          <AnimatePresence>
            {showViewers && (
              <Box
                component={motion.div}
                key="viewers-sheet"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ duration: 0.25, ease: EASE }}
                sx={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  maxHeight: '60%',
                  overflowY: 'auto',
                  background: 'rgba(20,20,20,0.96)',
                  borderTopLeftRadius: '16px',
                  borderTopRightRadius: '16px',
                  zIndex: 3,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    px: 2,
                    py: 1.5,
                    position: 'sticky',
                    top: 0,
                    background: 'rgba(20,20,20,0.96)',
                  }}
                >
                  <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 15, flex: 1 }}>
                    Просмотры{viewers ? ` (${viewers.length})` : ''}
                  </Typography>
                  <IconButton onClick={() => setShowViewers(false)} sx={{ color: '#fff' }} size="small">
                    <TgIcon name="close" />
                  </IconButton>
                </Box>
                {viewers == null ? (
                  <Typography sx={{ color: 'rgba(255,255,255,0.6)', px: 2, py: 1.5, fontSize: 14 }}>
                    Загрузка…
                  </Typography>
                ) : viewers.length === 0 ? (
                  <Typography sx={{ color: 'rgba(255,255,255,0.6)', px: 2, py: 1.5, fontSize: 14 }}>
                    Пока нет просмотров
                  </Typography>
                ) : (
                  viewers.map((v) => (
                    <Box key={v.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1 }}>
                      <Avatar background={gradientFor(v.id)} text={v.displayName.charAt(0)} size={36} />
                      <Typography noWrap sx={{ color: '#fff', fontSize: 15 }}>
                        {v.displayName}
                      </Typography>
                    </Box>
                  ))
                )}
              </Box>
            )}
          </AnimatePresence>
        </Box>
      </Box>
    </AnimatePresence>,
    document.body,
  )
}
