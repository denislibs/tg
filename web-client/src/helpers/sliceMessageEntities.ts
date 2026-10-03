// Порт tweb `src/helpers/sliceMessageEntities.ts` (812502980) — 1:1: сущности окна
// `[offset, offset + length)`, пересчитанные в координаты этого окна (резка длинного
// сообщения на куски, `appMessagesManager.sendText` :2680, :2857).
import type { MessageEntity } from '@core/models'

export default function sliceMessageEntities(entities: MessageEntity[], offset: number, length: number): MessageEntity[] {
  if(!entities?.length) return []
  const result: MessageEntity[] = []
  const end = offset + length
  for(const entity of entities) {
    const entityOffset = entity.offset ?? 0
    const entityEnd = entityOffset + (entity.length ?? 0)
    if(entityEnd <= offset || entityOffset >= end) continue
    const newOffset = Math.max(entityOffset, offset) - offset
    const newLength = Math.min(entityEnd, end) - Math.max(entityOffset, offset)
    if(newLength > 0) {
      result.push({ ...entity, offset: newOffset, length: newLength })
    }
  }
  return result
}
