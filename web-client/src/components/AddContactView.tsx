// src/components/AddContactView.tsx
// The "Add contact" screen (tweb editContact.tsx, isNew branch). Docks as a side
// panel next to the conversation — same container behaviour as UserInfoPanel: a
// 404px sticky column on wide screens (the chat shrinks beside it), a full-height
// card overlay on narrow ones. Inside: a big avatar + the peer's original name, a
// card with name/last-name/note fields and a "number hidden" phone row, a "show my
// phone" checkbox, and a floating ✓ that POSTs to /contacts. Russian copy is
// hardcoded (the app renders Russian; sibling panels do the same).
import { useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import Input from '../shared/ui/Input'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import { useAvatarSrc } from './useAvatarSrc'
import { useManagers } from '../core/hooks/useManagers'
import type { Chat } from '../data'
import s from './AddContactView.module.scss'
import useMediaQuery from '../shared/lib/useMediaQuery'

// Split a display name into a first/last seed (everything after the first token is
// the last name) — mirrors tweb prefilling first/last from the user's profile name.
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

export default function AddContactView({
  chat,
  onClose,
  onAdded,
}: {
  chat: Chat
  onClose: () => void
  onAdded?: () => void
}) {
  const managers = useManagers()
  const narrow = useMediaQuery('(max-width:900px)')
  const seed = splitName(chat.name)
  const [first, setFirst] = useState(seed.first)
  const [last, setLast] = useState(seed.last)
  const [note, setNote] = useState('')
  const [sharePhone, setSharePhone] = useState(true)
  const [saving, setSaving] = useState(false)
  const avatarSrc = useAvatarSrc(chat.avatarUrl)
  const displayFirst = first.trim() || chat.name

  const canSave = !!chat.peerId && first.trim().length > 0 && !saving

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await managers.contacts.add({
        contactId: chat.peerId!,
        firstName: first.trim(),
        lastName: last.trim(),
        note: note.trim(),
        sharePhone,
      })
      onAdded?.()
      onClose()
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className={narrow ? s.dockNarrow : s.dockWide}>
      {narrow && <div className={s.backdrop} onClick={onClose} />}
      <div
        className={`${s.panel} ${narrow ? `${s.panelNarrow} ${s.panelNarrowIn}` : s.panelWide}`}
      >
        {/* Header — back + title */}
        <div className={s.header}>
          <IconButton onClick={onClose} color="var(--secondary-text-color)">
            <TgIcon name="back" />
          </IconButton>
          <Text size={19} weight={600} color="var(--primary-text-color)">Добавить контакт</Text>
        </div>

        <div className={s.body}>
          {/* Avatar + original name */}
          <div className={s.avatarBlock}>
            <Avatar background={chat.avatar} text={chat.avatarText ?? chat.name[0]} src={avatarSrc} preview={chat.avatarPreview} size="profile" />
            <Text size={22} weight={600} color="var(--primary-text-color)" style={{ marginTop: '16px' }}>{chat.name}</Text>
            <Text size={14} color="var(--secondary-text-color)" style={{ marginTop: '2px' }}>исходное имя</Text>
          </div>

          {/* Fields card */}
          <div className={s.card}>
            <Input
              label="Имя (обязательно)"
              value={first}
              onChange={setFirst}
              autoFocus
              wrapClassName={`${s.field} ${s.fieldGap}`}
            />
            <Input
              label="Фамилия (необязательно)"
              value={last}
              onChange={setLast}
              wrapClassName={`${s.field} ${s.fieldGap}`}
            />
            <div className={s.noteWrap}>
              <Input
                label="Заметка"
                value={note}
                onChange={setNote}
                wrapClassName={s.field}
              />
              <span className={s.noteIcon}>
                <TgIcon name="smile" color="var(--secondary-text-color)" />
              </span>
            </div>

            {/* Phone "hidden" row */}
            <div className={s.phoneRow}>
              <TgIcon name="phone" size={24} color="var(--secondary-text-color)" style={{ marginTop: 2 }} />
              <div className={s.phoneText}>
                <Text size={16} weight={600} color="var(--primary-text-color)">Номер скрыт</Text>
                <Text size={14} color="var(--secondary-text-color)" style={{ lineHeight: 1.35 }}>
                  Номер телефона будет виден, когда {displayFirst} добавит Вас в контакты.
                </Text>
              </div>
            </div>
          </div>

          {/* Share-phone checkbox (square, left — tweb's CheckboxField) */}
          <div className={s.shareRow} onClick={() => setSharePhone((v) => !v)}>
            <div className={`${s.check} ${sharePhone ? s.checkOn : ''}`}>
              {sharePhone && <TgIcon name="check" size={18} color="#fff" />}
            </div>
            <Text size={16} color="var(--primary-text-color)">Показать номер телефона</Text>
          </div>
          <Text size={14} color="var(--secondary-text-color)" className={s.shareHint}>
            Вы можете разрешить {displayFirst} видеть Ваш номер телефона.
          </Text>
        </div>

        {/* Floating submit */}
        {/* tweb не масштабирует кнопки по нажатию — отклик даёт ripple/фон
            (_button.scss:75-77), поэтому whileTap снят. */}
        <button
          onClick={submit}
          disabled={!canSave}
          className={s.fab}
          style={{ cursor: canSave ? 'pointer' : 'default', opacity: canSave ? 1 : 0.5 }}
        >
          <TgIcon name="check" size={28} />
        </button>
      </div>
    </div>
  )
}
