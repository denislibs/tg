import { createPortal } from 'react-dom'
import { Box } from '@mui/material'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import { motion, AnimatePresence } from 'framer-motion'
import TgIcon from './TgIcon'
import { EASE, DUR } from '../motion'
import Avatar from '../shared/ui/Avatar'
import { gradientFor } from '../core/dialogToChat'
import { useStoryViewer } from '../core/hooks/useStoryViewer'

/**
 * Full-screen story viewer over the real stories feed. Shows the selected
 * author's stories in sequence, reusing the existing overlay markup, the
 * per-story progress bars + auto-advance timer, the tap-left/right zones and the
 * Esc-to-close handler. Media is resolved via `managers.media.contentUrl`; each
 * shown story is marked viewed via `managers.stories.view`. For the viewer's own
 * stories a "Просмотры (N)" affordance reveals the viewers list.
 */
export default function StoryViewer({ groupIndex, onClose }: { groupIndex: number; onClose: () => void }) {
  const {
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
  } = useStoryViewer({ groupIndex, onClose })

  if (!group || !story) return null

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
            <Avatar background={bg} text={group.author.displayName.charAt(0)} size="xs" />
            <Text color="#fff" weight={700} size={14}>
              {group.author.displayName}
            </Text>
            <Box sx={{ flex: 1 }} />
            <IconButton onClick={onClose} color="#fff" size="small">
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
              <Text color="#fff" size={15}>{story.caption}</Text>
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
              <Text color="#fff" size={15}>
                Просмотры{viewers ? ` (${viewers.length})` : ''}
              </Text>
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
                  <Text color="#fff" weight={700} size={15} style={{ flex: 1 }}>
                    Просмотры{viewers ? ` (${viewers.length})` : ''}
                  </Text>
                  <IconButton onClick={() => setShowViewers(false)} color="#fff" size="small">
                    <TgIcon name="close" />
                  </IconButton>
                </Box>
                {viewers == null ? (
                  <Text color="rgba(255,255,255,0.6)" size={14} style={{ paddingLeft: '16px', paddingRight: '16px', paddingTop: '12px', paddingBottom: '12px' }}>
                    Загрузка…
                  </Text>
                ) : viewers.length === 0 ? (
                  <Text color="rgba(255,255,255,0.6)" size={14} style={{ paddingLeft: '16px', paddingRight: '16px', paddingTop: '12px', paddingBottom: '12px' }}>
                    Пока нет просмотров
                  </Text>
                ) : (
                  viewers.map((v) => (
                    <Box key={v.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1 }}>
                      <Avatar background={gradientFor(v.id)} text={v.displayName.charAt(0)} size={36} />
                      <Text noWrap color="#fff" size={15}>
                        {v.displayName}
                      </Text>
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
