import { useState } from 'react'
import { Box, IconButton, InputBase, Typography, useMediaQuery, useTheme } from '@mui/material'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded'
import CardGiftcardRoundedIcon from '@mui/icons-material/CardGiftcardRounded'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DUR } from '../motion'
import Avatar from './Avatar'
import ChannelPost from './ChannelPost'
import CommentsBar from './CommentsBar'
import MediaViewer from './MediaViewer'
import DiscussionView from './DiscussionView'
import UserInfoPanel from './UserInfoPanel'
import HeaderMenu from './HeaderMenu'
import { chats, kyzdarPosts } from '../data'
import { useT } from '../i18n'
import { FEED_MASK, FADE_BOTTOM } from '../chatFade'

const MotionBox = motion(Box)
const dollhouse = chats.find((c) => c.id === 'dollhouse-work')!

export default function ChatView({ onBack }: { onBack?: () => void }) {
  const t = useT()
  const theme = useTheme()
  const tg = theme.tg
  const mode = theme.palette.mode
  // Side gutter so the floating pills don't touch the screen edges on mobile.
  const narrow = useMediaQuery('(max-width:900px)')
  const [showPinned, setShowPinned] = useState(true)
  const [showInfo, setShowInfo] = useState(false)
  const [chatSearch, setChatSearch] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [headerMenu, setHeaderMenu] = useState<{ top: number; right: number } | null>(null)
  const [media, setMedia] = useState<{ gradient: string; emoji?: string; time?: string } | null>(null)
  const [discussion, setDiscussion] = useState<(typeof kyzdarPosts)[number] | null>(null)

  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'flex-start',
        position: 'relative',
        background: 'transparent',
      }}
    >
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          height: '100dvh',
          position: 'relative',
          overflow: 'hidden',
          px: narrow ? 1 : 0,
        }}
      >
      {/* Header — floating rounded pill over the global pattern */}
      <Box
        sx={{
          position: 'absolute',
          top: '16px',
          left: 0,
          right: 0,
          zIndex: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          width: '100%',
          maxWidth: 688,
          mx: 'auto',
          px: 1.5,
          py: 0.5,
          height: 48,
          borderRadius: '24px',
          background: tg.bubble,
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 1px 6px -1px rgba(0,0,0,0.5)'
              : '0 1px 5px -1px rgba(0,0,0,0.16)',
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {chatSearch ? (
            <Box
              key="search"
              component={motion.div}
              initial={{ opacity: 0, x: 26 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 26 }}
              transition={{ duration: 0.2, ease: EASE }}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}
            >
              <Avatar background="linear-gradient(135deg,#8a5bff,#5b8dff)" emoji="✨" size={32} />
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  background: mode === 'dark' ? '#181818' : '#f0f0f2',
                  borderRadius: '9999px',
                  height: 38,
                  px: 1.5,
                }}
              >
                <SearchRoundedIcon sx={{ color: tg.textFaint, fontSize: 20 }} />
                <InputBase
                  autoFocus
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  placeholder={t('Search')}
                  sx={{ flex: 1, fontSize: 16, color: tg.textPrimary, '& input::placeholder': { color: tg.textFaint, opacity: 1 } }}
                />
                <IconButton
                  size="small"
                  onClick={() => (chatSearchQuery ? setChatSearchQuery('') : setChatSearch(false))}
                  sx={{ color: tg.textFaint }}
                >
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              </Box>
              <IconButton sx={{ color: tg.textSecondary }}>
                <CalendarMonthOutlined />
              </IconButton>
            </Box>
          ) : (
            <Box
              key="normal"
              component={motion.div}
              initial={{ opacity: 0, x: -26 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -26 }}
              transition={{ duration: 0.2, ease: EASE }}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}
            >
              {onBack && (
                <IconButton onClick={onBack} sx={{ color: tg.textSecondary, ml: -0.5 }}>
                  <ArrowBackRoundedIcon />
                </IconButton>
              )}
              <Box
                onClick={() => setShowInfo((o) => !o)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0, cursor: 'pointer' }}
              >
                <Avatar background="linear-gradient(135deg,#8a5bff,#5b8dff)" emoji="✨" size={40} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontWeight: 500, fontSize: 16, color: tg.textPrimary }}>
                    kyzdar.ai
                  </Typography>
                  <Typography sx={{ fontSize: 13.5, color: tg.accent }}>4 566 {t('subscribers')}</Typography>
                </Box>
              </Box>
              <IconButton onClick={() => setChatSearch(true)} sx={{ color: tg.textSecondary }}>
                <SearchRoundedIcon />
              </IconButton>
              <IconButton
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setHeaderMenu({ top: r.bottom + 6, right: window.innerWidth - r.right })
                }}
                sx={{ color: tg.textSecondary }}
              >
                <MoreVertRoundedIcon />
              </IconButton>
            </Box>
          )}
        </AnimatePresence>
      </Box>

      {/* In-chat search "no results" dropdown */}
      <AnimatePresence initial={false}>
        {chatSearch && chatSearchQuery.trim() && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            style={{ overflow: 'hidden', position: 'absolute', top: 72, left: 0, right: 0, zIndex: 7, width: '100%', maxWidth: 688, margin: '0 auto' }}
          >
            <Box sx={{ background: tg.bubble, borderRadius: '14px', px: 2, py: 2, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 15, color: tg.textSecondary }}>
                {t('There were no results for')}{' '}
                <Box component="span" sx={{ fontWeight: 700, color: tg.textPrimary }}>
                  “{chatSearchQuery}”
                </Box>
                {t('. Try a new search.')}
              </Typography>
            </Box>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pinned message */}
      <AnimatePresence initial={false}>
        {showPinned && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DUR.out, ease: EASE }}
            style={{ overflow: 'hidden', position: 'absolute', top: '72px', left: 0, right: 0, zIndex: 6 }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                width: '100%',
                maxWidth: 688,
                mx: 'auto',
                mb: 0.5,
                px: 1.75,
                py: 1,
                borderRadius: '24px',
                background: tg.bubble,
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0 1px 6px -1px rgba(0,0,0,0.5)'
                    : '0 1px 5px -1px rgba(0,0,0,0.16)',
              }}
            >
              <PushPinRoundedIcon sx={{ color: tg.accent, fontSize: 20, transform: 'rotate(45deg)' }} />
              <Box sx={{ flex: 1, minWidth: 0, borderLeft: `3px solid ${tg.accent}`, pl: 1.25 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 500, color: tg.accent, lineHeight: '20px' }}>
                  {t('Pinned Message')}
                </Typography>
                <Typography noWrap sx={{ fontSize: 14, color: tg.textPrimary, lineHeight: '20px' }}>
                  📌 Запись и вопросы — @kyzdar_manager · Расписание на неделю закреплено ниже 💜
                </Typography>
              </Box>
              <IconButton size="small" onClick={() => setShowPinned(false)} sx={{ color: tg.textFaint }}>
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Box>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages — own scroll container, masked like tweb's bubbles-scrollable */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          maskImage: FEED_MASK,
          WebkitMaskImage: FEED_MASK,
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: 688,
            // clear the floating header (+ pinned bar) on top and the footer below
            pt: showPinned ? '132px' : '76px',
            pb: `${FADE_BOTTOM}px`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
          }}
        >
          <Box sx={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column' }}>
            {kyzdarPosts.map((post) => (
              <Box key={post.id} sx={{ display: 'flex', flexDirection: 'column' }}>
                {post.date && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', my: 1 }}>
                    <Typography
                      sx={{
                        fontSize: 13.5,
                        fontWeight: 500,
                        color: '#fff',
                        background: 'rgba(0,0,0,0.35)',
                        px: 1.25,
                        py: 0.4,
                        borderRadius: '14px',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                      }}
                    >
                      {post.date}
                    </Typography>
                  </Box>
                )}
                <ChannelPost post={post} onOpenMedia={setMedia} />
              </Box>
            ))}
            <CommentsBar onOpen={() => setDiscussion(kyzdarPosts[kyzdarPosts.length - 1])} />
          </Box>
        </Box>
      </Box>

      {/* Footer / Mute bar — floating over the feed */}
      <Box
        sx={{
          position: 'absolute',
          bottom: '16px',
          left: 0,
          right: 0,
          zIndex: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          width: '100%',
          maxWidth: 688,
          mx: 'auto',
          px: 0,
          py: 0,
        }}
      >
        <MotionBox
          whileHover={{ background: tg.hover }}
          whileTap={{ scale: 0.995 }}
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            background: tg.bubble,
            border: `1px solid ${tg.bubbleBorder}`,
            borderRadius: '14px',
            py: 1.5,
            cursor: 'pointer',
            color: tg.textPrimary,
          }}
        >
          <VolumeOffRoundedIcon sx={{ fontSize: 20, color: tg.textSecondary }} />
          <Typography sx={{ fontWeight: 600, fontSize: 15.5 }}>{t('Mute')}</Typography>
        </MotionBox>
        <MotionBox
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          sx={{
            width: 52,
            height: 52,
            borderRadius: '14px',
            background: tg.bubble,
            border: `1px solid ${tg.bubbleBorder}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <CardGiftcardRoundedIcon sx={{ color: tg.textSecondary }} />
        </MotionBox>
      </Box>
      </Box>

      {/* Channel Info panel */}
      <AnimatePresence>
        {showInfo && <UserInfoPanel chat={dollhouse} onClose={() => setShowInfo(false)} />}
      </AnimatePresence>

      {/* Header "⋮" menu */}
      {headerMenu && (
        <HeaderMenu chat={dollhouse} anchor={headerMenu} onClose={() => setHeaderMenu(null)} />
      )}

      {/* Media lightbox */}
      <AnimatePresence>
        {media && <MediaViewer media={media} onClose={() => setMedia(null)} />}
      </AnimatePresence>

      {/* Comments / discussion thread */}
      <AnimatePresence>
        {discussion && (
          <DiscussionView
            post={{
              title: discussion.title,
              text: discussion.paras.map((p) => p.map((s) => s.t).join('')).join('\n'),
              gradient: discussion.photo?.gradient,
              emoji: discussion.photo?.emoji,
            }}
            onBack={() => setDiscussion(null)}
          />
        )}
      </AnimatePresence>
    </Box>
  )
}
