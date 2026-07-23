// src/components/EditContactView.tsx
// Экран «Изменить контакт» (порт tweb editContact.tsx, ветка существующего
// контакта). Док-панель рядом с чатом — то же поведение, что у AddContactView и
// UserInfoPanel: 404px-колонка на широких экранах, оверлей на узких. Внутри —
// крупный аватар + исходное имя, карточка с полями имя/фамилия/заметка, карточка
// уведомления + «предложить дату рождения», карточка «фото контакта» (личное
// фото / предложить фото / сброс) и красное «Удалить контакт». Сохранение —
// плавающая ✓ (contacts.add — upsert по contact_id). Инфо-панель остаётся только
// для просмотра: все редактируемые поля живут здесь.
import { useEffect, useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import Input from '../shared/ui/Input'
import { motion } from 'framer-motion'
import { EASE, DUR } from '../motion'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import { Section, Row } from './settings/kit'
import AvatarCropper from './settings/AvatarCropper'
import BirthdayModal from './settings/BirthdayModal'
import { useAvatarSrc } from './useAvatarSrc'
import { useManagers } from '../core/hooks/useManagers'
import { useChatsStore, loadChats } from '../stores/chatsStore'
import type { Chat } from '../data'
import add from './AddContactView.module.scss'
import useMediaQuery from '../shared/lib/useMediaQuery'

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

// Целевое действие для выбранного фото: личное фото у себя или предложение контакту.
type PhotoMode = 'set' | 'suggest'

export default function EditContactView({
  chat,
  onClose,
}: {
  chat: Chat
  onClose: () => void
}) {
  const managers = useManagers()
  const narrow = useMediaQuery('(max-width:900px)')
  const peerId = chat.peerId ?? null

  const seed = splitName(chat.name)
  const [first, setFirst] = useState(seed.first)
  const [last, setLast] = useState(seed.last)
  const [note, setNote] = useState('')
  const [hasPersonal, setHasPersonal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [birthdayOpen, setBirthdayOpen] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [busyPhoto, setBusyPhoto] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const modeRef = useRef<PhotoMode>('set')

  const avatarSrc = useAvatarSrc(chat.avatarUrl)
  const displayFirst = first.trim() || chat.name

  // Уведомления = per-chat mute (как в UserInfoPanel: checked = !muted).
  const numericChatId = Number(chat.id)
  const setDialogMuted = useChatsStore((st) => st.setDialogMuted)
  const dialogMuted = useChatsStore((st) => st.dialogs.find((d) => d.chatId === numericChatId)?.muted)
  const muted = dialogMuted ?? !!chat.muted
  const toggleNotifications = () => {
    const next = !muted
    setDialogMuted(numericChatId, next)
    void managers.groups.setMute(numericChatId, next).catch(() => setDialogMuted(numericChatId, !next))
  }

  // Прегружаем сохранённое имя/фамилию/заметку контакта + признак личного фото.
  useEffect(() => {
    if (peerId == null) return
    let alive = true
    void managers.contacts.list().then((list) => {
      const c = list.find((x) => x.userId === peerId)
      if (!alive || !c) return
      setFirst(c.firstName || seed.first)
      setLast(c.lastName)
      setNote(c.note)
      setHasPersonal(c.hasCustomPhoto)
    }).catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId, managers])

  const canSave = peerId != null && first.trim().length > 0 && !saving
  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await managers.contacts.add({
        contactId: peerId!,
        firstName: first.trim(),
        lastName: last.trim(),
        note: note.trim(),
      })
      onClose()
    } catch {
      setSaving(false)
    }
  }

  const pickPhoto = (mode: PhotoMode) => {
    modeRef.current = mode
    fileRef.current?.click()
  }
  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) setCropFile(f)
  }
  const onCropConfirm = async (blob: Blob, width: number, height: number) => {
    setCropFile(null)
    if (peerId == null) return
    setBusyPhoto(true)
    try {
      const bytes = await blob.arrayBuffer()
      const mediaId = await managers.media.upload({ bytes, mime: 'image/jpeg', size: blob.size, width, height })
      if (modeRef.current === 'set') {
        await managers.contacts.setPhoto(peerId, mediaId)
        setHasPersonal(true)
        await loadChats(managers) // обновить аватар в списке диалогов и шапке чата
      } else {
        await managers.contacts.suggestPhoto(peerId, mediaId)
      }
    } finally {
      setBusyPhoto(false)
    }
  }
  const resetPhoto = async () => {
    if (peerId == null) return
    setBusyPhoto(true)
    try {
      await managers.contacts.clearPhoto(peerId)
      setHasPersonal(false)
      await loadChats(managers)
    } finally {
      setBusyPhoto(false)
    }
  }

  const del = async () => {
    if (peerId == null) return
    await managers.contacts.del(peerId)
    await loadChats(managers)
    onClose()
  }

  return (
    <motion.div
      initial={narrow ? { opacity: 0 } : { width: 0, opacity: 0 }}
      animate={narrow ? { opacity: 1 } : { width: 404, opacity: 1 }}
      exit={narrow ? { opacity: 0 } : { width: 0, opacity: 0 }}
      transition={{ duration: DUR.in, ease: EASE }}
      style={
        narrow
          ? { position: 'fixed', inset: 0, zIndex: 1900 }
          : {
              overflow: 'hidden',
              flexShrink: 0,
              position: 'sticky',
              top: '16px',
              alignSelf: 'flex-start',
              height: 'calc(100vh - 32px)',
              zIndex: 15,
            }
      }
    >
      {narrow && <div className={add.backdrop} onClick={onClose} />}
      <motion.div
        {...(narrow
          ? { initial: { x: '100%' }, animate: { x: '0%' }, transition: { duration: DUR.in, ease: EASE } }
          : {})}
        className={`${add.panel} ${narrow ? add.panelNarrow : add.panelWide}`}
      >
        <div className={add.header}>
          <IconButton onClick={onClose} color="var(--tg-textSecondary)">
            <TgIcon name="back" />
          </IconButton>
          <Text size={19} weight={600} color="var(--tg-textPrimary)">Изменить контакт</Text>
        </div>

        <div className={add.body}>
          {/* Аватар + исходное имя */}
          <div className={add.avatarBlock}>
            <Avatar background={chat.avatar} text={chat.avatarText ?? chat.name[0]} src={avatarSrc} size="profile" />
            <Text size={22} weight={600} color="var(--tg-textPrimary)" style={{ marginTop: '16px' }}>{chat.name}</Text>
            <Text size={14} color="var(--tg-textSecondary)" style={{ marginTop: '2px' }}>исходное имя</Text>
          </div>

          {/* Секция 1 (как в tweb editContact): поля + уведомления + дата рождения */}
          <Section>
            <Input label="Имя (обязательно)" value={first} onChange={setFirst} autoFocus wrapClassName={`${add.field} ${add.fieldGap}`} />
            <Input label="Фамилия (необязательно)" value={last} onChange={setLast} wrapClassName={`${add.field} ${add.fieldGap}`} />
            <div className={add.noteWrap}>
              <Input label="Заметка" value={note} onChange={setNote} wrapClassName={add.field} />
              <span className={add.noteIcon}>
                <TgIcon name="smile" color="var(--tg-textFaint)" />
              </span>
            </div>
            <Row
              icon={<TgIcon name="unmute" size={24} color="var(--tg-textSecondary)" />}
              label="Уведомления"
              translate={false}
              toggle
              checked={!muted}
              onClick={toggleNotifications}
            />
            <Row
              icon={<TgIcon name="gift" size={24} color="var(--tg-textSecondary)" />}
              label="Предложить дату рождения"
              translate={false}
              onClick={() => setBirthdayOpen(true)}
            />
          </Section>

          {/* Секция 2: фото контакта (пояснение — footer секции, как caption в tweb) */}
          <Section footer="Вы можете предложить контакту установить новую фотографию профиля — или изменить его фотографию только у себя.">
            <Row
              icon={<TgIcon name="cameraadd" size={24} color="var(--tg-accent)" />}
              label={hasPersonal ? `Изменить фото для ${displayFirst}` : `Установить фото для ${displayFirst}`}
              translate={false}
              accent
              onClick={() => { if (!busyPhoto) pickPhoto('set') }}
            />
            <Row
              icon={<TgIcon name="edit" size={24} color="var(--tg-accent)" />}
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

        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={submit}
          disabled={!canSave}
          className={add.fab}
          style={{ cursor: canSave ? 'pointer' : 'default', opacity: canSave ? 1 : 0.5 }}
        >
          <TgIcon name="check" size={28} />
        </motion.button>
      </motion.div>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFilePicked} />
      {cropFile && <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={onCropConfirm} />}
      <BirthdayModal open={birthdayOpen} initial={null} onClose={() => setBirthdayOpen(false)} onSave={() => setBirthdayOpen(false)} />
    </motion.div>
  )
}
