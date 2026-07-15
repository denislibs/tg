import type { CSSProperties } from 'react'
import s from './Avatar.module.scss'

// Canonical avatar sizes (px) by role — prefer a named size over a magic number
// at call sites. A raw number is still accepted for genuine one-offs.
export const AVATAR_SIZE = {
  xs: 32, // compact menus / inline lists
  sm: 40, // search results, small rows
  md: 42, // member / contact rows (tweb 'abitbigger')
  lg: 48, // settings / info rows
  dialog: 54, // chat-list row (default)
  profile: 120, // profile / info header
} as const

export type AvatarSize = keyof typeof AVATAR_SIZE

interface AvatarProps {
  background: string
  text?: string
  emoji?: string
  /** resolved image URL; when set it replaces the initials/emoji */
  src?: string
  /** a named size from AVATAR_SIZE, or a raw px number for one-offs */
  size?: AvatarSize | number
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
  size = 'dialog',
  color = '#fff',
  online = false,
  ringColor,
}: AvatarProps) {
  const px = typeof size === 'number' ? size : AVATAR_SIZE[size]
  // Dynamic per-instance values ride in as CSS variables; the module derives the
  // dot/ring/font sizes from --size in pure CSS (no JS math, no theme read).
  const style = {
    '--size': `${px}px`,
    '--avatar-bg': background,
    '--avatar-color': color,
    ...(ringColor ? { '--avatar-ring': ringColor } : {}),
  } as CSSProperties

  return (
    <div className={s.root} style={style}>
      <div className={s.circle}>
        {src ? (
          <img className={s.image} src={src} alt="" />
        ) : emoji === 'tg-logo' ? (
          <svg width={px * 0.62} height={px * 0.62} viewBox="0 0 24 24" fill="#fff" aria-label="Telegram">
            <path d="M21.8 3.1 1.9 10.8c-1 .4-1 1.8 0 2.1l5 1.6 1.9 6c.3.9 1.4 1.1 2 .4l2.7-2.7 5 3.7c.7.5 1.7.1 1.9-.7l3.4-16c.2-1-.7-1.8-1.6-1.4zM9.5 14.3l8.6-5.3c.2-.1.4.2.2.3l-7 6.6c-.2.2-.3.5-.3.8l-.2 2.4-1.3-4.1c-.1-.3 0-.6.2-.7z" />
          </svg>
        ) : emoji === 'saved' ? (
          <svg width={px * 0.5} height={px * 0.5} viewBox="0 0 24 24" fill="#fff" aria-label="Saved Messages">
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
          </svg>
        ) : (
          text ?? emoji
        )}
      </div>
      {online && <div className={s.online} />}
    </div>
  )
}
