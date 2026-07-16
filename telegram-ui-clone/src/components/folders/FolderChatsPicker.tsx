// Выбор чатов/типов чатов для папки — порт tweb includedChats.tsx:
// сверху секция «Типы чатов» (категории с чекбоксами), ниже — все чаты
// с чекбоксами; подтверждение — галка в хедере.
import { useState } from 'react'
import IconButton from '../../shared/ui/IconButton'
import Avatar from '../../shared/ui/Avatar'
import TgIcon from '../TgIcon'
import { useAvatarSrc } from '../useAvatarSrc'
import type { Chat } from '../../data'
import { SettingsScreen, Section, Row } from '../settings/kit'

export interface PickerFlags {
  contacts: boolean
  nonContacts: boolean
  groups: boolean
  broadcasts: boolean
  excludeMuted: boolean
  excludeRead: boolean
}

// Категории типов (tweb folder-categories): для include и exclude — свои наборы.
const INCLUDE_TYPES: { key: keyof PickerFlags; icon: string; label: string }[] = [
  { key: 'contacts', icon: 'newprivate', label: 'Contacts' },
  { key: 'nonContacts', icon: 'noncontacts', label: 'Non-Contacts' },
  { key: 'groups', icon: 'group', label: 'Groups' },
  { key: 'broadcasts', icon: 'channel', label: 'Channels' },
]
const EXCLUDE_TYPES: { key: keyof PickerFlags; icon: string; label: string }[] = [
  { key: 'excludeMuted', icon: 'mute', label: 'Muted' },
  { key: 'excludeRead', icon: 'readchats', label: 'Read' },
]

function ChatPickRow({ chat, selected, onToggle }: { chat: Chat; selected: boolean; onToggle: () => void }) {
  const src = useAvatarSrc(chat.avatarUrl)
  return (
    <Row
      icon={<Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} src={src} size={32} />}
      label={chat.name}
      translate={false}
      selected={selected}
      onClick={onToggle}
    />
  )
}

export default function FolderChatsPicker({
  mode,
  chats,
  initialChats,
  initialFlags,
  onConfirm,
  onClose,
}: {
  mode: 'include' | 'exclude'
  chats: Chat[]
  initialChats: number[]
  initialFlags: PickerFlags
  onConfirm: (chatIds: number[], flags: PickerFlags) => void
  onClose: () => void
}) {
  const [flags, setFlags] = useState<PickerFlags>(initialFlags)
  const [ids, setIds] = useState<Set<number>>(new Set(initialChats))

  const types = mode === 'include' ? INCLUDE_TYPES : EXCLUDE_TYPES
  const toggleFlag = (key: keyof PickerFlags) => setFlags((f) => ({ ...f, [key]: !f[key] }))
  const toggleChat = (id: number) => {
    setIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const pickable = chats.filter((c) => Number.isFinite(Number(c.id)))

  return (
    <SettingsScreen
      title={mode === 'include' ? 'Included Chats' : 'Excluded Chats'}
      onBack={onClose}
      zIndex={80}
      headerRight={
        <IconButton onClick={() => onConfirm([...ids], flags)} color="var(--tg-accent)">
          <TgIcon name="check" />
        </IconButton>
      }
    >
      <Section caption="Chat types">
        {types.map((tp) => (
          <Row
            key={tp.key}
            icon={<TgIcon name={tp.icon as never} size={24} color="var(--tg-accent)" />}
            label={tp.label}
            selected={flags[tp.key]}
            onClick={() => toggleFlag(tp.key)}
          />
        ))}
      </Section>
      <Section caption="Chats">
        {pickable.map((c) => (
          <ChatPickRow key={c.id} chat={c} selected={ids.has(Number(c.id))} onToggle={() => toggleChat(Number(c.id))} />
        ))}
      </Section>
    </SettingsScreen>
  )
}
