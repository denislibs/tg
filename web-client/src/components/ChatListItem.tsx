import { memo, useState, type CSSProperties, type ReactNode } from 'react'
import Avatar from '../shared/ui/Avatar'
import classNames from '../shared/lib/classNames'
import Menu, { MenuItem } from '../shared/ui/Menu'
import { useRipple } from '../shared/ui/Ripple/useRipple'
import TgIcon from './TgIcon'
import { useManagers } from '../core/hooks/useManagers'
import { useMediaContentUrl } from '../core/hooks/useMediaContentUrl'
import { useAvatarSrc } from './useAvatarSrc'
import { useChatsStore } from '../stores/chatsStore'
import { useSecretChatStore } from '../stores/secretChatStore'
import { useTypingLabel } from '../core/hooks/useTypingLabel'
import rootScope from '@lib/rootScope'
import TypingIndicator from './conversation/TypingIndicator'
import VerifiedBadge from './VerifiedBadge'
import PremiumBadge from './PremiumBadge'
import EmojiStatus from './EmojiStatus'
import type { Chat } from '../data'
import { useT } from '../i18n'
import { useTimeFormatter } from '../settings'
import MutePopup from './MutePopup'
import s from './ChatListItem.module.scss'

interface Props {
  chat: Chat
  selected: boolean
  // Stable across the whole list (the row passes its own id) so memo() holds and
  // a sidebar re-render (scroll-fold, overlay toggle) doesn't re-render every row.
  onSelect: (id: string) => void
  index?: number
  // Свёрнутый ряд (tweb .is-collapsed .chatlist-chat): только аватар, текст скрыт
  // — узкая колонка аватаров рядом с открытой панелью форум-тем.
  collapsed?: boolean
}

// Small rounded thumbnail of the last message's photo, shown before the preview
// text (tweb's dialog-subtitle media). Resolves the content URL via the worker.
function SidebarThumb({ id }: { id: number }) {
  const url = useMediaContentUrl(id)
  return <div className={s.thumb} style={{ backgroundImage: url ? `url(${url})` : undefined }} />
}

function ChatListItem({ chat, selected, onSelect, collapsed }: Props) {
  const onClick = () => onSelect(chat.id)
  const t = useT()
  const managers = useManagers()
  const avatarSrc = useAvatarSrc(chat.avatarUrl)
  const typingLabel = useTypingLabel(Number(chat.id), chat.type === 'group')
  // Секретный чат: статус handshake для pending-превью «Приглашение…» / «Ожидание…»
  // в списке (не-секретные чаты в стор не подписываются — селектор вернёт undefined).
  const secretStatus = useSecretChatStore((st) =>
    chat.type === 'secret' ? st.byChat[Number(chat.id)]?.status : undefined,
  )
  const presence = useChatsStore((s) => (chat.peerId != null ? s.presence[chat.peerId] : undefined))
  const setDialogMuted = useChatsStore((s) => s.setDialogMuted)
  const setDialogPinned = useChatsStore((s) => s.setDialogPinned)
  const setDialogArchived = useChatsStore((s) => s.setDialogArchived)
  const fmtTime = useTimeFormatter()
  const { onPointerDown, ripple } = useRipple()

  // Mute/Unmute (tweb dialogsContextMenu): Mute открывает попап длительности,
  // Unmute снимает сразу. null — попап ни разу не открывали (не монтируем).
  const [muteOpen, setMuteOpen] = useState<boolean | null>(null)
  const applyMute = (muted: boolean, seconds?: number | null) => {
    const chatId = Number(chat.id)
    setDialogMuted(chatId, muted) // оптимистично
    const until = muted && seconds ? Math.floor(Date.now() / 1000) + seconds : undefined
    void managers.groups.setMute(chatId, muted, until).catch(() => setDialogMuted(chatId, !muted))
  }

  // Anchor a corner of the menu AT the click point and grow toward free space
  // (right/bottom edges flip via right/bottom CSS so it stays exactly at the cursor).
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null)
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const MW = 220, MH = 320 // rough size, only to decide the grow direction
    const flipLeft = e.clientX + MW > window.innerWidth
    const flipUp = e.clientY + MH > window.innerHeight
    const pos: CSSProperties = { transformOrigin: `${flipUp ? 'bottom' : 'top'} ${flipLeft ? 'right' : 'left'}` }
    if (flipLeft) pos.right = window.innerWidth - e.clientX
    else pos.left = e.clientX
    if (flipUp) pos.bottom = window.innerHeight - e.clientY
    else pos.top = e.clientY
    setMenuPos(pos)
  }
  // Pin/Unpin (tweb ChatList.Context.Pin): оптимистично + откат; лимит 5 → тост.
  const applyPin = (pinned: boolean) => {
    const chatId = Number(chat.id)
    setDialogPinned(chatId, pinned)
    void managers.groups.setPin(chatId, pinned).catch((e: unknown) => {
      setDialogPinned(chatId, !pinned)
      if (String(e).includes('pin limit')) {
        rootScope.dispatchEvent('ui:toast', t("Sorry, you can't pin any more chats to the top."))
      }
    })
  }
  // Archive/Unarchive (tweb editPeerFolders folder_id 0↔1)
  const applyArchive = (archived: boolean) => {
    const chatId = Number(chat.id)
    setDialogArchived(chatId, archived)
    void managers.groups.setArchive(chatId, archived).catch(() => setDialogArchived(chatId, !archived))
  }
  const destructive =
    chat.type === 'channel' ? 'Leave Channel' : chat.type === 'group' ? 'Delete Group' : 'Delete Chat'
  const menuItems: { icon: ReactNode; label: string; danger?: boolean; onClick?: () => void }[] = [
    { icon: <TgIcon name="newtab" size={20} />, label: 'Open in new tab' },
    { icon: <TgIcon name="eye" size={20} />, label: 'Preview' },
    { icon: <TgIcon name="messageunread" size={20} />, label: 'Mark as unread' },
    {
      icon: <TgIcon name={chat.pinned ? 'unpin' : 'pin'} size={20} />,
      label: chat.pinned ? 'Unpin' : 'Pin',
      onClick: () => applyPin(!chat.pinned),
    },
    {
      icon: <TgIcon name={chat.muted ? 'unmute' : 'mute'} size={20} />,
      label: chat.muted ? 'Unmute' : 'Mute',
      onClick: () => (chat.muted ? applyMute(false) : setMuteOpen(true)),
    },
    // «Избранное» не архивируется (tweb: verify peerId !== myId)
    ...(chat.type !== 'saved'
      ? [{
          icon: <TgIcon name={chat.archived ? 'unarchive' : 'archive'} size={20} />,
          label: chat.archived ? 'Unarchive' : 'Archive',
          onClick: () => applyArchive(!chat.archived),
        }]
      : []),
    { icon: <TgIcon name="delete" size={20} />, label: destructive, danger: true },
  ]

  // Бейджи подзаголовка — классы tweb (appDialogsManager.create*Badge): все несут
  // `dialog-subtitle-badge badge badge-22`, размер 22 задаётся базовым `.badge`
  // (в _badge.scss шкалы 22 нет — как и в tweb, там BADGE_SIZE = 22).
  // `.dialog-subtitle-badge` в tweb по умолчанию `transform: scale(0)`
  // (_chatlist.scss:651, миксин dialog-badge-transition под animation-level-2),
  // а показывает его JS, добавляя `is-visible forwards`. У нас бейдж рендерится
  // декларативно — раз он в дереве, значит виден: ставим оба класса сразу.
  // Без них не видно НИ ОДНОГО бейджа строки (непрочитанные, реакции, пин).
  const badgeCls = (...extra: string[]) =>
    classNames('dialog-subtitle-badge', 'badge', 'badge-22', 'is-visible', 'forwards', ...extra)

  return (
    <>
      {/* Строка диалога — дерево tweb (живой DOM §2): порядок детей
          subtitle → title → avatar, визуальный порядок задаёт CSS
          (`.row-subtitle-row { order: 1 }`). Выбранная строка — класс `active`. */}
      <a
        className={classNames(
          'row', 'no-wrap', 'row-with-padding', 'row-clickable', 'hover-effect', 'rp',
          'chatlist-chat', 'chatlist-chat-bigger', 'row-big',
          selected ? 'active' : '',
          chat.muted ? 'is-muted' : '',
          s.row,
          collapsed ? s.rowCollapsed : '',
        )}
        href={`#${chat.id}`}
        data-peer-id={chat.peerId}
        onClick={(e) => { e.preventDefault(); onClick() }}
        onPointerDown={onPointerDown}
        onContextMenu={openMenu}
      >
        {ripple}

        <div className={classNames('row-row', 'row-subtitle-row', 'dialog-subtitle')}>
          <div className={classNames('row-subtitle', 'no-wrap', 'dialog-subtitle-flex', s.subtitleRow)}>
            {secretStatus === 'requested' || secretStatus === 'awaiting' || secretStatus === 'rejected' ? (
              /* Секретный чат до завершения handshake: pending-превью вместо
                 последнего сообщения. Заявка получателю — зелёным (акцент tweb). */
              <span className={secretStatus === 'requested' ? s.secretInvite : undefined}>
                {secretStatus === 'requested'
                  ? t('Приглашение в секретный чат')
                  : secretStatus === 'rejected'
                    ? t('Секретный чат отклонён')
                    : t('Ожидание, пока собеседник примет секретный чат…')}
              </span>
            ) : typingLabel.active ? (
              <span className="peer-typing-container">
                <TypingIndicator kind={typingLabel.kind} color="var(--color)" />
                {typingLabel.label}
              </span>
            ) : chat.draftPreview ? (
              /* Облачный черновик: «Черновик:» — tweb .danger */
              <>
                <span className="danger">{t('Draft')}: </span>
                {chat.draftPreview}
              </>
            ) : (
              <>
                {chat.forwarded && (
                  <TgIcon name="forward_filled" size={18} className={s.subtitleIco} />
                )}
                {chat.previewMediaId != null && <SidebarThumb id={chat.previewMediaId} />}
                {/* tweb режет превью на несколько .dialog-subtitle-span; последний
                    несёт `-last`, который возвращает nowrap поверх `white-space: pre`
                    у `-overflow` (_chatlist.scss:497-513). У нас спан один — значит
                    он одновременно и overflow-, и last-. */}
                <span className={classNames('dialog-subtitle-span', 'dialog-subtitle-span-overflow', 'dialog-subtitle-span-last')}>
                  {chat.preview}
                </span>
              </>
            )}
          </div>
          {/* Порядок бейджей в tweb — реакции → упоминания → непрочитанные → пин */}
          {chat.unreadReactions ? (
            <div className={badgeCls('reaction-badge', 'dialog-subtitle-badge-reaction')}>
              <TgIcon name="reactions_filled" size={16} />
            </div>
          ) : null}
          {chat.unreadMentions ? (
            <div className={badgeCls('mention', 'mention-badge', 'dialog-subtitle-badge-mention')}>@</div>
          ) : null}
          {chat.unread != null ? (
            <div className={badgeCls('unread', 'dialog-subtitle-badge-unread')}>{chat.unread}</div>
          ) : chat.pinned ? (
            <div className={badgeCls('badge-icon', 'dialog-subtitle-badge-pinned')}>
              <TgIcon name="chatspinned" size={19} />
            </div>
          ) : null}
        </div>

        <div className={classNames('row-row', 'row-title-row', 'dialog-title')}>
          <div className={classNames('row-title', 'no-wrap', 'user-title')}>
            {/* секретный чат: замок + зелёное имя (tweb .is-secret) */}
            {chat.type === 'secret' && (
              <TgIcon name="lock" size={16} className={s.secretLock} />
            )}
            <span className={classNames('peer-title', chat.type === 'secret' ? s.secretTitle : '')}>
              {chat.name}
            </span>
            {chat.verified && <VerifiedBadge size={20} className="verified-icon" />}
            {chat.premium && <PremiumBadge size={18} className="premium-icon" />}
            {chat.emojiStatus && <EmojiStatus emoji={chat.emojiStatus} size={18} />}
            {chat.muted && <TgIcon name="muted" size={17} className="dialog-muted-icon" />}
          </div>
          <div className={classNames('row-title', 'row-title-right', 'row-title-right-secondary', 'dialog-title-details')}>
            {chat.sent && (
              <span className={classNames('message-status', 'sending-status')}>
                <TgIcon name={chat.read ? 'checks' : 'check'} size={20} />
              </span>
            )}
            <span className="message-time">
              <span className="i18n">{fmtTime(chat.date)}</span>
            </span>
          </div>
        </div>

        <Avatar
          background={chat.avatar}
          text={chat.avatarText}
          emoji={chat.avatarEmoji}
          src={avatarSrc}
          size="dialog"
          // В свёрнутой колонке (форум открыт) онлайн-точку не рисуем — нижний
          // правый угол занимает бейдж непрочитанного (как в Telegram).
          online={collapsed ? false : chat.online || presence?.online}
          className={classNames('dialog-avatar', 'row-media', 'row-media-bigger')}
        />

        {/* Свёрнутый ряд (форум открыт): компактный бейдж непрочитанного в нижнем
            правом углу аватара, как в Telegram (текст ряда скрыт). */}
        {collapsed && (chat.unread != null || chat.unreadMentions) ? (
          <span className={chat.muted ? `${s.cornerBadge} ${s.cornerBadgeMuted}` : s.cornerBadge}>
            {chat.unread != null ? chat.unread : '@'}
          </span>
        ) : null}
      </a>

      <Menu open={!!menuPos} onClose={() => setMenuPos(null)} style={menuPos ?? undefined}>
        {menuItems.map((it) => (
          <MenuItem
            key={it.label}
            icon={it.icon}
            label={t(it.label)}
            danger={it.danger}
            onClick={() => {
              setMenuPos(null)
              it.onClick?.()
            }}
          />
        ))}
      </Menu>

      {muteOpen != null && (
        <MutePopup
          open={muteOpen}
          onClose={() => setMuteOpen(false)}
          onExitComplete={() => setMuteOpen(null)}
          onMute={(seconds) => applyMute(true, seconds)}
          avatar={<Avatar background={chat.avatar} text={chat.avatarText} emoji={chat.avatarEmoji} src={avatarSrc} size={32} />}
        />
      )}
    </>
  )
}

export default memo(ChatListItem)
