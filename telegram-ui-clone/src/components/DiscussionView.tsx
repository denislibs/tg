import { useEffect, useRef, useState } from 'react'
import { Box, Typography, IconButton, InputBase, useTheme } from '@mui/material'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { slideInRight } from '../motion'
import { useT } from '../i18n'
import Avatar from './Avatar'
import { startClient } from '../client/bootstrap'
import { useChatsStore } from '../stores/chatsStore'
import { uiEvents } from '../core/hooks/uiEvents'
import { RT, type NewMessageEvt } from '../core/realtime/events'
import type { Message } from '../core/models'

interface Comment {
  id?: number
  name: string
  text: string
  time: string
  gradient: string
  color: string
  out?: boolean
}

// Per-author tint for sender names (same palette tweb uses for peers).
const PEER_COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774']
function peerColor(seed: number) {
  return PEER_COLORS[Math.abs(seed) % PEER_COLORS.length]
}
function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function DiscussionView({
  channelId,
  postId,
  discussionChatId,
  post,
  onBack,
}: {
  // Real channel discussions pass these; the design-time ChatView mock omits them
  // and falls back to a purely local (no-network) comment list.
  channelId?: number
  postId?: number
  discussionChatId?: number
  post: { title?: string; text?: string; gradient?: string; emoji?: string }
  onBack: () => void
}) {
  const real = channelId != null && postId != null && discussionChatId != null
  const t = useT()
  const tg = useTheme().tg
  const meId = useChatsStore((s) => s.meId)
  const { managers } = startClient()
  const [comments, setComments] = useState<Comment[]>([])
  const [draft, setDraft] = useState('')
  // Track seen message ids to dedupe optimistic vs server/live echoes.
  const seenIds = useRef<Set<number>>(new Set())

  // Resolve a Message into a display Comment (sender name via peersManager).
  const toComment = async (m: Message): Promise<Comment> => {
    const out = m.senderId === meId
    let name = 'You'
    if (!out) {
      const peers = await managers.peers.getUsers([m.senderId])
      const p = peers.find((x) => x.id === m.senderId)
      name = p?.displayName || p?.username || `#${m.senderId}`
    }
    return {
      id: m.id,
      name,
      text: m.text,
      time: fmtTime(m.createdAt),
      gradient: out ? '' : peerColor(m.senderId),
      color: out ? '' : peerColor(m.senderId),
      out,
    }
  }

  // Initial load: real comments for this post.
  useEffect(() => {
    if (!real) return
    let alive = true
    seenIds.current = new Set()
    setComments([])
    void managers.channels.listComments(channelId!, postId!).then(async ({ messages }) => {
      const mapped = await Promise.all(messages.map(toComment))
      if (!alive) return
      for (const m of messages) seenIds.current.add(m.id)
      setComments(mapped)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, channelId, postId])

  // Live: discussion-group new_message frames for this thread.
  useEffect(() => {
    if (!real) return
    const off = uiEvents.on(RT.newMessage, (raw) => {
      const m = raw as NewMessageEvt
      if (m.chat_id !== discussionChatId || m.thread_root_id !== postId) return
      if (seenIds.current.has(m.msg_id)) return
      seenIds.current.add(m.msg_id)
      const out = m.sender_id === meId
      const append = (name: string) =>
        setComments((c) => [
          ...c,
          {
            id: m.msg_id,
            name,
            text: m.text,
            time: fmtTime(m.created_at),
            gradient: out ? '' : peerColor(m.sender_id),
            color: out ? '' : peerColor(m.sender_id),
            out,
          },
        ])
      if (out) append('You')
      else
        void managers.peers.getUsers([m.sender_id]).then((peers) => {
          const p = peers.find((x) => x.id === m.sender_id)
          append(p?.displayName || p?.username || `#${m.sender_id}`)
        })
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, discussionChatId, postId, meId])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    // Optimistic append; for real threads the server echo (same id) is deduped.
    const now = new Date()
    const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
    setComments((c) => [...c, { name: 'You', text, time, gradient: '', color: '', out: true }])
    if (!real) return
    const clientMsgId = `c-disc-${postId}-${performance.now()}-${Math.random().toString(36).slice(2)}`
    void managers.channels.postComment(channelId!, postId!, text, clientMsgId).then((m) => {
      seenIds.current.add(m.id)
    })
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
          <TgIcon name="back" />
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
          <TgIcon name="microphone" size={22} color="#fff" />
        </Box>
      </Box>
    </motion.div>
  )
}
