// Порт `appImManager.chatPositions` (tweb lib/appImManager.ts:236-238, :713-714)
// — «где пользователь оставил чат». Ключ тот же, что в оригинале: `peerId` +
// `_threadId` (appImManager.ts:2119, :2156), чтобы возврат из треда отдал
// нижнему инстансу ровно тот вид, который он имел до ухода.
//
// Здесь ТОЛЬКО хранилище. Что именно в нём лежит и при каких условиях —
// решает лента (`components/chat/bubbles.ts::saveChatPosition`): в tweb эту
// половину исполняет `appImManager.saveChatPosition` (:2111-2149), но все
// факты, на которых она стоит (расстояние до низа, отрисованное, срез
// вьюпорта), принадлежат `ChatBubbles` — она же ими и владеет у нас.
//
// Персист в AppState не делаем — в tweb он тоже только закомментирован
// (appImManager.ts:713 `// stateStorage.get('chatPositions').then(...)`).

/** Порт tweb `ChatSavedPosition` (lib/appImManager.ts:148-165).
 *
 *  `pinnedMessages` оригинала (подсказка плашки закрепа) не портирован:
 *  плашкой закрепа владеет не лента, а окружение чата — единственный
 *  потребитель подсказки в tweb, `prepareInitial` топбара, у нас отсутствует.
 *
 *  Пара `mids`/`top` в оригинале объявлена опциональной ровно из-за
 *  `pinnedMessages`: запись могла нести ОДНУ подсказку без позиции, и все
 *  потребители сверялись с `savedPosition?.mids`. Без подсказки запись без
 *  позиции смысла не имеет — поэтому оба поля обязательные, а «позицию
 *  восстанавливать не надо» выражается отсутствием самой записи. */
export interface ChatPosition {
  /** номера отрисованного окна, ПО УБЫВАНИЮ (tweb :2131
   *  `getRenderedHistory('desc', true, false)`) */
  mids: number[]
  /** `scrollable.scrollPosition` на момент ухода (tweb :2132) */
  top: number
}

const positions = new Map<string, ChatPosition>()

function key(peerId: number, threadId?: number): string {
  return threadId ? `${peerId}_${threadId}` : `${peerId}`
}

export function saveChatPosition(peerId: number, threadId: number | undefined, pos: ChatPosition): void {
  positions.set(key(peerId, threadId), pos)
}

/** Порт ветки `delete chatPositions[key]` (tweb appImManager.ts:2144) — чат
 *  оставлен у низа истории, восстанавливать нечего. Именно УДАЛЕНИЕ, а не
 *  «не трогать»: прошлая запись протухла и увела бы ленту в середину. */
export function deleteChatPosition(peerId: number, threadId?: number): void {
  positions.delete(key(peerId, threadId))
}

export function getChatPosition(peerId: number, threadId?: number): ChatPosition | undefined {
  return positions.get(key(peerId, threadId))
}

export function clearChatPositions(): void {
  positions.clear()
}
