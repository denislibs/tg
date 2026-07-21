import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useT } from '../i18n'
import { useManagers } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'

// A modest fixed set of unicode "status" emojis. There's no custom-emoji document
// infra in this clone, so the status is a plain emoji (Telegram Premium-style).
const STATUS_EMOJIS = [
  '⭐', '🔥', '❤️', '😎', '🚀', '🎉', '💎', '👑',
  '🌟', '⚡', '🌈', '🍀', '☕', '🎮', '🎧', '📚',
  '💻', '✈️', '🏔️', '🌙', '🐱', '🐶', '🌸', '🎯',
]

// Emoji-status picker popup: a small grid of unicode emojis + a "clear" action.
// Picking one persists it via profile.setEmojiStatus and refreshes `me`.
export default function EmojiStatusPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const managers = useManagers()
  const setMe = useChatsStore((st) => st.setMe)
  const current = useChatsStore((st) => st.me?.emojiStatus) ?? ''

  const set = async (emoji: string) => {
    try {
      const user = await managers.profile.setEmojiStatus(emoji)
      setMe(user)
    } finally {
      onClose()
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.4)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            style={{ width: 320, maxWidth: '90vw', background: 'var(--tg-sidebarBg)', borderRadius: 12, padding: 16, boxShadow: '0 8px 32px rgba(0,0,0,.25)' }}
            initial={{ scale: 0.94, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 6 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <Text size={17} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
                {t('Set Emoji Status')}
              </Text>
              {current && (
                <span
                  onClick={() => void set('')}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--tg-accent)' }}
                >
                  <TgIcon name="close" size={16} color="var(--tg-accent)" />
                  <Text size={14} color="var(--tg-accent)">{t('Remove')}</Text>
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
              {STATUS_EMOJIS.map((emoji) => (
                <div
                  key={emoji}
                  onClick={() => void set(emoji)}
                  style={{
                    fontSize: 24,
                    lineHeight: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 36,
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: current === emoji ? 'var(--tg-sectionBackdrop)' : 'transparent',
                  }}
                >
                  {emoji}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
