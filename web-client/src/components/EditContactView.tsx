// src/components/EditContactView.tsx
// Экран «Изменить контакт» (порт tweb editContact.tsx, ветка существующего
// контакта). Док-панель рядом с чатом — то же поведение, что у AddContactView и
// UserInfoPanel: 404px-колонка на широких экранах, оверлей на узких. Внутри —
// крупный аватар + исходное имя, карточка с полями имя/фамилия/заметка, карточка
// уведомления + «предложить дату рождения», карточка «фото контакта» (личное
// фото / предложить фото / сброс) и красное «Удалить контакт». Сохранение —
// плавающая ✓ (contacts.add — upsert по contact_id). Инфо-панель остаётся только
// для просмотра: все редактируемые поля живут здесь.
import { useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import Input from '../shared/ui/Input'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import { Section, Row } from './settings/kit'
import AvatarCropper from './settings/AvatarCropper'
import BirthdayModal from './settings/BirthdayModal'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import { useEditContact } from '../core/hooks/useEditContact'
import { useMuteToggle } from '../core/hooks/useMuteToggle'
import type { Chat } from '../data'
import add from './AddContactView.module.scss'
import useMediaQuery from '../shared/lib/useMediaQuery'

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

export default function EditContactView({
  chat,
  onClose,
}: {
  chat: Chat
  onClose: () => void
}) {
  const narrow = useMediaQuery('(max-width:900px)')
  // Ключ собеседника — сам `chat.id` (знаковый).
  const peerId = Number(chat.id)

  const seed = splitName(chat.name)
  const {
    first, setFirst, last, setLast, note, setNote,
    hasPersonal, busyPhoto, canSave,
    setPhotoMode, submit, onCropConfirm, resetPhoto, del,
  } = useEditContact(peerId, seed.first, onClose)
  const [birthdayOpen, setBirthdayOpen] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const avatarSrc = useMediaUrl(chat.photoId ?? null)
  const displayFirst = first.trim() || chat.name

  // Уведомления = per-chat mute (как в UserInfoPanel: checked = !muted).
  const numericChatId = Number(chat.id)
  const { muted, toggle: toggleNotifications } = useMuteToggle(numericChatId, chat.muted)

  const pickPhoto = (mode: 'set' | 'suggest') => {
    setPhotoMode(mode)
    fileRef.current?.click()
  }
  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) setCropFile(f)
  }

  return (
    <div className={narrow ? add.dockNarrow : add.dockWide}>
      {narrow && <div className={add.backdrop} onClick={onClose} />}
      <div
        className={`${add.panel} ${narrow ? `${add.panelNarrow} ${add.panelNarrowIn}` : add.panelWide}`}
        style={{ background: 'var(--background-color)' }}
      >
        <div className={add.header}>
          <IconButton onClick={onClose} color="var(--secondary-text-color)">
            <TgIcon name="back" />
          </IconButton>
          <Text size={19} weight={600} color="var(--primary-text-color)">Изменить контакт</Text>
        </div>

        <div className={add.body}>
          {/* Аватар + исходное имя */}
          <div className={add.avatarBlock}>
            <Avatar background={chat.avatar} text={chat.avatarText ?? chat.name[0]} src={avatarSrc} preview={chat.avatarPreview} size="profile" />
            <Text size={22} weight={600} color="var(--primary-text-color)" style={{ marginTop: '16px' }}>{chat.name}</Text>
            <Text size={14} color="var(--secondary-text-color)" style={{ marginTop: '2px' }}>исходное имя</Text>
          </div>

          {/* Секция 1 (как в tweb editContact): поля + уведомления + дата рождения */}
          <Section>
            {/* горизонтальный инсет инпутов от краёв карточки (tweb .input-wrapper padding: 0 .5rem) */}
            <div className={add.inputsPad}>
              <Input label="Имя (обязательно)" value={first} onChange={setFirst} autoFocus wrapClassName={`${add.field} ${add.fieldGap}`} />
              <Input label="Фамилия (необязательно)" value={last} onChange={setLast} wrapClassName={`${add.field} ${add.fieldGap}`} />
              <div className={add.noteWrap}>
                <Input label="Заметка" value={note} onChange={setNote} wrapClassName={add.field} />
                <span className={add.noteIcon}>
                  <TgIcon name="smile" color="var(--secondary-text-color)" />
                </span>
              </div>
            </div>
            <Row
              icon={<TgIcon name="unmute" size={24} color="var(--secondary-text-color)" />}
              label="Уведомления"
              translate={false}
              toggle
              checked={!muted}
              onClick={toggleNotifications}
            />
            <Row
              icon={<TgIcon name="gift" size={24} color="var(--secondary-text-color)" />}
              label="Предложить дату рождения"
              translate={false}
              onClick={() => setBirthdayOpen(true)}
            />
          </Section>

          {/* Секция 2: фото контакта (пояснение — footer секции, как caption в tweb) */}
          <Section footer="EditContact.PhotoHint">
            <Row
              icon={<TgIcon name="cameraadd" size={24} color="var(--primary-color)" />}
              label={hasPersonal ? `Изменить фото для ${displayFirst}` : `Установить фото для ${displayFirst}`}
              translate={false}
              accent
              onClick={() => { if (!busyPhoto) pickPhoto('set') }}
            />
            <Row
              icon={<TgIcon name="edit" size={24} color="var(--primary-color)" />}
              label={`Предложить фото ${displayFirst}`}
              translate={false}
              accent
              onClick={() => { if (!busyPhoto) pickPhoto('suggest') }}
            />
            {hasPersonal && (
              <Row
                icon={<TgIcon name="delete" size={24} color="#ff595a" />}
                label="Сбросить к исходному фото"
                translate={false}
                danger
                onClick={() => { if (!busyPhoto) void resetPhoto() }}
              />
            )}
          </Section>

          {/* Секция 3: удалить контакт */}
          <Section>
            <Row
              icon={<TgIcon name="delete" size={24} color="#ff595a" />}
              label="Удалить контакт"
              translate={false}
              danger
              onClick={() => void del()}
            />
          </Section>
        </div>

        {/* tweb не масштабирует кнопки по нажатию — отклик даёт ripple/фон
            (_button.scss:75-77), поэтому whileTap снят. */}
        <button
          onClick={submit}
          disabled={!canSave}
          className={add.fab}
          style={{ cursor: canSave ? 'pointer' : 'default', opacity: canSave ? 1 : 0.5 }}
        >
          <TgIcon name="check" size={28} />
        </button>
      </div>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFilePicked} />
      {cropFile && <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={(blob, w, h) => { setCropFile(null); void onCropConfirm(blob, w, h) }} />}
      <BirthdayModal open={birthdayOpen} initial={null} onClose={() => setBirthdayOpen(false)} onSave={() => setBirthdayOpen(false)} />
    </div>
  )
}
