import { Box, Typography, useTheme } from '@mui/material'
import TgIcon from '../TgIcon'
import type { ConvMsg, MsgStatus } from '../../data'
import { useTimeFormatter } from '../../settings'

export function Ticks({ status, color }: { status?: MsgStatus; color: string }) {
  if (!status) return null
  return <TgIcon name={status === 'read' ? 'checks' : 'check'} size={16} color={color} />
}

export function bubbleRadius(out: boolean, firstInGroup: boolean, lastInGroup: boolean) {
  return out
    ? `15px ${firstInGroup ? 15 : 5}px ${lastInGroup ? 0 : 5}px 15px`
    : `${firstInGroup ? 15 : 5}px 15px 15px ${lastInGroup ? 0 : 5}px`
}

/**
 * The little curl at the bottom corner of the last bubble in a group — the exact
 * path from tweb's `#message-tail-filled` symbol. Same colour as the bubble, it
 * sits at the squared bottom corner and curls outward. The host bubble must be
 * `position: relative` and must not clip overflow.
 */
export function BubbleTail({ out, color }: { out: boolean; color: string }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 11 20"
      width="11"
      height="20"
      sx={{
        position: 'absolute',
        bottom: 0,
        [out ? 'right' : 'left']: '-8.4px',
        width: '11px',
        height: '20px',
        flexShrink: 0,
        color,
        transform: out ? 'translateY(1px) scaleX(-1)' : 'translateY(1px)',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <g transform="translate(9 -14)" fillRule="evenodd">
        <path
          d="M-6 16h6v17c-.193-2.84-.876-5.767-2.05-8.782-.904-2.325-2.446-4.485-4.625-6.48A1 1 0 01-6 16z"
          transform="matrix(1 0 0 -1 0 49)"
          fill="currentColor"
        />
      </g>
    </Box>
  )
}

interface Ctx {
  m: ConvMsg
  out: boolean
  firstInGroup: boolean
  lastInGroup: boolean
}

/** document / file */
export function DocumentBubble({ m, out, firstInGroup, lastInGroup }: Ctx) {
  const tg = useTheme().tg
  const fmtTime = useTimeFormatter()
  const d = m.document
  return (
    <Box
      sx={{
        position: 'relative',
        maxWidth: 'min(340px, 82%)',
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 1.25,
        py: 1,
        background: out ? tg.accent : tg.bubble,
        color: out ? '#fff' : tg.textPrimary,
        borderRadius: bubbleRadius(out, firstInGroup, lastInGroup),
      }}
    >
      {lastInGroup && <BubbleTail out={out} color={out ? tg.accent : tg.bubble} />}
      <Box
        sx={{
          width: 46,
          height: 46,
          flexShrink: 0,
          borderRadius: '50%',
          background: out ? 'rgba(255,255,255,0.22)' : d?.color ?? tg.accent,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <TgIcon name="download" />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography noWrap sx={{ fontSize: 15, fontWeight: 500 }}>
          {d?.name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography sx={{ fontSize: 13, color: out ? 'rgba(255,255,255,0.8)' : tg.textSecondary }}>
            {d?.size} · {d?.ext}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12, color: out ? 'rgba(255,255,255,0.8)' : tg.textFaint }}>
            {fmtTime(m.time)}
          </Typography>
          <Ticks status={m.status} color={out ? 'rgba(255,255,255,0.85)' : tg.textFaint} />
        </Box>
      </Box>
    </Box>
  )
}

/** audio / music */
export function AudioBubble({ m, out, firstInGroup, lastInGroup }: Ctx) {
  const tg = useTheme().tg
  const fmtTime = useTimeFormatter()
  const a = m.audio
  return (
    <Box
      sx={{
        position: 'relative',
        maxWidth: 'min(320px, 82%)',
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 1.25,
        py: 1,
        background: out ? tg.accent : tg.bubble,
        color: out ? '#fff' : tg.textPrimary,
        borderRadius: bubbleRadius(out, firstInGroup, lastInGroup),
      }}
    >
      {lastInGroup && <BubbleTail out={out} color={out ? tg.accent : tg.bubble} />}
      <Box
        sx={{
          width: 46,
          height: 46,
          flexShrink: 0,
          borderRadius: '50%',
          background: out ? 'rgba(255,255,255,0.22)' : tg.accent,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <TgIcon name="music" />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography noWrap sx={{ fontSize: 15, fontWeight: 500 }}>
          {a?.title}
        </Typography>
        <Typography noWrap sx={{ fontSize: 13, color: out ? 'rgba(255,255,255,0.8)' : tg.textSecondary }}>
          {a?.artist}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
          <Typography sx={{ fontSize: 12, color: out ? 'rgba(255,255,255,0.8)' : tg.textFaint }}>
            {a?.duration}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 12, color: out ? 'rgba(255,255,255,0.8)' : tg.textFaint }}>
            {fmtTime(m.time)}
          </Typography>
          <Ticks status={m.status} color={out ? 'rgba(255,255,255,0.85)' : tg.textFaint} />
        </Box>
      </Box>
    </Box>
  )
}

/** round video note */
export function RoundVideoBubble({ m, out }: Ctx) {
  const tg = useTheme().tg
  const fmtTime = useTimeFormatter()
  const size = 200
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: out ? 'flex-end' : 'flex-start' }}>
      <Box sx={{ position: 'relative', width: size, height: size }}>
        <Box
          sx={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: m.media?.gradient ?? tg.accentGradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <Typography sx={{ fontSize: 72, userSelect: 'none' }}>{m.media?.emoji ?? '🎥'}</Typography>
        </Box>
        {/* progress ring */}
        <Box
          component="svg"
          viewBox="0 0 200 200"
          sx={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)', pointerEvents: 'none' }}
        >
          <circle cx="100" cy="100" r="97" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="3" />
          <circle
            cx="100"
            cy="100"
            r="97"
            fill="none"
            stroke="#fff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 97}
            strokeDashoffset={2 * Math.PI * 97 * 0.7}
          />
        </Box>
        <Box
          sx={{
            position: 'absolute',
            left: '50%',
            bottom: 14,
            transform: 'translateX(-50%)',
            px: 0.75,
            py: 0.2,
            borderRadius: '10px',
            background: 'rgba(0,0,0,0.45)',
            color: '#fff',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
          }}
        >
          {m.videoDuration ?? '0:08'}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, mt: 0.5, mr: out ? 1 : 0, ml: out ? 0 : 1 }}>
        <Typography sx={{ fontSize: 12, color: tg.textFaint }}>{fmtTime(m.time)}</Typography>
        <Ticks status={m.status} color={tg.textFaint} />
      </Box>
    </Box>
  )
}

/** link preview card (rendered inside a text bubble) */
export function WebPagePreview({
  wp,
  out,
  linkColor,
}: {
  wp: NonNullable<ConvMsg['webPage']>
  out: boolean
  linkColor: string
}) {
  const tg = useTheme().tg
  return (
    <Box
      sx={{
        mt: 0.5,
        pl: 1,
        borderLeft: `3px solid ${out ? '#fff' : linkColor}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
      }}
    >
      <Typography sx={{ fontSize: 14, fontWeight: 600, color: out ? '#fff' : linkColor }}>
        {wp.siteName}
      </Typography>
      <Typography sx={{ fontSize: 14.5, fontWeight: 600, color: out ? '#fff' : tg.textPrimary }}>
        {wp.title}
      </Typography>
      {wp.description && (
        <Typography sx={{ fontSize: 14, color: out ? 'rgba(255,255,255,0.85)' : tg.textSecondary, lineHeight: 1.35 }}>
          {wp.description}
        </Typography>
      )}
      {wp.gradient && (
        <Box
          sx={{
            mt: 0.5,
            height: 160,
            borderRadius: '10px',
            background: wp.gradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            '&::after': {
              content: '""',
              position: 'absolute',
              inset: 0,
              borderRadius: '10px',
              background: 'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.16), transparent 60%)',
            },
          }}
        >
          {wp.emoji && <Typography sx={{ fontSize: 56, zIndex: 1 }}>{wp.emoji}</Typography>}
        </Box>
      )}
    </Box>
  )
}
