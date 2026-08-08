import { useMemo, useRef, useState } from 'react'
// Presentational chat dialogs/popups extracted from ConversationView: delete
// confirm, forward target picker, "seen by" popup, add-member picker, and the
// discard-voice confirm. Each is dumb — it self-sources i18n + motion constants
// and emits its actions via callbacks; the parent owns the state.
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { EASE } from '../../motion'
import { useT, useLang } from '../../i18n'
import Avatar from '../../shared/ui/Avatar'
import Popup from '../../shared/ui/Popup'
import ConfirmPopup from '../../shared/ui/ConfirmPopup'
import { peerColor } from '../peerColor'
import { useAvatarSrc } from '../useAvatarSrc'
import { dialogToChat } from '../../core/dialogToChat'
import { matchesFolder } from '../../core/folderFilter'
import { lastSeenLabel } from '../../core/presence'
import { useChatsStore } from '../../stores/chatsStore'
import { useFoldersStore, ALL_FOLDER_ID } from '../../stores/foldersStore'
import FolderTabs from '../FolderTabs'
import type { Chat } from '../../data'
import type { Dialog } from '../../core/models'
import s from './ChatDialogs.module.scss'

// Only the fields the add-member list renders (Dialog.peer is narrower than the
// full Peer type, so we keep this minimal and structurally compatible).

const EASE_STD = EASE

// Delete confirmation — порт tweb PopupDeleteMessages (popups/deleteMessages.ts:84-160):
// заголовок «Delete message»/«Delete N messages», описание, в личке — чекбокс
// «Also delete for <имя>», в группе/канале с revoke — «Delete for all»; ОДНА
// danger-кнопка DELETE (+ авто-Cancel). Выбор чекбокса решает revoke —
// колбэки onDeleteForEveryone/onDeleteForMe сохранены для внешних потребителей.
export function DeleteMessageDialog({ canRevoke, count = 1, chatType, peerFirstName, onDeleteForEveryone, onDeleteForMe, onClose }: {
  canRevoke: boolean
  /** число удаляемых сообщений (bulk-выбор) */
  count?: number
  /** тип чата — в личке чекбокс подписывается именем собеседника */
  chatType?: Dialog['type']
  /** first name собеседника личного чата (tweb wrapPeerTitle onlyFirstName) */
  peerFirstName?: string
  onDeleteForEveryone: () => void
  onDeleteForMe: () => void
  onClose: () => void
}) {
  const t = useT()
  const single = count <= 1
  return (
    <ConfirmPopup
      title={single ? t('Delete message') : t('Delete %d messages').replace('%d', String(count))}
      description={single ? t('Are you sure you want to delete this message?') : t('Are you sure you want to delete these messages?')}
      checkboxes={canRevoke ? [{
        text: chatType === 'private' && peerFirstName
          ? `${t('Also delete for')} ${peerFirstName}`
          : t('Delete for all'),
      }] : undefined}
      buttons={[{
        text: t('Delete'),
        danger: true,
        onClick: (checked) => { if (canRevoke && checked[0]) onDeleteForEveryone(); else onDeleteForMe() },
      }]}
      onClose={onClose}
    />
  )
}

// Подпись строки в пикере: private → presence/бот, группа/канал/избранное — метка.
function shareSub(chat: Chat, presence: Record<number, { online: boolean; lastSeen: number }>, lang: string, t: (s: string) => string): string {
  if (chat.type === 'saved') return t('forward here to save')
  if (chat.type === 'channel') return t('Channel')
  if (chat.type === 'group') return t('Group')
  if (chat.isBot) return t('bot')
  const p = chat.peerId != null ? presence[chat.peerId] : undefined
  if (p?.online) return t('online')
  return lastSeenLabel(p?.lastSeen ?? 0, lang)
}

// Строка списка «Поделиться»: аватар + имя/подпись, выделение галочкой.
function ShareRow({ chat, sub, selected, onToggle }: { chat: Chat; sub: string; selected: boolean; onToggle: () => void }) {
  const src = useAvatarSrc(chat.avatarUrl)
  return (
    <div className={classNames(s.shareRow, selected ? s.shareRowSel : '')} onClick={onToggle}>
      <div className={s.shareAvatar}>
        <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} src={src} size="md" />
        {selected && <span className={s.shareCheck}><TgIcon name="check" size={13} color="#fff" /></span>}
      </div>
      <div className={s.pickerBody}>
        <Text noWrap size={15.5} weight={500} color="var(--primary-text-color)">{chat.name}</Text>
        <Text noWrap size={13.5} color="var(--secondary-text-color)">{sub}</Text>
      </div>
    </div>
  )
}

// Недавний контакт в горизонтальном ряду: круглый аватар + имя, галочка при выборе.
function RecentChip({ chat, selected, onToggle }: { chat: Chat; selected: boolean; onToggle: () => void }) {
  const src = useAvatarSrc(chat.avatarUrl)
  return (
    <div className={s.recent} onClick={onToggle}>
      <div className={classNames(s.recentAvatar, selected ? s.recentAvatarSel : '')}>
        <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} src={src} size={54} />
        {selected && <span className={s.shareCheck}><TgIcon name="check" size={13} color="#fff" /></span>}
      </div>
      <Text noWrap size={12.5} color="var(--primary-text-color)" className={s.recentName}>{chat.name}</Text>
    </div>
  )
}

// Forward target picker («Поделиться»): порт tweb popupForward — поиск, ряд
// недавних, табы папок (липкие при скролле) и список чатов с аватарами/подписями.
// Мультивыбор; аккордная кнопка «Переслать (N)» шлёт во все выбранные чаты сразу.
export function ForwardPicker({ dialogs, onPick, onClose }: {
  dialogs: Dialog[]
  // Один чат → tweb-флоу: открыть чат и показать плашку форварда в композере
  // (опции show/hide sender/caption живут в меню плашки). Несколько → отправить сразу.
  onPick: (chatIds: number[]) => void
  onClose: () => void
}) {
  const t = useT()
  const [lang] = useLang()
  const meId = useChatsStore((st) => st.meId)
  const presence = useChatsStore((st) => st.presence)
  const folders = useFoldersStore((st) => st.folders)
  const contactIds = useFoldersStore((st) => st.contactIds)
  const [q, setQ] = useState('')
  const [folderId, setFolderId] = useState(ALL_FOLDER_ID)
  // exit-анимация: закрытие/выбор сначала гасят open; колбэк владельцу (который
  // размонтирует пикер) — только из onExitComplete, когда карточка уехала.
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const confirmed = useRef<number[] | null>(null)

  const toggle = (chatId: number) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(chatId)) next.delete(chatId); else next.add(chatId)
    return next
  })
  const confirm = () => {
    if (selected.size) { confirmed.current = [...selected]; setOpen(false) }
  }

  // Секретные чаты — не цель пересылки (E2E). Маппим в Chat для аватаров/имён.
  const chats = useMemo<Chat[]>(
    () => dialogs.filter((d) => d.type !== 'secret').map((d) => dialogToChat(d, meId)),
    [dialogs, meId],
  )
  const query = q.trim().toLowerCase()
  const activeFolder = folderId !== ALL_FOLDER_ID ? folders.find((f) => f.id === folderId) : undefined
  const list = useMemo(() => {
    let out = chats
    if (activeFolder) out = out.filter((c) => matchesFolder(c, activeFolder, contactIds))
    if (query) out = out.filter((c) => c.name.toLowerCase().includes(query))
    return out
  }, [chats, activeFolder, contactIds, query])
  // Недавние — первые 8 чатов (лента отсортирована по свежести); прячем при поиске.
  const recents = query ? [] : chats.slice(0, 8)
  const searching = query.length > 0

  return (
    <Popup
      open={open}
      title={t('Share with')}
      onClose={() => setOpen(false)}
      onExitComplete={() => { const c = confirmed.current; if (c) onPick(c); else onClose() }}
      action={selected.size ? { label: `${t('Forward')} (${selected.size})`, onClick: confirm } : undefined}
      width={460}
    >
      {/* поиск */}
      <div className={s.pickerSearch}>
        <TgIcon name="search" size={20} color="var(--secondary-text-color)" />
        <input
          className={s.pickerSearchInput}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('Search')}
        />
      </div>

      {/* ряд недавних */}
      {recents.length > 0 && (
        <div className={s.recents}>
          {recents.map((c) => (
            <RecentChip key={c.id} chat={c} selected={selected.has(Number(c.id))} onToggle={() => toggle(Number(c.id))} />
          ))}
        </div>
      )}

      {/* табы папок — липкие при скролле */}
      {!searching && folders.length > 0 && (
        <div className={s.shareTabs}>
          <FolderTabs value={folderId} onChange={setFolderId} folders={folders} />
        </div>
      )}

      {/* список чатов */}
      <div className={s.pickerList}>
        {list.map((c) => (
          <ShareRow
            key={c.id}
            chat={c}
            sub={shareSub(c, presence, lang, t)}
            selected={selected.has(Number(c.id))}
            onToggle={() => toggle(Number(c.id))}
          />
        ))}
      </div>
    </Popup>
  )
}

// Пикер контакта для attach-меню: список собеседников приватных чатов;
// выбор — отправить сообщение-контакт (та же карточка, что и ForwardPicker).
export function ContactPicker({ dialogs, onPick, onClose }: {
  dialogs: Dialog[]
  onPick: (userId: number, name: string) => void
  onClose: () => void
}) {
  const t = useT()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(true)
  const picked = useRef<{ userId: number; name: string } | null>(null)
  const pick = (userId: number, name: string) => { picked.current = { userId, name }; setOpen(false) }
  const query = q.trim().toLowerCase()
  const rows = dialogs
    .filter((d) => d.type === 'private' && d.peer)
    .map((d) => ({ userId: d.peer!.id, name: d.peer!.displayName || `#${d.peer!.id}` }))
    .filter((r) => !query || r.name.toLowerCase().includes(query))
  return (
    <Popup
      open={open}
      title={t('Contact')}
      onClose={() => setOpen(false)}
      onExitComplete={() => { const p = picked.current; if (p) onPick(p.userId, p.name); else onClose() }}
      width={440}
    >
      <div className={s.pickerSearch}>
        <TgIcon name="search" size={20} color="var(--secondary-text-color)" />
        <input
          className={s.pickerSearchInput}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('Search')}
        />
      </div>
      <div className={s.pickerList}>
        {rows.map((r) => (
          <div key={r.userId} className={s.listRow} onClick={() => pick(r.userId, r.name)}>
            <Avatar background={peerColor(r.name)} text={r.name[0] ?? '?'} size="md" />
            <div className={s.pickerBody}>
              <Text noWrap size={15.5} weight={500} color="var(--primary-text-color)">{r.name}</Text>
            </div>
          </div>
        ))}
      </div>
    </Popup>
  )
}

// Single-select chat picker (tweb ReplyToAnotherChat): выбор ОДНОГО чата, куда
// перенести ответ. Та же карточка с поиском, что ForwardPicker/ContactPicker.
export function ChatPicker({ dialogs, title, onPick, onClose }: {
  dialogs: Dialog[]
  title: string
  onPick: (chatId: number) => void
  onClose: () => void
}) {
  const t = useT()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(true)
  const picked = useRef<number | null>(null)
  const pick = (chatId: number) => { picked.current = chatId; setOpen(false) }
  const query = q.trim().toLowerCase()
  const rows = dialogs
    // Секретный чат не может быть целью пересылки/ответа (E2E: сервер отправит plaintext).
    .filter((d) => d.type !== 'secret')
    .map((d) => ({
      chatId: d.chatId,
      title: d.title || d.peer?.displayName || `Чат ${d.chatId}`,
      sub: d.type === 'channel' ? t('Channel') : d.type === 'group' ? t('Group') : t('Private Chat'),
    }))
    .filter((r) => !query || r.title.toLowerCase().includes(query))
  return (
    <Popup
      open={open}
      title={title}
      onClose={() => setOpen(false)}
      onExitComplete={() => { const c = picked.current; if (c != null) onPick(c); else onClose() }}
      width={440}
    >
      <div className={s.pickerSearch}>
        <TgIcon name="search" size={20} color="var(--secondary-text-color)" />
        <input
          className={s.pickerSearchInput}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('Search')}
        />
      </div>
      <div className={s.pickerList}>
        {rows.map((r) => (
          <div key={r.chatId} className={s.listRow} onClick={() => pick(r.chatId)}>
            <Avatar background={peerColor(r.title)} text={r.title[0] ?? '?'} size="md" />
            <div className={s.pickerBody}>
              <Text noWrap size={15.5} weight={500} color="var(--primary-text-color)">{r.title}</Text>
              <Text noWrap size={13.5} color="var(--secondary-text-color)">{r.sub}</Text>
            </div>
          </div>
        ))}
      </div>
    </Popup>
  )
}

// "Seen by" popup anchored at (x, y).
export function ViewersPopup({ x, y, names, onClose }: {
  x: number
  y: number
  names: string[]
  onClose: () => void
}) {
  const t = useT()
  return createPortal(
    <div className={s.overlayBare} onClick={onClose}>
      <motion.div
        className={classNames(s.card, s.viewers)}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: EASE_STD }}
        style={{ top: y, left: x }}
      >
        <Text size={13} color="var(--secondary-text-color)" className={s.viewersTitle}>
          {names.length ? t('Seen by') : t('No views yet')}
        </Text>
        {names.map((n, i) => (
          <div key={i} className={s.viewersRow}>
            <Avatar background={peerColor(n)} text={n[0] ?? '?'} size={28} />
            <Text noWrap size={14.5} color="var(--primary-text-color)">{n}</Text>
          </div>
        ))}
      </motion.div>
    </div>,
    document.body,
  )
}
// Кто отреагировал: как ViewersPopup, но в каждой строке — эмодзи реакции справа.
export function ReactedUsersPopup({ x, y, rows, onClose }: {
  x: number
  y: number
  rows: { name: string; avatarUrl: string; emoji: string }[]
  onClose: () => void
}) {
  const t = useT()
  return createPortal(
    <div className={s.overlayBare} onClick={onClose}>
      <motion.div
        className={classNames(s.card, s.viewers)}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: EASE_STD }}
        style={{ top: y, left: x }}
      >
        <Text size={13} color="var(--secondary-text-color)" className={s.viewersTitle}>
          {rows.length ? t('Reactions') : t('No reactions yet')}
        </Text>
        {rows.map((r, i) => (
          <div key={i} className={s.viewersRow}>
            <Avatar background={peerColor(r.name)} text={r.name[0] ?? '?'} src={r.avatarUrl || undefined} size={28} />
            <Text noWrap size={14.5} color="var(--primary-text-color)" style={{ flex: 1 }}>{r.name}</Text>
            <span style={{ fontSize: 18 }}>{r.emoji}</span>
          </div>
        ))}
      </motion.div>
    </div>,
    document.body,
  )
}
// Конфирм сброса записи голосового — tweb-конфирм (PopupPeer): DISCARD danger + CANCEL.
export function DiscardVoiceDialog({ onCancel, onDiscard }: { onCancel: () => void; onDiscard: () => void }) {
  const t = useT()
  return (
    <ConfirmPopup
      title={t('Discard voice message?')}
      description={t('Are you sure you want to discard this voice message?')}
      buttons={[{ text: t('Discard'), danger: true, onClick: onDiscard }]}
      onClose={onCancel}
    />
  )
}
