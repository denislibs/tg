// Порт tweb `appManagers/utils/messages/isUnreadByReadCursor.ts` (tweb 79d6a8f95) — 1:1.
/**
 * Whether a message is still unread judging by the peer's inbox read cursor
 * (`dialogsManager.getDialogReadState`, tweb `appMessagesManager.getInboxReadMaxId`) —
 * everything ABOVE the cursor is unread.
 *
 * An unknown cursor (`undefined` for a peer whose dialog has not been loaded) is answered
 * conservatively with `true`: the message keeps its read observer instead of being
 * silently treated as read and never marked so.
 */
export default function isUnreadByReadCursor(readMaxId: number | undefined, mid: number): boolean {
  return !((readMaxId as number) >= 0) || (readMaxId as number) < mid
}
