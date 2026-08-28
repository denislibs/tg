// ChatMsgActionPopups — попапы, управляемые стейтом useMessageActions
// (статистика/факт-чек поста, «кто отреагировал», пикер форварда, удаление).
// Они state-driven (открываются из хука, не императивно), поэтому рендерятся
// декларативно здесь, а не через popupStore. Всего ~3 пропса — данные (диалоги)
// и t/managers берём из стора/контекста внутри.
//
// Меню сообщения здесь больше нет: его открывала React-лента, а её место занял
// ванильный порт (`components/chat/contextMenu.ts`), который рисует пункты сам
// и зовёт отсюда только действия.
import { lazy, Suspense } from 'react'
import { useChatsStore } from '../../stores/chatsStore'
import { dialogToChat } from '../../core/dialogToChat'
import Avatar from '../../shared/ui/Avatar'
import { useMediaUrl } from '../../core/hooks/useMediaUrl'
import { peerTitle } from '../../core/peerCache'
import { isUser } from '../../core/peers/peerId'
import type { useMessageActions } from '../../core/hooks/useMessageActions'
import FactCheckEditor from './FactCheckEditor'
import { DeleteMessageDialog, ForwardPicker, ReactedUsersPopup } from '../messages/ChatDialogs'

const PostStats = lazy(() => import('../PostStats'))

type MsgActions = ReturnType<typeof useMessageActions>

export default function ChatMsgActionPopups({ msgActions, numericChatId }: {
  msgActions: MsgActions
  numericChatId: number
}) {
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

      {/* Кто отреагировал (long-press/правый клик по чипу реакции) */}
      {m.reacted && (
        <ReactedUsersPopup x={m.reacted.x} y={m.reacted.y} rows={m.reacted.rows} onClose={m.closeReacted} />
      )}

      {/* Forward target picker */}
      {m.forwardIds != null && (
        <ForwardPicker dialogs={allDialogs} onPick={m.doForward} onClose={m.closeForward} />
      )}

      {/* Delete confirmation (чекбокс revoke, tweb PopupDeleteMessages) */}
      {m.delIds && (
        <DeleteMessageDialog
          canRevoke={m.delIds.canRevoke}
          count={m.delIds.ids.length}
          chatType={dialogChat?.type}
          peerFirstName={dialog && isUser(dialog.peerId) ? peerTitle(dialog.peerId, { onlyFirstName: true }) : undefined}
          avatar={dialogChat ? (
            <Avatar background={dialogChat.avatar} text={dialogChat.avatarText} emoji={dialogChat.avatarEmoji} src={dialogAvatarSrc} size={32} />
          ) : undefined}
          onDeleteForEveryone={() => m.doDelete(true)}
          onDeleteForMe={() => m.doDelete(false)}
          onClose={m.closeDelete}
        />
      )}

    </>
  )
}
