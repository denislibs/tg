import { Box, Typography, useTheme } from '@mui/material'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import type { ChannelPost as Post } from '../data'
import Reaction from './Reaction'

export default function ChannelPost({
  post,
  onOpenMedia,
}: {
  post: Post
  onOpenMedia?: (m: { gradient: string; emoji?: string; time?: string }) => void
}) {
  const theme = useTheme()
  const tg = theme.tg
  const linkSx = { color: tg.link, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }

  return (
    <Box sx={{ maxWidth: 520, width: '100%', mb: 1.5 }}>
      <Box
        sx={{
          background: tg.bubble,
          border: `1px solid ${tg.bubbleBorder}`,
          borderRadius: '14px',
          overflow: 'hidden',
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 1px 2px rgba(0,0,0,0.4)'
              : '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        {/* Photo placeholder */}
        {post.photo && (
          <Box
            onClick={() =>
              onOpenMedia?.({
                gradient: post.photo!.gradient,
                emoji: post.photo!.emoji,
                time: post.time,
              })
            }
            sx={{
              height: post.photo.height ?? 280,
              background: post.photo.gradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              position: 'relative',
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: 0,
                background:
                  'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.18), transparent 60%)',
              },
            }}
          >
            <Typography sx={{ fontSize: 88, lineHeight: 1, userSelect: 'none', zIndex: 1 }}>
              {post.photo.emoji}
            </Typography>
          </Box>
        )}

        {/* Body */}
        <Box sx={{ px: 1.75, py: 1.5 }}>
          {post.title && (
            <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 1.25, color: tg.textPrimary }}>
              {post.title}
            </Typography>
          )}

          {post.paras.map((para, i) => (
            <Typography
              key={i}
              sx={{
                fontSize: 15,
                lineHeight: 1.5,
                mb: i === post.paras.length - 1 ? 0.5 : 1.5,
                color: tg.textPrimary,
              }}
            >
              {para.map((s, j) => (
                <Box key={j} component="span" sx={s.link ? linkSx : undefined}>
                  {s.t}
                </Box>
              ))}
            </Typography>
          ))}

          {/* Reactions + views */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.75, flexWrap: 'wrap' }}>
            {post.reactions.map((r, i) => (
              <Reaction key={i} emoji={r.emoji} count={r.count} highlighted={r.highlighted} />
            ))}
            <Box sx={{ flex: 1 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: tg.textFaint }}>
              <Typography sx={{ fontSize: 13.5 }}>{post.views}</Typography>
              <VisibilityRoundedIcon sx={{ fontSize: 17 }} />
              <Typography sx={{ fontSize: 13.5, ml: 0.5 }}>{post.time}</Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
