import { VERIFIED_BADGE_SEAL_PATH, VERIFIED_BADGE_CHECK_PATH } from '../shared/icons/verifiedBadgePath'

interface Props {
  size?: number
  /** класс на корне — например `verified-icon`/`premium-icon` из tweb */
  className?: string
  color?: string
  /** the inner check colour — invert it (to the seal's bg) on selected rows so a
      white seal doesn't render an invisible white check on white. */
  checkColor?: string
}

// Telegram verified badge (exact paths from tweb icon-verified.svg): scalloped
// seal + white check.
export default function VerifiedBadge({ size = 16, color = 'var(--primary-color)', checkColor = '#fff', className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ flexShrink: 0, display: 'block' }}
      aria-label="verified"
    >
      <path fill={color} d={VERIFIED_BADGE_SEAL_PATH} />
      <path fill={checkColor} d={VERIFIED_BADGE_CHECK_PATH} />
    </svg>
  )
}
