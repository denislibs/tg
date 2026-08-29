import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
// Presentational chat dialogs/popups extracted from Chat: delete
// confirm, forward target picker, the reacted/seen list. Each is dumb — it
// self-sources i18n + motion constants and emits its actions via callbacks;
// the parent owns the state. Discard-voice confirm переехал на портированный
// `confirmationPopup` (задача 3 плана solid-wave-1) и вызывается напрямую из
// `Composer.tsx` — самостоятельного React-компонента под него больше нет.
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import { createPortal } from 'react-dom'
import TgIcon from '../TgIcon'
import { useT, useLang } from '../../i18n'
import Avatar from '../../shared/ui/Avatar'
import Popup from '../../shared/ui/Popup'
import PeerSelector from '../../shared/ui/PeerSelector'
import Checkbox from '../../shared/ui/Checkbox'
import { usePopupTransition } from '../settings/kit'
import { useNavLayer } from '../../core/hooks/useNavLayer'
import { peerColor } from '../peerColor'
import UserAvatar from '../UserAvatar'
import { useMediaUrl } from '../../core/hooks/useMediaUrl'
import { dialogChatType, dialogToChat } from '../../core/dialogToChat'
import { chatMatchesFolder } from '../../core/folderFilter'
import { lastSeenLabel } from '../../core/presence'
import { isUserStatusOnline, userStatusWasOnline, type UserStatus } from '../../core/peers/peer'
import { useChatsStore } from '../../stores/chatsStore'
import { cachedChat, peerTitle } from '../../core/peerCache'
import { isUser } from '../../core/peers/peerId'
import { useFolders, useFoldersStore } from '../../stores/foldersStore'
import { ALL_FOLDER_ID } from '../../core/folderIds'
import FolderTabs from '../FolderTabs'
import type { Chat, ChatType } from '../../data'
import type { Dialog } from '../../core/models'
import s from './ChatDialogs.module.scss'

// Delete confirmation — порт tweb PopupDeleteMessages (popups/deleteMessages.ts:84-160):
// заголовок «Delete message»/«Delete N messages», описание, в личке — чекбокс
// «Also delete for <имя>», в группе с revoke — «Delete for all members»; в канале
// чекбокса НЕТ — удаление всегда для всех (tweb overrideRevoke=true). ОДНА
// danger-кнопка DELETE (+ авто-Cancel). Выбор чекбокса решает revoke —
// колбэки onDeleteForEveryone/onDeleteForMe сохранены для внешних потребителей.
//
// ОСТАТОК (задача 3 плана solid-wave-1, назван, а не забыт — DoD 13): это
// сценарий с ЧЕКБОКСОМ, которого нет ни у `confirmationPopup`, ни у
// портированного `PopupPeer` (см. докблок «раунд правок 2» в
// `components/popups/popupPeer.ts`) — реальный tweb-эквивалент этого попапа,
// `PopupDeleteMessages` (`deleteMessages.ts`), САМ по себе не `confirmationPopup`
// и не просто чекбокс на `PopupPeer`: это отдельный класс с бизнес-логикой
// (проверка прав админа мегагруппы, вычисление `canRevoke` по правам/типу
// сообщения, разветвление на 6+ описаний) — порт которой не входит в объём
// этой задачи («Интерфейсы: потребляет confirmationPopup»). Компонент остаётся
// САМОСТОЯТЕЛЬНОЙ React-реализацией разметки `shared/ui/ConfirmPopup` (снесённого
// этой же задачей) — не общим компонентом, а локальной копией ровно того, что
// нужно этому единственному месту, поэтому снос `ConfirmPopup` его не задевает.
// Порт чекбоксов в `PopupPeer` (peer.ts:22-30, :96-124) — самостоятельная задача.
export function DeleteMessageDialog({ canRevoke, count = 1, chatType, peerFirstName, avatar, onDeleteForEveryone, onDeleteForMe, onClose }: {
  canRevoke: boolean
  /** число удаляемых сообщений (bulk-выбор) */
  count?: number
  /** тип чата — в личке чекбокс подписывается именем собеседника */
  chatType?: ChatType
  /** first name собеседника личного чата (tweb wrapPeerTitle onlyFirstName) */
  peerFirstName?: string
  /** аватар 32px слева от заголовка (tweb PopupPeer peerId → avatarNew 32) */
  avatar?: ReactNode
  onDeleteForEveryone: () => void
  onDeleteForMe: () => void
  onClose: () => void
}) {
  const t = useT()
  const single = count <= 1
  // Канал: revoke всегда, без чекбокса (tweb: buttons[0].callback = callback(..., true))
  const isChannel = chatType === 'channel'
  const withCheckbox = canRevoke && !isChannel

  const [open, setOpen] = useState(true)
  const { mounted, cls } = usePopupTransition(open)
  const [checked, setChecked] = useState(false)
  // Действие кнопки откладывается до конца exit-анимации — тот же приём, что
  // был у снесённого `shared/ui/ConfirmPopup` (uncontrolled-режим).
  const pending = useRef<(() => void) | null>(null)
  const exit = useRef({ onDeleteForEveryone, onDeleteForMe, onClose })
  exit.current = { onDeleteForEveryone, onDeleteForMe, onClose }
  useEffect(() => {
    if (mounted) return
    const p = pending.current
    if (p) p(); else exit.current.onClose()
  }, [mounted])

  const dismiss = () => { pending.current = null; setOpen(false) }
  const confirmDelete = () => {
    pending.current = () => {
      if ((isChannel && canRevoke) || (withCheckbox && checked)) exit.current.onDeleteForEveryone()
      else exit.current.onDeleteForMe()
    }
    setOpen(false)
  }

  useNavLayer(open, dismiss) // браузерный/аппаратный Back закрывает попап

  // Esc — закрыть; Enter — единственная content-кнопка (tweb btnConfirmOnEnter
  // при buttons.length===2 с учётом авто-Cancel — здесь их и есть ровно две).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); dismiss() }
      else if (e.key === 'Enter') { e.stopPropagation(); confirmDelete() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  })

  if (!mounted) return null

  return createPortal(
    // tweb deleteMessages.ts: `new PopupPeer('popup-delete-chat', …)`
    // (дамп `17-popup-03-delete-message.json`: div.popup.popup-peer.popup-delete-chat)
    <div className={classNames('popup', 'popup-peer', 'popup-delete-chat', cls)} onClick={dismiss}>
      <div
        className={classNames('popup-container', 'z-depth-1', withCheckbox ? 'have-checkbox' : '')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="popup-header">
          {avatar}
          <div className="popup-title">
            {single ? t('Delete message') : t('Delete %d messages').replace('%d', String(count))}
          </div>
        </div>
        <p className="popup-description">
          {single ? t('Are you sure you want to delete this message?') : t('Are you sure you want to delete these messages?')}
        </p>
        {withCheckbox && (
          <Checkbox
            checked={checked}
            shape="square"
            className="checkbox-ripple hover-effect rp"
            caption={chatType === 'private' && peerFirstName
              ? `${t('Also delete for')} ${peerFirstName}`
              : t('Delete for all members')}
            onToggle={() => setChecked((v) => !v)}
          />
        )}
        <div className="popup-buttons">
          <button type="button" className="popup-button btn danger" onClick={confirmDelete}>{t('Delete')}</button>
          <button type="button" className="popup-button btn primary" onClick={dismiss}>{t('Cancel')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Подпись строки в пикере: private → presence/бот, группа/канал/избранное — метка.
function shareSub(chat: Chat, presence: Record<number, UserStatus>, lang: string, t: (s: string) => string): string {
  if (chat.type === 'saved') return t('forward here to save')
  if (chat.type === 'channel') return t('Channel')
  if (chat.type === 'group') return t('Group')
  if (chat.isBot) return t('bot')
  // Присутствие — конструктор `UserStatus`: «онлайн» это `userStatusOnline` с
  // непросроченным `expires` (порт `appUsersManager.isUserOnline`), а момент
  // «был(а) в сети» лежит в самом конструкторе.
  const p = presence[Number(chat.id)]
  if (isUserStatusOnline(p, Math.floor(Date.now() / 1000))) return t('online')
  return lastSeenLabel(userStatusWasOnline(p) * 1000, lang)
}

// Недавний контакт в горизонтальном ряду: круглый аватар + имя, галочка при выборе.
function RecentChip({ chat, selected, onToggle }: { chat: Chat; selected: boolean; onToggle: () => void }) {
  const src = useMediaUrl(chat.photoId ?? null)
  return (
    <div className={s.recent} onClick={onToggle}>
      <div className={classNames(s.recentAvatar, selected ? s.recentAvatarSel : '')}>
        <Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} src={src} preview={chat.avatarPreview} size={54} />
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
  onPick: (peerIds: number[]) => void
  onClose: () => void
}) {
  const t = useT()
  const [lang] = useLang()
  const meId = useChatsStore((st) => st.meId)
  const presence = useChatsStore((st) => st.presence)
  const folders = useFolders()
  const contactIds = useFoldersStore((st) => st.contactIds)
  const [q, setQ] = useState('')
  const [folderId, setFolderId] = useState(ALL_FOLDER_ID)
  // exit-анимация: закрытие/выбор сначала гасят open; колбэк владельцу (который
  // размонтирует пикер) — только из onExitComplete, когда карточка уехала.
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const confirmed = useRef<number[] | null>(null)

  const toggle = (peerId: number) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(peerId)) next.delete(peerId); else next.add(peerId)
    return next
  })
  const confirm = () => {
    if (selected.size) { confirmed.current = [...selected]; setOpen(false) }
  }

  // Секретные чаты — не цель пересылки (E2E). Маппим в Chat для аватаров/имён.
  const chats = useMemo<Chat[]>(
    // Секретный чат — НАШ параметр строки диалога (решение Р9), а не строка
    // `type`: подсистема вне периметра порта, но гейт живой.
    () => dialogs.filter((d) => !d.secret).map((d) => dialogToChat(d, meId)),
    [dialogs, meId],
  )
  const query = q.trim().toLowerCase()
  const activeFolder = folderId !== ALL_FOLDER_ID ? folders.find((f) => f.id === folderId) : undefined
  const list = useMemo(() => {
    let out = chats
    if (activeFolder) out = out.filter((c) => chatMatchesFolder(c, activeFolder, contactIds))
    if (query) out = out.filter((c) => c.name.toLowerCase().includes(query))
    return out
  }, [chats, activeFolder, contactIds, query])
  // Строки для общего селектора: id/имя/аватар/подпись (tweb wrapSubtitle).
  const peers = useMemo(
    () => list.map((c) => ({
      id: Number(c.id),
      name: c.name,
      photoId: c.photoId,
      subtitle: shareSub(c, presence, lang, t),
    })),
    [list, presence, lang, t],
  )
  // Недавние — первые 8 чатов (лента отсортирована по свежести); прячем при поиске.
  const recents = query ? [] : chats.slice(0, 8)
  const searching = query.length > 0

  return (
    <Popup
      open={open}
      // tweb pickUser.tsx/forward.tsx: `class="popup-forward"`
      // (дамп `17-popup-01-forward-share.json`: div.popup.popup-forward)
      className="popup-forward"
      title={t('Share with')}
      onClose={() => setOpen(false)}
      onExitComplete={() => { const c = confirmed.current; if (c) onPick(c); else onClose() }}
      action={selected.size ? { label: `${t('Forward')} (${selected.size})`, onClick: confirm } : undefined}
      width={460}
    >
      {/* Тело — тот же селектор, что у участников/админов справа: в tweb форвард-попап
          собран из него же (дамп `17-popup-01-forward-share`:
          div.selector.selector-round.selector-right.selector-multiselect-hidden).
          Поиск, ряд «недавних» и табы папок лежат ВНУТРИ его скроллера. */}
      <PeerSelector
        peers={peers}
        mode="multi"
        design="round"
        side="right"
        multiselectHidden
        noFilter
        placeholder={t('Search')}
        onQueryChange={setQ}
        selected={[...selected]}
        onSelectedChange={(ids) => setSelected(new Set(ids))}
        beforeList={
          <>
            {/* Ряд «недавних» — горизонтальная секция внутри селектора
                (`sidebar-left-section-container search-group search-group-contacts`
                со своим `scrollable-x`), как в дампе. */}
            {recents.length > 0 && (
              // Классы 1:1 с дампом: горизонтальную ленту даёт именно
              // `search-group-people` (_searchGroup.scss), `-with-scroll` —
              // свой скроллер, `popup-forward-top-peers collapsable` —
              // z-слой и схлопывание при поиске (_forward.scss).
              <div className="sidebar-left-section-container search-group search-group-contacts search-group-people popup-forward-top-peers collapsable search-group-with-scroll">
                <div className="sidebar-left-section search-group-inner">
                  <div className="sidebar-left-section-content search-group-content">
                    <div className="scrollable scrollable-x search-group-scrollable-x">
                      <ul className="chatlist">
                        {recents.map((c) => (
                          <RecentChip key={c.id} chat={c} selected={selected.has(Number(c.id))} onToggle={() => toggle(Number(c.id))} />
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {!searching && folders.length > 0 && (
              <FolderTabs value={folderId} onChange={setFolderId} folders={folders} />
            )}
          </>
        }
      />
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
  // Собеседник живёт в зеркале пиров (вектор `users` контейнера `/chats`), а
  // не внутри строки диалога; «приватный» — это ключ пользователя.
  const rows = dialogs
    .filter((d) => isUser(d.peerId))
    .map((d) => ({ userId: d.peerId, name: peerTitle(d.peerId) }))
    .filter((r) => !!r.name && (!query || r.name.toLowerCase().includes(query)))
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
  onPick: (peerId: number) => void
  onClose: () => void
}) {
  const t = useT()
  const meId = useChatsStore((st) => st.meId)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(true)
  const picked = useRef<number | null>(null)
  const pick = (peerId: number) => { picked.current = peerId; setOpen(false) }
  const query = q.trim().toLowerCase()
  const rows = dialogs
    // Секретный чат не может быть целью пересылки/ответа (E2E: сервер отправит plaintext).
    .filter((d) => !d.secret)
    .map((d) => {
      // Вид чата ВЫВОДИТСЯ из конструктора пира и флагов — той же функцией, что
      // и в списке чатов (решение Р8: место вывода одно).
      const type = dialogChatType(d, cachedChat(d.peerId), meId)
      return {
        peerId: d.peerId,
        title: peerTitle(d.peerId) || `Чат ${d.peerId}`,
        sub: type === 'channel' ? t('Channel') : type === 'group' ? t('Group') : t('Private Chat'),
      }
    })
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
          <div key={r.peerId} className={s.listRow} onClick={() => pick(r.peerId)}>
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

/**
 * Кто отреагировал И кто просмотрел — ОДИН список (порт tweb `PopupReactedList`,
 * `popups/reactedList.ts`). Списка «просмотревших» отдельно от «отреагировавших»
 * у оригинала нет: обе категории лежат в одной ленте строк, которую одним
 * ответом отдаёт `getMessageReactionsListAndReadParticipants`
 * (`appManagers/appMessagesManager.ts:9037-9088`, ветка `combined`).
 *
 * Строку просмотревшего от строки реагировавшего отличает ОТСУТСТВИЕ реакции:
 * `processDialogElementForReaction` добавляет стикер только `if(reaction)`
 * (`reactedList.ts:49-72`), поэтому у нас `emoji` необязателен и у просмотревшего
 * его нет.
 *
 * АДАПТАЦИИ (у оригинала это модальный попап по центру, у нас — позиционируемый
 * список, см. докблок `ContextMenuPopups.showReactedList` в `chat/contextMenu.ts`):
 *  • заголовок — два счётчика «иконка + число», ровно то, что оригинал держит
 *    ФАЛЬШИВЫМИ табами `reactions`/`checks` в шапке (`createFakeReaction`,
 *    `reactedList.ts:344-361`, вставка — `:156-181`): у них тоже только глиф и
 *    число, без подписи;
 *  • самих табов (фильтра по конкретной реакции, `horizontalMenu` :274-292) нет —
 *    показывается сразу объединённая лента, то есть содержимое таба по умолчанию;
 *  • вторая строка ряда (время прочтения / статус пользователя, `:74-87`) не
 *    портирована: дат прочтения бэк не хранит (см. `messages.viewers`).
 */
export function ReactedUsersPopup({ x, y, rows, onClose }: {
  x: number
  y: number
  rows: { name: string; photoId?: number; emoji?: string }[]
  onClose: () => void
}) {
  const t = useT()
  // Счётчики берутся с САМИХ строк: список уже объединён владельцем действия
  // (`useMessageActions.showReactedUsers`), и второго источника чисел нет.
  const reactedCount = rows.filter((r) => r.emoji).length
  const viewedCount = rows.length - reactedCount
  return createPortal(
    <div className={s.overlayBare} onClick={onClose}>
      <div
        className={classNames(s.card, s.viewers)}
        onClick={(e) => e.stopPropagation()}
        style={{ top: y, left: x }}
      >
        <Text size={13} color="var(--secondary-text-color)" className={s.viewersTitle}>
          {rows.length ? (
            <>
              {!!reactedCount && <><TgIcon name="reactions" size={14} /> {reactedCount}{'  '}</>}
              {!!viewedCount && <><TgIcon name="checks" size={14} /> {viewedCount}</>}
            </>
          ) : t('Nobody viewed')}
        </Text>
        {rows.map((r, i) => (
          <div key={i} className={s.viewersRow}>
            <UserAvatar name={r.name} photoId={r.photoId} size={28} />
            <Text noWrap size={14.5} color="var(--primary-text-color)" style={{ flex: 1 }}>{r.name}</Text>
            {!!r.emoji && <span style={{ fontSize: 18 }}>{r.emoji}</span>}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}
