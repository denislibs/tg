// Порт tweb `lib/richTextProcessor/encodeSpoiler.ts` — 1:1.
// Заменяет участок сущности-спойлера брайлевой «кашей» ТОЙ ЖЕ длины и отдаёт
// новый текст целиком плюс сам подменённый кусок.
import type { WrapEntity } from './entities'
import spoiler from './spoiler'

export default function encodeSpoiler(text: string, entity: WrapEntity) {
  const before = text.slice(0, entity.offset)
  const spoilerBefore = text.slice(entity.offset, entity.offset + entity.length)
  const spoilerAfter = spoiler(spoilerBefore)
  const after = text.slice(entity.offset + entity.length)
  text = before + spoilerAfter + after
  return { text, entityText: spoilerAfter }
}
