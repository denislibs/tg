import { useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import Text from '../shared/ui/Text'
import { useChatsStore } from '../stores/chatsStore'
import { gradientFor } from '../core/dialogToChat'
import classNames from '../shared/lib/classNames'
import s from './AddStorySheet.module.scss'

export type StoryPrivacy = 'everyone' | 'contacts' | 'selected'

const PRIVACY_OPTIONS: { key: StoryPrivacy; label: string }[] = [
  { key: 'everyone', label: 'Все' },
  { key: 'contacts', label: 'Контакты' },
  { key: 'selected', label: 'Выбранные' },
]

/**
 * Caption + privacy sheet shown after a story media file is picked + uploaded.
 * Reuses the app's slide-in panel pattern (mirrors NewGroupFlow / UserInfoPanel's
 * RightsEditor): an absolute-positioned motion panel over the sidebar with a
 * back header, a rounded card body and a confirm FAB.
 */
export default function AddStorySheet({
  onBack,
  onPublish,
}: {
  onBack: () => void
  onPublish: (args: { caption: string; privacy: StoryPrivacy; allowIds: number[] }) => void | Promise<void>
}) {
  const dialogs = useChatsStore((s) => s.dialogs)
  // private peers only — the contact pool for the "Выбранные" audience
  const contacts = dialogs
    .filter((d) => d.type === 'private' && d.peer)
    .map((d) => d.peer!)

  const [caption, setCaption] = useState('')
  const [privacy, setPrivacy] = useState<StoryPrivacy>('contacts')
  const [allow, setAllow] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  const toggleContact = (id: number) =>
    setAllow((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const publish = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onPublish({
        caption: caption.trim(),
        privacy,
        allowIds: privacy === 'selected' ? [...allow] : [],
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 42,
        background: 'var(--tg-sidebarBg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Шапка */}
      <div className={s.header}>
        <IconButton onClick={onBack} aria-label="Назад" color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)">
          Новая история
        </Text>
      </div>

      <div className={s.body}>
        {/* Подпись */}
        <div className={classNames(s.card, s.captionCard)}>
          <div className={s.captionField}>
            <textarea
              autoFocus
              rows={1}
              className={s.captionInput}
              placeholder=" "
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <label className={s.captionLabel}>Подпись</label>
          </div>
        </div>

        {/* Селектор приватности (сегментированные кнопки) */}
        <div className={s.privacyBlock}>
          <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionLabel}>
            Кто может видеть
          </Text>
          <div className={classNames(s.card, s.segments)} role="radiogroup" aria-label="Кто может видеть историю">
            {PRIVACY_OPTIONS.map((opt) => {
              const active = privacy === opt.key
              return (
                <div
                  key={opt.key}
                  role="radio"
                  aria-checked={active}
                  tabIndex={0}
                  onClick={() => setPrivacy(opt.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setPrivacy(opt.key)
                    }
                  }}
                  className={classNames(s.segment, active ? s.segmentActive : '')}
                >
                  {opt.label}
                </div>
              )
            })}
          </div>
        </div>

        {/* Выбор контактов для аудитории "Выбранные" */}
        {privacy === 'selected' && (
          <div className={s.contactsBlock}>
            <Text size={14} weight={600} color="var(--tg-accent)" className={s.sectionLabel}>
              Контакты
            </Text>
            <div className={classNames(s.card, s.contactsList)}>
              {contacts.length === 0 && (
                <Text size={15} color="var(--tg-textSecondary)" className={s.emptyRow}>
                  Нет контактов
                </Text>
              )}
              {contacts.map((c) => {
                const checked = allow.has(c.id)
                return (
                  <div
                    key={c.id}
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={c.displayName}
                    tabIndex={0}
                    onClick={() => toggleContact(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleContact(c.id)
                      }
                    }}
                    className={s.contactRow}
                  >
                    <Avatar
                      background={gradientFor(c.id)}
                      text={c.displayName.charAt(0).toUpperCase()}
                      size="sm"
                    />
                    <Text noWrap size={16} color="var(--tg-textPrimary)" className={s.contactName}>
                      {c.displayName}
                    </Text>
                    <div className={classNames(s.check, checked ? s.checkOn : '')}>
                      {checked && <TgIcon name="check" size={16} />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* FAB публикации */}
      <motion.div
        onClick={publish}
        role="button"
        aria-label="Опубликовать"
        aria-disabled={busy}
        whileHover={{ scale: busy ? 1 : 1.06 }}
        whileTap={{ scale: busy ? 1 : 0.92 }}
        className={classNames(s.fab, busy ? s.fabBusy : '')}
      >
        <TgIcon name="check" />
      </motion.div>
    </motion.div>
  )
}
