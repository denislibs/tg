import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import Menu, { MenuItem } from '../shared/ui/Menu'
import Popup from '../shared/ui/Popup'
import { motion, AnimatePresence } from 'framer-motion'
import TgIcon from './TgIcon'
import Emoji from './emoji/Emoji'
import { EASE, DUR } from '../motion'
import Avatar from '../shared/ui/Avatar'
import { useT } from '../i18n'
import { gradientFor } from '../core/dialogToChat'
import { useStoryViewer } from '../core/hooks/useStoryViewer'
import StoryStats from './StoryStats'
import EditStorySheet from './EditStorySheet'
import StealthModePopup from './StealthModePopup'
import classNames from '../shared/lib/classNames'
import s from './StoryViewer.module.scss'

// Быстрая реакция по умолчанию (tweb DEFAULT_REACTION_EMOTICON) + панель выбора.
const DEFAULT_REACTION = '❤'
const REACTIONS = ['❤', '👍', '🔥', '🥰', '👏', '😁', '😢']

/**
 * Full-screen story viewer over the real stories feed. Shows the selected
 * author's stories in sequence, reusing the existing overlay markup, the
 * per-story progress bars + auto-advance timer, the tap-left/right zones and the
 * Esc-to-close handler. Media is resolved via `managers.media.contentUrl`; each
 * shown story is marked viewed via `managers.stories.view`. For the viewer's own
 * stories a "Просмотры (N)" affordance reveals the viewers list; for others'
 * stories a footer offers a heart reaction / picker and a text reply (DM).
 */
export default function StoryViewer({ groupIndex, onClose }: { groupIndex: number; onClose: () => void }) {
  const t = useT()
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
    showStats,
    openStats,
    closeStats,
    next,
    prev,
    openViewers,
    bg,
    paused,
    setPaused,
    myReaction,
    reactionsCount,
    toggleReaction,
    sendReply,
    del,
    pinned,
    edited,
    togglePinned,
  } = useStoryViewer({ groupIndex, onClose })

  // Пауза (Space) синхронно останавливает воспроизведение видео сториз.
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (paused) v.pause()
    else void v.play().catch(() => {})
  }, [paused, mediaUrl])

  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [reply, setReply] = useState('')
  // 4c: лист редактирования (своя история), stealth-попап и меню чужой истории.
  const [editOpen, setEditOpen] = useState(false)
  const [stealthOpen, setStealthOpen] = useState(false)
  const [othersMenuOpen, setOthersMenuOpen] = useState(false)

  // Любой оверлей (меню удаления, подтверждение, панель реакций, ввод ответа,
  // редактирование, stealth) ставит авто-прогресс на паузу.
  const holds = menuOpen || confirmDel || pickerOpen || reply.length > 0 || editOpen || stealthOpen || othersMenuOpen
  useEffect(() => { setPaused(holds) }, [holds, setPaused, story?.id])

  if (!group || !story) return null

  const submitReply = () => {
    const text = reply.trim()
    if (!text) return
    setReply('')
    void sendReply(text)
  }

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
              <video ref={videoRef} className={s.media} src={mediaUrl} autoPlay muted playsInline />
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
                  // CSS-анимация (не framer): нативно паузится через
                  // animationPlayState, сохраняя прогресс; конец сегмента → next.
                  <div
                    key={current}
                    className={s.segmentActive}
                    style={{ animationPlayState: paused ? 'paused' : 'running' }}
                    onAnimationEnd={next}
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
            {isMe && (
              <IconButton onClick={openStats} color="#fff" size="small" aria-label={t('Story statistics')}>
                <TgIcon name="statistics" />
              </IconButton>
            )}
            <IconButton
              onClick={() => (isMe ? setMenuOpen(true) : setOthersMenuOpen(true))}
              color="#fff"
              size="small"
              aria-label={t('More')}
            >
              <TgIcon name="more" />
            </IconButton>
            <IconButton onClick={onClose} color="#fff" size="small">
              <TgIcon name="close" />
            </IconButton>
          </div>

          {/* Меню своей истории: закреп в профиле, редактирование, удаление.
              Add/Remove from Profile 1:1 с tweb (Story.AddToProfile/RemoveFromProfile). */}
          <Menu open={menuOpen} onClose={() => setMenuOpen(false)} zIndex={3100} style={{ top: 56, right: 16, transformOrigin: 'top right' }}>
            <MenuItem
              icon={<TgIcon name={pinned ? 'pinlist' : 'pinnedchat'} size={20} />}
              label={pinned ? t('Story.RemoveFromProfile') : t('Story.AddToProfile')}
              onClick={() => {
                setMenuOpen(false)
                togglePinned()
              }}
            />
            <MenuItem
              icon={<TgIcon name="edit" size={20} />}
              label={t('Edit')}
              onClick={() => {
                setMenuOpen(false)
                setEditOpen(true)
              }}
            />
            <MenuItem
              icon={<TgIcon name="delete" size={20} />}
              label={t('Delete')}
              danger
              onClick={() => {
                setMenuOpen(false)
                setConfirmDel(true)
              }}
            />
          </Menu>

          {/* Меню чужой истории: Hide My View (stealth) — 1:1 с tweb Stories.StealthMode.View. */}
          <Menu open={othersMenuOpen} onClose={() => setOthersMenuOpen(false)} zIndex={3100} style={{ top: 56, right: 16, transformOrigin: 'top right' }}>
            <MenuItem
              icon={<TgIcon name="eye2" size={20} />}
              label={t('Stories.StealthMode.View')}
              onClick={() => {
                setOthersMenuOpen(false)
                setStealthOpen(true)
              }}
            />
          </Menu>

          {/* Tap zones */}
          <div className={s.tapPrev} onClick={prev} />
          <div className={s.tapNext} onClick={next} />

          {/* Caption (+ пометка edited, payload story.edited) */}
          {(story.caption || edited) && (
            <div className={classNames(s.caption, isMe ? s.captionRaised : s.captionRaisedFooter)}>
              {story.caption && <Text color="#fff" size={15}>{story.caption}</Text>}
              {edited && <Text color="rgba(255,255,255,0.6)" size={12}>{t('edited')}</Text>}
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

          {/* Чужая история: футер с ответом (DM) + реакцией (tweb StoryInput) */}
          {!isMe && (
            <div className={s.footer}>
              <AnimatePresence>
                {pickerOpen && (
                  <motion.div
                    key="react-bar"
                    className={s.reactBar}
                    initial={{ opacity: 0, y: 8, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.9 }}
                    transition={{ duration: 0.16, ease: EASE }}
                  >
                    {REACTIONS.map((r) => (
                      <div
                        key={r}
                        className={classNames(s.reactChip, myReaction === r ? s.reactChipActive : '')}
                        onClick={() => {
                          toggleReaction(r)
                          setPickerOpen(false)
                        }}
                      >
                        <Emoji e={r} size={30} />
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <input
                className={s.replyInput}
                placeholder={t('Reply')}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submitReply() }
                  // не даём навигации/паузе сториз перехватывать ввод
                  e.stopPropagation()
                }}
              />
              <IconButton
                onClick={() => setPickerOpen((v) => !v)}
                color="#fff"
                aria-label={t('React')}
              >
                <TgIcon name="smile" />
              </IconButton>
              {/* быстрая ❤: тап ставит/снимает реакцию по умолчанию (анимация pop) */}
              <motion.div
                className={classNames(s.heartBtn, myReaction ? s.heartActive : '')}
                onClick={() => toggleReaction(myReaction ?? DEFAULT_REACTION)}
                whileTap={{ scale: 0.8 }}
                role="button"
                aria-label={t('React')}
              >
                {myReaction ? (
                  <motion.div key={myReaction} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
                    <Emoji e={myReaction} size={26} />
                  </motion.div>
                ) : (
                  <TgIcon name="reactions" size={26} color="#fff" />
                )}
                {reactionsCount > 0 && <span className={s.reactCount}>{reactionsCount}</span>}
              </motion.div>
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

        {/* Статистика своей истории (full-screen оверлей над просмотрщиком) */}
        <AnimatePresence>
          {showStats && story && <StoryStats storyId={story.id} onClose={closeStats} />}
        </AnimatePresence>

        {/* Подтверждение удаления (tweb DeleteStoryTitle / DeleteStorySubtitle) */}
        {confirmDel && (
          <Popup
            open
            title={t('Delete story')}
            onClose={() => setConfirmDel(false)}
            width={360}
            action={{ label: t('Delete'), onClick: () => { setConfirmDel(false); del() } }}
          >
            <div style={{ padding: '0 16px 8px' }}>
              <Text size={15}>{t('Are you sure you want to delete this story?')}</Text>
            </div>
          </Popup>
        )}

        {/* Лист редактирования своей истории (portal над вьювером) */}
        <AnimatePresence>
          {editOpen && story && <EditStorySheet story={story} onClose={() => setEditOpen(false)} />}
        </AnimatePresence>

        {/* Stealth Mode popup (Hide My View из меню чужой истории) */}
        {stealthOpen && <StealthModePopup onClose={() => setStealthOpen(false)} />}
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
