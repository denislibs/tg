import { createPortal } from 'react-dom'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import classNames from '../shared/lib/classNames'
import { usePopupTransition } from './settings/kit'
import { useT } from '../i18n'
import { useManagers } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import s from './EmojiStatusPicker.module.scss'

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
  const { mounted, cls } = usePopupTransition(open)

  const set = async (emoji: string) => {
    try {
      const user = await managers.profile.setEmojiStatus(emoji)
      // Оптимистичное исключение из «пишет только проектор» (Stage 1C.2, Task 1
      // — см. докблок setMe в chatsStore.ts, stores/noDuplicateMe.test.ts):
      // попап закрывается сразу, ждать rt:me из воркера — заметная задержка
      // отклика. Воркер (profileManager.setEmojiStatus → onMeChanged) ТОЖЕ
      // разошлёт тот же снимок остальным вкладкам — повторное применение здесь
      // идемпотентно, флика не даёт.
      setMe(user)
    } finally {
      onClose()
    }
  }

  // Показ/скрытие — классы tweb `PopupElement` (`active`/`hiding`), см.
  // usePopupTransition в settings/kit.tsx: скрим набирает opacity, карточка едет
  // translate3d(0, 3rem, 0) → 0 за --popup-transition-time. Узел живёт в DOM до
  // конца затухания — роль AnimatePresence.
  if (!mounted) return null

  return createPortal(
    <div onClick={onClose} className={classNames('popup', cls, s.overlay)}>
      <div onClick={(e) => e.stopPropagation()} className={classNames('popup-container', s.dialog)}>
        <div className={s.head}>
          <Text size={17} weight={600} color="var(--primary-text-color)" style={{ flex: 1 }}>
            {t('Set Emoji Status')}
          </Text>
          {current && (
            <span onClick={() => void set('')} className={s.remove}>
              <TgIcon name="close" size={16} color="var(--primary-color)" />
              <Text size={14} color="var(--primary-color)">{t('Remove')}</Text>
            </span>
          )}
        </div>
        <div className={s.grid}>
          {STATUS_EMOJIS.map((emoji) => (
            <div
              key={emoji}
              onClick={() => void set(emoji)}
              className={classNames(s.item, current === emoji ? s.itemActive : '')}
            >
              {emoji}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
