import TgIcon from './TgIcon'

interface Props {
  size?: number
  /** класс на корне — например `verified-icon`/`premium-icon` из tweb */
  className?: string
  /** badge colour; defaults to the Telegram Premium gold/accent star */
  color?: string
}

// Telegram Premium badge: the gold star glyph (tgico premium_badge) shown next to
// a subscriber's name, mirroring VerifiedBadge's placement/sizing.
export default function PremiumBadge({ size = 16, color = '#9275ff', className }: Props) {
  return (
    <TgIcon
      className={className}
      name="premium_badge"
      size={size}
      color={color}
      style={{ flexShrink: 0, lineHeight: 1 }}
    />
  )
}
