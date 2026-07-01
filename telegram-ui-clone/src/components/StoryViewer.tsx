import { createPortal } from 'react-dom'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import { motion, AnimatePresence } from 'framer-motion'
import TgIcon from './TgIcon'
import { EASE, DUR } from '../motion'
import Avatar from '../shared/ui/Avatar'
import { gradientFor } from '../core/dialogToChat'
import { useStoryViewer } from '../core/hooks/useStoryViewer'
import classNames from '../shared/lib/classNames'
import s from './StoryViewer.module.scss'

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
      <motion.div
        key="story-overlay"
        className={s.overlay}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: DUR.in, ease: EASE } }}
        exit={{ opacity: 0, transition: { duration: DUR.out, ease: EASE } }}
      >
        {/* Story card */}
        <motion.div
          className={s.card}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: EASE }}
          style={{ background: bg }}
        >
          {/* Media */}
          {mediaUrl ? (
            isVideo ? (
              <video className={s.media} src={mediaUrl} autoPlay muted playsInline />
            ) : (
              <img className={s.media} src={mediaUrl} alt="" />
            )
          ) : (
            <div className={s.placeholder}>{group.author.displayName.charAt(0)}</div>
          )}

          {/* Progress bars */}
          <div className={s.progress}>
            {stories.map((st, i) => (
              <div key={st.id} className={s.segment}>
                {i < current && <div className={s.segmentFill} />}
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
              </div>
            ))}
          </div>

          {/* Header */}
          <div className={s.header}>
            <Avatar background={bg} text={group.author.displayName.charAt(0)} size="xs" />
            <Text color="#fff" weight={700} size={14}>
              {group.author.displayName}
            </Text>
            <div className={s.spacer} />
            <IconButton onClick={onClose} color="#fff" size="small">
              <TgIcon name="close" />
            </IconButton>
          </div>

          {/* Tap zones */}
          <div className={s.tapPrev} onClick={prev} />
          <div className={s.tapNext} onClick={next} />

          {/* Caption */}
          {story.caption && (
            <div className={classNames(s.caption, isMe ? s.captionRaised : '')}>
              <Text color="#fff" size={15}>{story.caption}</Text>
            </div>
          )}

          {/* Own stories: viewers affordance */}
          {isMe && (
            <div className={s.viewsBar} onClick={openViewers} role="button" aria-label="Просмотры">
              <TgIcon name="eye" size={20} color="#fff" />
              <Text color="#fff" size={15}>
                Просмотры{viewers ? ` (${viewers.length})` : ''}
              </Text>
            </div>
          )}

          {/* Viewers list sheet (own stories) */}
          <AnimatePresence>
            {showViewers && (
              <motion.div
                key="viewers-sheet"
                className={s.viewersSheet}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                <div className={s.viewersHeader}>
                  <Text color="#fff" weight={700} size={15} className={s.viewersTitle}>
                    Просмотры{viewers ? ` (${viewers.length})` : ''}
                  </Text>
                  <IconButton onClick={() => setShowViewers(false)} color="#fff" size="small">
                    <TgIcon name="close" />
                  </IconButton>
                </div>
                {viewers == null ? (
                  <Text color="rgba(255,255,255,0.6)" size={14} style={{ padding: '12px 16px' }}>
                    Загрузка…
                  </Text>
                ) : viewers.length === 0 ? (
                  <Text color="rgba(255,255,255,0.6)" size={14} style={{ padding: '12px 16px' }}>
                    Пока нет просмотров
                  </Text>
                ) : (
                  viewers.map((v) => (
                    <div key={v.id} className={s.viewerRow}>
                      <Avatar background={gradientFor(v.id)} text={v.displayName.charAt(0)} size={36} />
                      <Text noWrap color="#fff" size={15}>
                        {v.displayName}
                      </Text>
                    </div>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
