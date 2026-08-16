// Порт `appImManager.getChatSavedPosition` (tweb lib/appImManager.ts:2151):
// позиция ленты запоминается по ключу `peerId` + `_threadId`, чтобы возврат
// из треда отдал нижнему инстансу ровно тот вид, который он имел до ухода.
// Персист в AppState (в tweb он есть) — отдельная задача, здесь только память.

export interface ChatPosition {
  top: number
}

const positions = new Map<string, ChatPosition>()

function key(peerId: number, threadId?: number): string {
  return threadId ? `${peerId}_${threadId}` : `${peerId}`
}

export function saveChatPosition(peerId: number, threadId: number | undefined, pos: ChatPosition): void {
  positions.set(key(peerId, threadId), pos)
}

export function getChatPosition(peerId: number, threadId?: number): ChatPosition | undefined {
  return positions.get(key(peerId, threadId))
}

export function clearChatPositions(): void {
  positions.clear()
}
