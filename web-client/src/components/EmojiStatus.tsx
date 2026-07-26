interface Props {
  emoji: string
  size?: number
}

// A user's emoji status: a plain unicode emoji rendered after the name (there's
// no custom-emoji document infra in this clone, so it's just text). Mirrors the
// placement of VerifiedBadge/PremiumBadge next to a name.
export default function EmojiStatus({ emoji, size = 16 }: Props) {
  return (
    <span
      aria-label="emoji status"
      style={{ flexShrink: 0, fontSize: size, lineHeight: 1 }}
    >
      {emoji}
    </span>
  )
}
