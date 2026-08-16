// src/components/conversation/controlPlates.ts
// Какая плашка (`.chat-input-control`) закрывает строку ввода — цепочка
// `haveSomethingInControl` из tweb `finishPeerChange` (chat/input.ts:2448-2567),
// где первая сработавшая ветка «съедает» флаг. Вынесено из Chat.tsx чистой
// функцией: решение о плашке — единственное, что двигает композер через _center,
// и ошибка здесь видна как дёрганье футера.

export interface ControlPlateInput {
  /** строка ввода в принципе доступна (права канала + дефолт-права группы) */
  composerUsable: boolean
  /**
   * права на запись ТОЧНО известны (useChatInfoCard.permissionsKnown). Пока
   * карточка канала в полёте — false; трактовать это как «нельзя писать» нельзя:
   * плашка встала бы на каждый вход в канал, включая собственный, и уезжала бы
   * обратно по ответу сети.
   */
  permissionsKnown: boolean
  isGroup: boolean
  canSendText: boolean
  /** бот без истории → «Начать» */
  botStart: boolean
  /** секретный чат до завершения E2E-handshake */
  secretLocked: boolean
  /** тред закрытого форум-топика — только чтение */
  threadClosed: boolean
}

export interface ControlPlates {
  botStartPlate: boolean
  secretPlate: boolean
  groupRestricted: boolean
  channelMutePlate: boolean
}

export function computeControlPlates(f: ControlPlateInput): ControlPlates {
  const botStartPlate = !f.threadClosed && f.botStart
  const secretPlate = !f.threadClosed && !botStartPlate && f.secretLocked
  const groupRestricted = !f.threadClosed && !botStartPlate && !secretPlate && !f.composerUsable && f.isGroup && !f.canSendText
  const channelMutePlate = !f.threadClosed && !botStartPlate && !secretPlate && !groupRestricted && !f.composerUsable && f.permissionsKnown
  return { botStartPlate, secretPlate, groupRestricted, channelMutePlate }
}
