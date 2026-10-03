/**
 * Порт tweb `lib/richTextProcessor/wrapDraftText.ts` (812502980) — текст с
 * сущностями → DOM поля ввода (`wrapRichText` в режиме `wrappingDraft`):
 * markup-span'ы вместо `strong`/`em`/…, ссылки и упоминания — живыми `a`
 * (`passEntities`), автоссылок нет (`noLinks`). Обратное преобразование —
 * `helpers/dom/getRichValueWithCaret.ts`. Потребители: черновик и правка
 * сообщения (`setValueSilently`), вставка (`insertRichTextAsHTML`), исходное
 * значение `InputField.setDraftValue`.
 *
 * Отличие: фильтра своих эмодзи без Premium (tweb `:13-15`,
 * `!rootScope.premium && wrappingForPeerId !== rootScope.myId`) нет — признака
 * Premium у клиента нет (`rootScope.premium` не портирован), свои эмодзи у нас
 * доступны всем. `wrappingForPeerId` принимается ради API tweb и пока не читается.
 */
import type { MessageEntity } from '@layer'
import wrapRichText, { type WrapRichTextOptions } from './wrapRichText'

export default function wrapDraftText(text: string, options: Partial<{
  wrappingForPeerId: PeerId
  entities: MessageEntity[]
}> & WrapRichTextOptions = {}) {
  if(!text) {
    return wrapRichText('')
  }

  const fragment = wrapRichText(text, {
    ...options,
    noLinks: true,
    wrappingDraft: true,
    passEntities: {
      messageEntityTextUrl: true,
      messageEntityMentionName: true,
    },
  })

  return fragment
}
