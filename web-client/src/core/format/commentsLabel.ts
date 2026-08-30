import type { LangPackKey } from '@/lang'

/**
 * «N комментариев» под постом канала — порт tweb `Chat.Title.Comments`.
 *
 * До задачи 6 здесь жила СВОЯ славянская арифметика с русскими словами прямо в коде
 * («комментарий»/«комментария»/«комментариев») — потому что словарь не умел форм числа.
 * Теперь умеет: форму выбирает язык (`Intl.PluralRules` внутри `tArgs`), а ноль
 * по-прежнему даёт голый заголовок «Комментарии», как у оригинала.
 */
export function commentsLabel(
  count: number,
  t: (key: LangPackKey) => string,
  tArgs: (key: LangPackKey, args: (string | number)[]) => string,
): string {
  return count === 0 ? t('Chat.CommentsLabel') : tArgs('Chat.Title.Comments', [count])
}
