import { Box, useTheme } from '@mui/material'

interface AvatarProps {
  background: string
  text?: string
  emoji?: string
  /** resolved image URL; when set it replaces the initials/emoji */
  src?: string
  size?: number
  color?: string
  online?: boolean
  /** color of the ring around the online dot (defaults to the surface behind the avatar) */
  ringColor?: string
}

export default function Avatar({
  background,
  text,
  emoji,
  src,
  size = 54,
  color = '#fff',
  online = false,
  ringColor,
}: AvatarProps) {
  const tg = useTheme().tg
  const dot = Math.max(8, Math.round(size * 0.26)) // tweb: 14px on a 54px avatar
  const ring = Math.max(1.5, Math.round(size * 0.037)) // ~2px on 54px

  return (
    <Box sx={{ position: 'relative', flexShrink: 0, width: size, height: size }}>
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          background,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
          fontWeight: 600,
          fontSize: size * 0.42,
          userSelect: 'none',
          lineHeight: 1,
          overflow: 'hidden',
        }}
      >
        {src ? (
          <img
            src={src}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : emoji === 'tg-logo' ? (
          <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="#fff" aria-label="Telegram">
            <path d="M21.8 3.1 1.9 10.8c-1 .4-1 1.8 0 2.1l5 1.6 1.9 6c.3.9 1.4 1.1 2 .4l2.7-2.7 5 3.7c.7.5 1.7.1 1.9-.7l3.4-16c.2-1-.7-1.8-1.6-1.4zM9.5 14.3l8.6-5.3c.2-.1.4.2.2.3l-7 6.6c-.2.2-.3.5-.3.8l-.2 2.4-1.3-4.1c-.1-.3 0-.6.2-.7z" />
          </svg>
        ) : emoji === 'saved' ? (
          <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="#fff" aria-label="Saved Messages">
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
          </svg>
        ) : (
          (text ?? emoji)
        )}
      </Box>
      {online && (
        <Box
          sx={{
            position: 'absolute',
            right: '6%',
            bottom: '6%',
            width: dot,
            height: dot,
            borderRadius: '50%',
            background: '#4dcd5e',
            border: `${ring}px solid ${ringColor ?? tg.sidebarBg}`,
            boxSizing: 'border-box',
          }}
        />
      )}
    </Box>
  )
}
