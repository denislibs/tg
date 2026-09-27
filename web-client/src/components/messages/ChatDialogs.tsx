import type { LangPackKey } from '@/lang'
import { useMemo, useRef, useState, type ReactNode } from 'react'
// Presentational chat dialogs/popups extracted from Chat: forward target
// picker, the reacted/seen list. Each is dumb — it self-sources i18n +
// motion constants and emits its actions via callbacks; the parent owns the
// state. Discard-voice confirm переехал на портированный `confirmationPopup`
// (задача 3 плана solid-wave-1) и вызывается напрямую из `Composer.tsx`;
// delete confirm — на прямой `PopupPeer` (раунд правок 3, см. докблок
// `openDeleteMessageDialog` ниже) — самостоятельных React-компонентов под них
// больше нет.
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import { createPortal } from 'react-dom'
import TgIcon from '../TgIcon'
import { useT, useLang } from '../../i18n'
import Avatar from '../../shared/ui/Avatar'
import Popup from '../../shared/ui/Popup'
import PeerSelector from '../../shared/ui/PeerSelector'
import PopupElement from '../popups/popupElement'
import PopupPeer from '../popups/popupPeer'
import type { AvatarManagers } from '../avatar'
import { peerColor } from '../peerColor'
import UserAvatar from '../UserAvatar'
import { useMediaUrl } from '../../core/hooks/useMediaUrl'
import { dialogToChat, SAVED_GRADIENT } from '../../core/dialogToChat'
import { chatMatchesFolder } from '../../core/folderFilter'
import { PeerStatus } from '../../shared/ui/peerStatus'
import type { UserStatus } from '../../core/peers/peer'
import { useChatsStore } from '../../stores/chatsStore'
import { isUser } from '../../core/peers/peerId'
import { filterByRights } from '../../core/peers/filterByRights'
import type { ChatRights } from '../../core/peers/rights'
import { usePeers } from '../../core/hooks/usePeers'
import { useContactPeerIds } from '../../core/hooks/useContactPeerIds'
import { getUserTitle, SAVED_MESSAGES_TITLE } from '../../core/peers/getPeerTitle'
import { useFolders, useFoldersStore } from '../../stores/foldersStore'
import { ALL_FOLDER_ID } from '../../core/folderIds'
import { useImperativeIsland } from '../../core/hooks/useImperativeIsland'
import createFolderTabs from '../popups/pickUserFolderTabs'
import type { Chat, ChatType } from '../../data'
import type { Dialog } from '../../core/models'
import s from './ChatDialogs.module.scss'

/**
 * Delete confirmation — порт tweb `PopupDeleteMessages` (popups/deleteMessages.ts:
 * 84-193): заголовок «Delete message»/«Delete N messages», описание, в личке —
 * чекбокс «Also delete for <имя>», в группе с revoke — «Delete for all members»;
 * в канале чекбокса НЕТ — удаление всегда для всех (tweb overrideRevoke=true).
 * ОДНА danger-кнопка DELETE (+ авто-Cancel).
 *
 * РАУНД ПРАВОК 3 (ревью после задачи 3): раньше здесь была рукописная React-
 * копия ванильного попапа (`createPortal` + классы `popup`/`popup-peer`/
 * `popup-container`/…, свой Esc/Enter/`useNavLayer`/exit-анимация) — ВТОРОЙ
 * владелец того же DOM-контракта, что уже строит `PopupElement`/`PopupPeer`
 * (DoD 14: «переехало второй копией, и обе живы» — ровно тот класс провала).
 * Чекбоксы портированы в `PopupPeer` (peer.ts:22, :96-124, см. докблок
 * `popupPeer.ts`), и `DeleteMessageDialog` заменён на прямой вызов
 * `PopupElement.createPopup(PopupPeer, 'popup-delete-chat', …)` — как и
 * оригинал: `PopupDeleteMessages` строит `PopupPeer` САМ, минуя
 * `SimpleConfirmationPopup`/`confirmationPopup` (deleteMessages.ts:182-193).
 *
 * Бизнес-логика вызывающего (проверка прав админа мегагруппы, вычисление
 * `canRevoke` по правам/типу сообщения, разветвление на 6+ описаний,
 * deleteMessages.ts:26-178) в порт НЕ входит — она и не входила у
 * React-версии: `canRevoke`/`chatType`/`peerFirstName` вызывающий
 * (`useMessageActions.tsx`) вычисляет и передаёт уже готовыми, как и раньше.
 */
export function openDeleteMessageDialog({ peerId, managers, canRevoke, count = 1, chatType, peerFirstName, onDeleteForEveryone, onDeleteForMe, onClose }: {
  /** чат, откуда удаляют — аватар 32px слева от заголовка (peer.ts:46-54) */
  peerId: PeerId
  managers: AvatarManagers
  canRevoke: boolean
  /** число удаляемых сообщений (bulk-выбор) */
  count?: number
  /** тип чата — в личке чекбокс подписывается именем собеседника */
  chatType?: ChatType
  /** first name собеседника личного чата (tweb wrapPeerTitle onlyFirstName) */
  peerFirstName?: string
  onDeleteForEveryone: () => void
  onDeleteForMe: () => void
  /** любой исход БЕЗ удаления — Cancel/Esc/оверлей/Back (см. `popup.addEventListener('closeAfterTimeout', …)` ниже) */
  onClose?: () => void
}): PopupPeer {
  const single = count <= 1
  // Канал: revoke всегда, без чекбокса (tweb: buttons[0].callback = callback(..., true))
  const isChannel = chatType === 'channel'
  const withCheckbox = canRevoke && !isChannel
  let deleted = false // closeAfterTimeout не должен звать onClose ПОСЛЕ реального удаления

  const popup = PopupElement.createPopup(PopupPeer, 'popup-delete-chat', {
    // tweb deleteMessages.ts:182: `new PopupPeer('popup-delete-chat', …)`
    // (дамп `17-popup-03-delete-message.json`: div.popup.popup-peer.popup-delete-chat)
    peerId,
    managers,
    // Заголовок: одно сообщение — своя строка, несколько — ФОРМА ЧИСЛА с числом внутри
    // (раньше вызывающий сам подставлял число в «Delete %d messages» — и на одном
    // сообщении писал «Delete 1 messages»).
    ...(single
      ? { titleLangKey: 'DeleteSingleMessagesTitle' as const }
      : { titleLangKey: 'DeleteMessagesCount' as const, titleLangArgs: [count] }),
    descriptionLangKey: single ? 'AreYouSureDeleteSingleMessage' : 'AreYouSureDeleteFewMessages',
    // Подпись чекбокса — КЛЮЧ, имя подставляет строка (`DeleteMessagesOptionAlso` =
    // «Also delete for %1$s», tweb lang.ts:1607 + deleteMessages.ts:121-124). Раньше
    // вызывающий склеивал префикс «Also delete for» с именем сам — фраза, которую
    // нельзя перевести: в языках с другим порядком слов имя стоит не там.
    checkboxes: withCheckbox ? [
      chatType === 'private' && peerFirstName
        ? { text: 'DeleteMessagesOptionAlso' as const, textArgs: [peerFirstName] }
        : { text: 'DeleteChat.DeleteGroupForAll' as const },
    ] : undefined,
    buttons: [{
      langKey: 'Delete',
      isDanger: true,
      callback: (checked) => {
        deleted = true
        if ((isChannel && canRevoke) || (withCheckbox && checked?.size)) onDeleteForEveryone()
        else onDeleteForMe()
      },
    }],
  })

  if (onClose) {
    // тот же приём, что `confirmationPopup` (popupPeer.ts) — `closeAfterTimeout`
    // наступает и на Cancel, и на Esc/оверлей/Back, и на реальном удалении;
    // отличаем их флагом `deleted`, а не вторым событием.
    popup.addEventListener('closeAfterTimeout', () => {
      if (!deleted) onClose()
    })
  }

  popup.show()
  // Инстанс возвращается вызывающему (раунд правок ревью — правило шва,
  // web-client/CLAUDE.md): владелец, открывший попап в эффекте (сейчас —
  // `ChatMsgActionPopups`), обязан снять его сам на cleanup, если размонтируется
  // раньше исхода (`popup.forceHide()`, тот же приём, что `ConfirmDialog.tsx`).
  return popup
}

// Подпись строки в пикере: private → presence/бот, группа/канал/избранное — метка.
//
// Присутствие приезжает УЗЛОМ (`PeerStatus`, порт tweb
// `wrappers/getUserStatusString.ts`), остальные ветки — строкой: ветку решает
// вид чата, а не тип значения, и `ReactNode` вмещает обе. Прежняя проверка
// `isUserStatusOnline(..., Date.now())` снята — она была вторым читателем срока
// годности статуса, а гасит истёкший онлайн владелец (`degradeExpiredPresence`);
// «онлайн» теперь решает конструктор, как у оригинала (:80-82).
function shareSub(chat: Chat, presence: Record<number, UserStatus>, t: (key: LangPackKey) => string): ReactNode {
  if (chat.type === 'saved') return t('ChatYourSelf')
  if (chat.type === 'channel') return t('Channel')
  if (chat.type === 'group') return t('Group')
  if (chat.isBot) return t('Bot')
  return <PeerStatus status={presence[Number(chat.id)]} />
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

/** tweb `showForwardPopup`: `chatRightsActions.push('send_plain')`, когда
 *  из сообщений ничего не вывелось (`popups/forward.tsx:99-102`). */
const DEFAULT_FORWARD_RIGHTS: readonly ChatRights[] = ['send_messages']

// Forward target picker («Поделиться»): порт tweb popupForward — поиск, ряд
// недавних, табы папок (липкие при скролле, порт `pickUser.tsx:325-424` —
// `popups/pickUserFolderTabs.ts`) и список чатов с аватарами/подписями.
// Мультивыбор; аккордная кнопка «Переслать (N)» шлёт во все выбранные чаты сразу.
export function ForwardPicker({ dialogs, onPick, onClose, chatRightsActions = DEFAULT_FORWARD_RIGHTS }: {
  dialogs: Dialog[]
  // Один чат → tweb-флоу: открыть чат и показать плашку форварда в композере
  // (опции show/hide sender/caption живут в меню плашки). Несколько → отправить сразу.
  onPick: (peerIds: number[]) => void
  onClose: () => void
  /**
   * Что получатель должен мочь — tweb `chatRightsActions` селектора. Пересылка
   * выводит их из пересылаемых сообщений (`resolveChatRightsActions`,
   * `popups/forward.tsx:20-91`), по умолчанию — текст (`:99-102`); история —
   * `send_media` (`stories/share.ts:34`). Наши имена — `core/peers/filterByRights.ts`.
   */
  chatRightsActions?: readonly ChatRights[]
}) {
  const t = useT()
  const [lang] = useLang()
  const meId = useChatsStore((st) => st.meId)
  const presence = useChatsStore((st) => st.presence)
  const folders = useFolders()
  const contactIds = useFoldersStore((st) => st.contactIds)
  const [q, setQ] = useState('')
  // `selectedFolderId` селектора (`appSelectPeers.ts:70`, `:1358-1366`); пишет
  // его только ряд папок (`createFolderTabs` → `setFolderId`).
  const [folderId, setFolderId] = useState(ALL_FOLDER_ID)
  const folderTabsRef = useImperativeIsland((mount) => createFolderTabs({ mount, setFolderId }), [])
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

  // Карточки пиров — из зеркала (права чата живут на конструкторе `channel`);
  // хук ещё и объявляет пробел, если карточки нет.
  const peerCards = usePeers(dialogs.map((d) => d.peerId))
  // Секретные чаты — не цель пересылки (E2E). Маппим в Chat для аватаров/имён.
  const chats = useMemo<Chat[]>(
    () => {
      // Секретный чат — НАШ параметр строки диалога (решение Р9), а не строка
      // `type`: подсистема вне периметра порта, но гейт живой. Остальное —
      // `filterByRights` (`appSelectPeers.tsx:782-787`): куда писать нельзя,
      // того в списке нет.
      return dialogs
        .filter((d) => !d.secret && filterByRights(d.peerId, peerCards.get(d.peerId), chatRightsActions))
        .map((d) => dialogToChat(d, meId))
    },
    [dialogs, meId, peerCards, chatRightsActions],
  )
  // `renderSaved` (`appSelectPeers.tsx:725-735`): в «Все чаты» первой строкой
  // стоит сам зритель (`rootScope.myId`) — «Избранное», есть ли с собой
  // диалог или нет. Строку диалога, если он есть, берём как есть; нет —
  // собираем ту же (имя, фон, иконка закладки — как у `dialogToChat`).
  const savedChat = useMemo<Chat | undefined>(() => {
    if (meId == null) return undefined
    return chats.find((c) => c.type === 'saved') ?? {
      id: String(meId), name: SAVED_MESSAGES_TITLE, avatar: SAVED_GRADIENT, avatarEmoji: 'saved', preview: '', type: 'saved',
    }
  }, [chats, meId])
  const query = q.trim().toLowerCase()
  // tweb `_setFolderId(value)` (`appSelectPeers.ts:631-633`, зов `:644-647`):
  // пока в поле запрос, скоуп — «Все чаты», выбранная папка лишь помнится и
  // возвращается пустым полем. Сам скоуп у оригинала — `filterId` в
  // `dialogsStorage.getDialogs`; у нас список уже на руках, и чат отбирает то же
  // правило папки, что и везде (`chatMatchesFolder`).
  const scopeFolderId = query ? ALL_FOLDER_ID : folderId
  const activeFolder = scopeFolderId !== ALL_FOLDER_ID ? folders.find((f) => f.id === scopeFolderId) : undefined
  const list = useMemo(() => {
    let out = chats
    if (activeFolder) {
      // Скоуп папки — её диалоги (`getDialogs({filterId})`); `renderSaved` —
      // только для «Все чаты».
      out = out.filter((c) => chatMatchesFolder(c, activeFolder, contactIds))
    } else if (savedChat) {
      out = [savedChat, ...out.filter((c) => c !== savedChat)]
    }
    // Запрос у оригинала для «Избранного» — `testSelfSearch` (своё имя,
    // username, «Saved Messages»); здесь, как и у остальных строк, — по имени.
    if (query) out = out.filter((c) => c.name.toLowerCase().includes(query))
    return out
  }, [chats, savedChat, activeFolder, contactIds, query])
  // Строки для общего селектора: id/имя/аватар/подпись (tweb wrapSubtitle).
  const peers = useMemo(
    () => list.map((c) => ({
      id: Number(c.id),
      name: c.name,
      photoId: c.photoId,
      subtitle: shareSub(c, presence, t),
      avatar: c.type === 'saved' ? { background: c.avatar, emoji: c.avatarEmoji } : undefined,
    })),
    [list, presence, lang, t],
  )
  // Недавние — ряд `createTopPeersList` (`pickUser.tsx:517-528`): собеседники
  // (`getTopPeers('correspondents')`) и «своё» первым. Рейтинга собеседников
  // (`contacts.getTopPeers`) у нас нет — берём первые 8 личных чатов по
  // свежести; прячем при поиске.
  const recents = query
    ? []
    : [...(savedChat ? [savedChat] : []), ...chats.filter((c) => c !== savedChat && isUser(Number(c.id)))].slice(0, 8)
  const searching = query.length > 0

  return (
    <Popup
      open={open}
      // tweb pickUser.tsx/forward.tsx: `class="popup-forward"`
      // (дамп `17-popup-01-forward-share.json`: div.popup.popup-forward)
      className="popup-forward"
      title={t('ShareWith')}
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
        placeholder="Search"
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
            {/* `afterElement.after(mount)` (`pickUser.tsx:326-330`): ряд папок —
                сразу за «недавними», в DOM всегда (даже с одной «Все чаты»,
                как у оригинала), на запросе сворачивается `is-collapsed`. */}
            <div
              ref={folderTabsRef}
              className={classNames('popup-forward-folder-tabs-container', 'collapsable', searching ? 'is-collapsed' : '')}
            />
          </>
        }
      />
    </Popup>
  )
}

// Пикер контакта для attach-меню — порт `showContactPickerPopup`
// (tweb `popups/pickUser.tsx:838-856`: `peerType: ['contacts']`): строки —
// АДРЕСНАЯ КНИГА (`useContactPeerIds`), без себя, служебного «Telegram» и
// собеседников вне книги. Выбор — отправить сообщение-контакт.
export function ContactPicker({ onPick, onClose }: {
  onPick: (userId: number, name: string) => void
  onClose: () => void
}) {
  const t = useT()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(true)
  const picked = useRef<{ userId: number; name: string } | null>(null)
  const pick = (userId: number, name: string) => { picked.current = { userId, name }; setOpen(false) }
  const contactIds = useContactPeerIds(q)
  const cards = usePeers(contactIds ?? [])
  const rows = (contactIds ?? []).flatMap((userId) => {
    const user = cards.get(userId)
    return user?._ === 'user' ? [{ userId, name: getUserTitle(user) }] : []
  })
  return (
    <Popup
      open={open}
      title={t('AttachContact')}
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
          <div key={r.userId} className={s.listRow} data-peer-id={r.userId} onClick={() => pick(r.userId, r.name)}>
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
          ) : t('NobodyViewed')}
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
