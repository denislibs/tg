// ChatMsgActionPopups — попапы, управляемые стейтом useMessageActions (контекст-
// меню сообщения, статистика/факт-чек поста, «кто просмотрел/отреагировал»,
// ⭐-реакция, пикеры форварда/ответа-в-другом-чате, удаление, перевод). Они
// state-driven (открываются из хука, не императивно), поэтому рендерятся
// декларативно здесь, а не через popupStore. Всего ~3 пропса — данные (диалоги)
// и t/managers берём из стора/контекста внутри.
import { lazy, Suspense } from 'react'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { dialogToChat } from '../../core/dialogToChat'
import Avatar from '../../shared/ui/Avatar'
import { useMediaUrl } from '../../core/hooks/useMediaUrl'
import { getUserTitle } from '../../core/peers/getPeerTitle'
import type { useMessageActions } from '../../core/hooks/useMessageActions'
import MessageContextMenu from './MessageContextMenu'
import FactCheckEditor from './FactCheckEditor'
import StarReactionPopup from '../stars/StarReactionPopup'
import { ChatPicker, DeleteMessageDialog, ForwardPicker, ViewersPopup, ReactedUsersPopup } from '../messages/ChatDialogs'
import TranslatePopup from '../messages/TranslatePopup'

const PostStats = lazy(() => import('../PostStats'))

type MsgActions = ReturnType<typeof useMessageActions>

export default function ChatMsgActionPopups({ msgActions, numericChatId, isRealChat }: {
  msgActions: MsgActions
  numericChatId: number
  isRealChat: boolean
}) {
  const t = useT()
  const managers = useManagers()
  const allDialogs = useChatsStore((s) => s.dialogs)
  const meId = useChatsStore((s) => s.meId)
  const m = msgActions
  // Для delete-конфирма (tweb PopupDeleteMessages → PopupPeer peerId): тип чата и
  // first name собеседника подписывают чекбокс «Also delete for <имя>» /
  // «Delete for all members», а аватар чата (32) встаёт слева от заголовка.
  const dialog = allDialogs.find((d) => d.peerId === numericChatId)
  const dialogChat = dialog ? dialogToChat(dialog, meId) : undefined
  const dialogAvatarSrc = useMediaUrl(dialogChat?.photoId ?? null)

  return (
    <>
      {/* Message context menu — reactions strip + actions */}
      {m.msgMenu && (
        <MessageContextMenu menu={m.msgMenu} items={m.msgMenuItems} onClose={m.closeMsgMenu} onExited={m.destroyMsgMenu} onReaction={isRealChat ? m.reactToMenuMsg : undefined} />
      )}

      {/* Статистика поста канала (slide-in сабвью, tweb messageStatistics) */}
      <Suspense fallback={null}>
        {m.postStats && (
          <PostStats chatId={numericChatId} msgId={m.postStats.msgId} onBack={m.closePostStats} />
        )}
      </Suspense>

      {/* Редактор «проверки фактов» (канал, автор/админ) */}
      {m.factCheckEdit && (
        <FactCheckEditor initial={m.factCheckEdit.initial} onClose={m.closeFactCheckEditor} onSubmit={m.submitFactCheck} />
      )}

      {/* "Seen by" popup */}
      {m.viewers && (
        <ViewersPopup x={m.viewers.x} y={m.viewers.y} names={m.viewers.names} onClose={m.closeViewers} />
      )}

      {/* Кто отреагировал (long-press/правый клик по чипу реакции) */}
      {m.reacted && (
        <ReactedUsersPopup x={m.reacted.x} y={m.reacted.y} rows={m.reacted.rows} onClose={m.closeReacted} />
      )}

      {/* Платная ⭐-реакция: попап выбора количества звёзд (tweb PopupStarReaction) */}
      {m.starReact && isRealChat && (
        <StarReactionPopup open peerId={numericChatId} msgId={m.starReact.msgId} onClose={m.closeStarReaction} />
      )}

      {/* Forward target picker */}
      {m.forwardIds != null && (
        <ForwardPicker dialogs={allDialogs} onPick={m.doForward} onClose={m.closeForward} />
      )}

      {/* «Ответить в другом чате» (tweb ReplyToAnotherChat): выбор целевого чата */}
      {m.replyAnother && (
        <ChatPicker dialogs={allDialogs} title={t('Reply in Another Chat')} onPick={m.pickReplyAnotherChat} onClose={m.closeReplyAnother} />
      )}

      {/* Delete confirmation (чекбокс revoke, tweb PopupDeleteMessages) */}
      {m.delIds && (
        <DeleteMessageDialog
          canRevoke={m.delIds.canRevoke}
          count={m.delIds.ids.length}
          chatType={dialog?.type}
          peerFirstName={dialog?.peer ? getUserTitle(dialog.peer, { onlyFirstName: true }) : undefined}
          avatar={dialogChat ? (
            <Avatar background={dialogChat.avatar} text={dialogChat.avatarText} emoji={dialogChat.avatarEmoji} src={dialogAvatarSrc} size={32} />
          ) : undefined}
          onDeleteForEveryone={() => m.doDelete(true)}
          onDeleteForMe={() => m.doDelete(false)}
          onClose={m.closeDelete}
        />
      )}

      {/* Перевод сообщения (контекстное меню → Translate) */}
      <TranslatePopup open={m.translateText != null} text={m.translateText ?? ''} managers={managers} onClose={m.closeTranslate} />
    </>
  )
}
