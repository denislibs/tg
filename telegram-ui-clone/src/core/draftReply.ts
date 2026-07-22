// Построение ReplyState (плашка «ответ» над композером) из ConvMsg — общий
// расчёт имени/цвета для «Ответить» из контекстного меню (useMessageActions.
// startReply) и восстановления reply из облачного черновика (draft.reply_to_id,
// tweb ChatInput.setDraftReply). Чистая логика — тестируется без React.
import { peerColor } from '../components/peerColor'
import type { ConvMsg } from '../data'
import type { ReplyState } from './hooks/useChatSend'

// ReplyState для одного сообщения; date-плашки не реплаются.
export function convMsgReplyState(m: ConvMsg, msgId: number | undefined, chatName: string, accent: string): NonNullable<ReplyState> | null {
  if (m.type === 'date') return null
  const name = m.out ? 'Дн' : m.sender ?? chatName
  const color = m.out ? accent : m.senderColor ?? peerColor(name)
  return { msgId, name, text: m.text ?? m.emoji ?? '', color }
}

// Восстановление reply-бара из черновика: сообщение ищем в загруженном окне
// (msgs — read-model окна); вне окна — null, восстановление скипается.
export function draftReplyState(msgs: ConvMsg[], replyToId: number, chatName: string, accent: string): NonNullable<ReplyState> | null {
  const m = msgs.find((x) => x.id === replyToId)
  if (!m) return null
  return convMsgReplyState(m, replyToId, chatName, accent)
}
