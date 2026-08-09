import type { CSSProperties } from 'react'
import classNames from '../../lib/classNames'
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

// Размеры, для которых в tweb `_avatar.scss` есть готовый класс `.avatar-N`
// (он задаёт --size и --multiplier = 54 / N). Для прочих ставим то же самое инлайном.
const TWEB_AVATAR_SIZES = new Set([
  162, 144, 128, 120, 107, 100, 90, 89, 86, 84, 76, 75, 64, 60, 54, 48, 46, 44,
  42, 40, 37, 36, 35, 34, 32, 30, 26, 24, 22, 20, 18, 16,
])

interface AvatarProps {
  background: string
  text?: string
  emoji?: string
  /** resolved image URL; when set it replaces the initials/emoji */
  src?: string
  /** a named size from AVATAR_SIZE, or a raw px number for one-offs */
  size?: AvatarSize | number
  online?: boolean
  /** color of the ring around the online dot (defaults to the surface behind the avatar) */
  ringColor?: string
  /** дополнительные классы на корне (например .person-avatar из tweb-топбара) */
  className?: string
  /** id пира — уезжает в `data-peer-id` (tweb avatarNew.tsx:1076) */
  peerId?: string | number
  /** клик по самому аватару (tweb вешает обработчик на узел .avatar) */
  onClick?: () => void
}

// Аватар — разметка tweb (avatarNew.tsx:1073): один узел
// `div.avatar.avatar-like.avatar-{N}` с инициалами прямо внутри либо
// `img.avatar-photo`. Форма/размер/шрифт/uppercase — из `_avatar.scss`
// (`.avatar-like` даёт --size, line-height и font-size от --multiplier).
// Онлайн-точка — `.is-online` (псевдоэлемент :after там же).
//
// Класс `avatar-gradient` в tweb стоит на узле `.avatar` БЕЗУСЛОВНО
// (avatarNew.tsx:1073 — он в самой строке class, а не в classList), и заливка
// приходит из `_avatar.scss:14` — `background: linear-gradient(--color-top,
// --color-bottom)` по `data-color`. Ставим так же.
//
// Отступление: `data-color` мы не пишем — цвет приходит готовой строкой градиента
// из `gradientFor()` (те же 7 значений) и применяется инлайном, поэтому
// заливка `.avatar-gradient` перекрывается; перевод на data-color потребует
// токенов --peer-avatar-* и правки ~45 мест вызова.
export default function Avatar({
  background,
  text,
  emoji,
  src,
  size = 'dialog',
  online = false,
  ringColor,
  className,
  peerId,
  onClick,
}: AvatarProps) {
  const px = typeof size === 'number' ? size : AVATAR_SIZE[size]
  const known = TWEB_AVATAR_SIZES.has(px)
  const style = {
    background,
    ...(known ? {} : { '--size': `${px}px`, '--multiplier': String(54 / px) }),
    ...(ringColor ? { '--avatar-ring': ringColor } : {}),
  } as CSSProperties

  return (
    <div
      className={classNames('avatar', 'avatar-like', known ? `avatar-${px}` : '', 'avatar-gradient', online ? 'is-online' : '', s.root, className ?? '')}
      style={style}
      data-peer-id={peerId}
      onClick={onClick}
    >
      {src ? (
        <img className="avatar-photo" src={src} alt="" loading="lazy" decoding="async" />
      ) : emoji === 'tg-logo' ? (
        <svg className={s.glyph} width={px * 0.62} height={px * 0.62} viewBox="0 0 24 24" fill="#fff" aria-label="Telegram">
          <path d="M21.8 3.1 1.9 10.8c-1 .4-1 1.8 0 2.1l5 1.6 1.9 6c.3.9 1.4 1.1 2 .4l2.7-2.7 5 3.7c.7.5 1.7.1 1.9-.7l3.4-16c.2-1-.7-1.8-1.6-1.4zM9.5 14.3l8.6-5.3c.2-.1.4.2.2.3l-7 6.6c-.2.2-.3.5-.3.8l-.2 2.4-1.3-4.1c-.1-.3 0-.6.2-.7z" />
        </svg>
      ) : emoji === 'saved' ? (
        <svg className={s.glyph} width={px * 0.5} height={px * 0.5} viewBox="0 0 24 24" fill="#fff" aria-label="Saved Messages">
          <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
        </svg>
      ) : (
        text ?? emoji
      )}
    </div>
  )
}
