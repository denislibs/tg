import { useState } from 'react'
import { Box, Typography, IconButton, InputBase, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import KeyboardVoiceRounded from '@mui/icons-material/KeyboardVoiceRounded'
import { slideInRight } from '../motion'
import { useT } from '../i18n'
import Avatar from './Avatar'

interface Comment {
  name: string
  text: string
  time: string
  gradient: string
  color: string
  out?: boolean
}

const MOCK_COMMENTS: Comment[] = [
  {
    name: 'Aizhan',
    text: 'This is exactly what I needed, thank you for sharing!',
    time: '14:02',
    gradient: 'linear-gradient(135deg,#ff5f6d,#ffc371)',
    color: '#e8506a',
  },
  {
    name: 'Daniyar',
    text: 'Can you explain how the model handles longer prompts?',
    time: '14:05',
    gradient: 'linear-gradient(135deg,#43e97b,#38f9d7)',
    color: '#1fae6a',
  },
  {
    name: 'You',
    text: 'Sure, it keeps the full context window in memory.',
    time: '14:06',
    gradient: '',
    color: '',
    out: true,
  },
  {
    name: 'Madina',
    text: 'Love the new design, feels so much cleaner now 🔥',
    time: '14:09',
    gradient: 'linear-gradient(135deg,#a18cd1,#fbc2eb)',
    color: '#8a6cf0',
  },
  {
    name: 'Ruslan',
    text: 'Is there a way to export the results to CSV?',
    time: '14:12',
    gradient: 'linear-gradient(135deg,#4facfe,#00f2fe)',
    color: '#2b8fe0',
  },
  {
    name: 'You',
    text: 'Working on it — should ship next week!',
    time: '14:14',
    gradient: '',
    color: '',
    out: true,
  },
]

export default function DiscussionView({
  post,
  onBack,
}: {
  post: { title?: string; text?: string; gradient?: string; emoji?: string }
  onBack: () => void
}) {
  const t = useT()
  const tg = useTheme().tg
  const [comments, setComments] = useState<Comment[]>(MOCK_COMMENTS)
  const [draft, setDraft] = useState('')

  const send = () => {
    const text = draft.trim()
    if (!text) return
    const now = new Date()
    const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
    setComments((c) => [...c, { name: 'You', text, time, gradient: '', color: '', out: true }])
    setDraft('')
  }

  return (
    <motion.div
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: tg.appBg,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          height: 56,
          px: 1,
          py: 1.25,
          borderBottom: `1px solid ${tg.divider}`,
          flexShrink: 0,
        }}
      >
        <IconButton onClick={onBack} sx={{ color: tg.textPrimary }}>
          <ArrowBackRounded />
        </IconButton>
        <Typography sx={{ flex: 1, fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>
          {t('Comments')}
        </Typography>
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Pinned original post */}
        <Box sx={{ background: tg.bubble, borderRadius: '14px', p: 1.5 }}>
          {post.gradient && (
            <Box
              sx={{
                height: 160,
                borderRadius: '8px',
                background: post.gradient,
                mb: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 64,
                lineHeight: 1,
                userSelect: 'none',
              }}
            >
              {post.emoji}
            </Box>
          )}
          {post.title && (
            <Typography sx={{ fontWeight: 700, fontSize: 15, color: tg.textPrimary, mb: 0.25 }}>
              {post.title}
            </Typography>
          )}
          {post.text && <Typography sx={{ fontSize: 15, color: tg.textPrimary }}>{post.text}</Typography>}
        </Box>

        {/* Comments */}
        {comments.map((c, i) =>
          c.out ? (
            <Box key={i} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Box
                sx={{
                  background: tg.accent,
                  color: '#fff',
                  borderRadius: '14px 14px 4px 14px',
                  px: 1.25,
                  py: 0.75,
                  maxWidth: '75%',
                }}
              >
                <Typography sx={{ fontSize: 15 }}>{c.text}</Typography>
                <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', textAlign: 'right', mt: 0.25 }}>
                  {c.time}
                </Typography>
              </Box>
            </Box>
          ) : (
            <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
              <Avatar background={c.gradient} size={32} text={c.name.charAt(0)} />
              <Box
                sx={{
                  background: tg.bubble,
                  borderRadius: '4px 14px 14px 14px',
                  px: 1.25,
                  py: 0.75,
                  maxWidth: '75%',
                }}
              >
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: c.color }}>{c.name}</Typography>
                <Typography sx={{ fontSize: 15, color: tg.textPrimary }}>{c.text}</Typography>
                <Typography sx={{ fontSize: 12, color: tg.textFaint, textAlign: 'right', mt: 0.25 }}>
                  {c.time}
                </Typography>
              </Box>
            </Box>
          )
        )}
      </Box>

      {/* Footer composer */}
      <Box
        sx={{
          m: 1,
          background: tg.bubble,
          borderRadius: '24px',
          height: 48,
          display: 'flex',
          alignItems: 'center',
          px: 1,
          gap: 0.5,
          flexShrink: 0,
        }}
      >
        <InputBase
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
          placeholder={t('Comment')}
          sx={{ flex: 1, color: tg.textPrimary, px: 1, fontSize: 15 }}
        />
        <Box
          onClick={send}
          sx={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: tg.accentGradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <KeyboardVoiceRounded sx={{ color: '#fff', fontSize: 22 }} />
        </Box>
      </Box>
    </motion.div>
  )
}
