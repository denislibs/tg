// Редактор папки — порт tweb editFolder.tsx: анимация Folders_2 (86×86),
// caption, имя папки, «Включённые чаты» (Добавить чаты + типы), «Исключённые
// чаты» (Убрать чаты + Без звука/Прочитанные), галка-подтверждение в хедере.
import { useState } from 'react'
import IconButton from '../../shared/ui/IconButton'
import Avatar from '../../shared/ui/Avatar'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import LottieSticker from '../LottieSticker'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useAvatarSrc } from '../useAvatarSrc'
import { useFoldersStore } from '../../stores/foldersStore'
import type { Folder, FolderInput } from '../../core/managers/foldersManager'
import type { Chat } from '../../data'
import { SettingsScreen, Section, Row } from '../settings/kit'
import FolderChatsPicker, { type PickerFlags } from './FolderChatsPicker'
import s from './FolderEditor.module.scss'

const PREVIEW_LIMIT = 4 // tweb: до 4 строк + «Show N more»

const TYPE_LABELS: Record<string, { icon: string; label: string }> = {
  contacts: { icon: 'newprivate', label: 'Contacts' },
  nonContacts: { icon: 'noncontacts', label: 'Non-Contacts' },
  groups: { icon: 'group', label: 'Groups' },
  broadcasts: { icon: 'channel', label: 'Channels' },
  excludeMuted: { icon: 'mute', label: 'Muted' },
  excludeRead: { icon: 'readchats', label: 'Read' },
}

function ChatPreviewRow({ chat }: { chat: Chat }) {
  const src = useAvatarSrc(chat.avatarUrl)
  return (
    <Row
      icon={<Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} src={src} size={32} />}
      label={chat.name}
      translate={false}
    />
  )
}

// Превью выбранного: строки категорий + до PREVIEW_LIMIT чатов + «Показать ещё».
function SelectedPreview({ flagKeys, chatIds, chats }: { flagKeys: string[]; chatIds: number[]; chats: Chat[] }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const selectedChats = chatIds
    .map((id) => chats.find((c) => Number(c.id) === id))
    .filter((c): c is Chat => !!c)
  const shown = expanded ? selectedChats : selectedChats.slice(0, PREVIEW_LIMIT)
  const hidden = selectedChats.length - shown.length
  return (
    <>
      {flagKeys.map((k) => (
        <Row key={k} icon={<TgIcon name={TYPE_LABELS[k].icon as never} size={24} color="var(--tg-accent)" />} label={TYPE_LABELS[k].label} />
      ))}
      {shown.map((c) => (
        <ChatPreviewRow key={c.id} chat={c} />
      ))}
      {hidden > 0 && (
        <Row icon={<TgIcon name="down" size={24} color="var(--tg-accent)" />} label={`${t('Show more')} (${hidden})`} translate={false} accent onClick={() => setExpanded(true)} />
      )}
    </>
  )
}

export default function FolderEditor({
  folder,
  chats,
  onClose,
}: {
  folder: Folder | null // null = новая папка
  chats: Chat[]
  onClose: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const upsert = useFoldersStore((st) => st.upsert)
  const [title, setTitle] = useState(folder?.title ?? '')
  const [flags, setFlags] = useState<PickerFlags>({
    contacts: !!folder?.contacts,
    nonContacts: !!folder?.nonContacts,
    groups: !!folder?.groups,
    broadcasts: !!folder?.broadcasts,
    excludeMuted: !!folder?.excludeMuted,
    excludeRead: !!folder?.excludeRead,
  })
  const [includeChats, setIncludeChats] = useState<number[]>(folder?.includeChats ?? [])
  const [excludeChats, setExcludeChats] = useState<number[]>(folder?.excludeChats ?? [])
  const [picker, setPicker] = useState<'include' | 'exclude' | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const includeFlagKeys = (['contacts', 'nonContacts', 'groups', 'broadcasts'] as const).filter((k) => flags[k])
  const excludeFlagKeys = (['excludeMuted', 'excludeRead'] as const).filter((k) => flags[k])
  const hasIncludes = includeFlagKeys.length > 0 || includeChats.length > 0

  const save = () => {
    const name = title.trim()
    if (!name) {
      setError(t('Folder name'))
      return
    }
    if (!hasIncludes) {
      setError(t('Please choose at least one chat for this folder.'))
      return
    }
    setSaving(true)
    const input: FolderInput = {
      title: name,
      contacts: flags.contacts,
      nonContacts: flags.nonContacts,
      groups: flags.groups,
      broadcasts: flags.broadcasts,
      excludeMuted: flags.excludeMuted,
      excludeRead: flags.excludeRead,
      includeChats,
      excludeChats,
    }
    const req = folder ? managers.folders.update(folder.id, input) : managers.folders.create(input)
    req
      .then((saved) => {
        upsert(saved)
        onClose()
      })
      .catch(() => {
        setError(t('Something went wrong'))
        setSaving(false)
      })
  }

  return (
    <SettingsScreen
      title={folder ? 'Edit Folder' : 'New Folder'}
      onBack={onClose}
      zIndex={70}
      headerRight={
        <IconButton onClick={saving ? undefined : save} color="var(--tg-accent)">
          <TgIcon name="check" />
        </IconButton>
      }
    >
      <LottieSticker name="Folders_2" size={86} />
      <Text size={14} color="var(--tg-textSecondary)" className={s.caption}>
        {t('Choose chats and types of chats that will appear and never appear in this folder.')}
      </Text>

      <Section>
        <div className={s.nameWrap}>
          <input
            className={s.nameInput}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setError('')
            }}
            placeholder={t('Folder name')}
            maxLength={24}
          />
        </div>
        {error && (
          <Text size={13.5} color="#ff595a" className={s.error}>
            {error}
          </Text>
        )}
      </Section>

      <Section
        caption="Included Chats"
        footer="Choose chats or types of chats that will appear in this folder."
      >
        <Row
          icon={<TgIcon name="add" size={24} color="var(--tg-accent)" />}
          label="Add Chats"
          accent
          onClick={() => setPicker('include')}
        />
        <SelectedPreview flagKeys={includeFlagKeys} chatIds={includeChats} chats={chats} />
      </Section>

      <Section
        caption="Excluded Chats"
        footer="Choose chats or types of chats that will not appear in this folder."
      >
        <Row
          icon={<TgIcon name="minus" size={24} color="var(--tg-accent)" />}
          label="Remove Chats"
          accent
          onClick={() => setPicker('exclude')}
        />
        <SelectedPreview flagKeys={excludeFlagKeys} chatIds={excludeChats} chats={chats} />
      </Section>

      {picker && (
        <FolderChatsPicker
          mode={picker}
          chats={chats}
          initialChats={picker === 'include' ? includeChats : excludeChats}
          initialFlags={flags}
          onClose={() => setPicker(null)}
          onConfirm={(ids, f) => {
            setFlags(f)
            if (picker === 'include') {
              setIncludeChats(ids)
              // чат не может быть одновременно включён и исключён (tweb cross-remove)
              setExcludeChats((prev) => prev.filter((id) => !ids.includes(id)))
            } else {
              setExcludeChats(ids)
              setIncludeChats((prev) => prev.filter((id) => !ids.includes(id)))
            }
            setError('')
            setPicker(null)
          }}
        />
      )}
    </SettingsScreen>
  )
}
