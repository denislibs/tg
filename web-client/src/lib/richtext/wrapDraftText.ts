/**
 * Порт tweb `lib/richTextProcessor/wrapDraftText.ts` (812502980) — текст с
 * сущностями → DOM поля ввода (`wrapRichText` в режиме `wrappingDraft`):
 * markup-span'ы вместо `strong`/`em`/…, ссылки и упоминания — живыми `a`
 * (`passEntities`), автоссылок нет (`noLinks`). Обратное преобразование —
 * `helpers/dom/getRichValueWithCaret.ts`. Потребители: черновик и правка
 * сообщения (`setValueSilently`), вставка (`insertRichTextAsHTML`), исходное
 * значение `InputField.setDraftValue`.
 *
 * Фильтр своих эмодзи без Premium (tweb `:13-15`) — признак Premium читается из `me` зеркала
 * (`useChatsStore`), как `appImManager.premium_toggle`, а не `rootScope.premium`.
 */
import type { MessageEntity } from '@layer'
import rootScope from '@lib/rootScope'
import { useChatsStore } from '@stores/chatsStore'
import wrapRichText, { type WrapRichTextOptions } from './wrapRichText'

export default function wrapDraftText(text: string, options: Partial<{
  wrappingForPeerId: PeerId
  entities: MessageEntity[]
}> & WrapRichTextOptions = {}) {
  if(!text) {
    return wrapRichText('')
  }

  let entities = options.entities
  const premium = !!useChatsStore.getState().me?.user.pFlags?.premium
  if(entities && !premium && options.wrappingForPeerId !== rootScope.myId) {
    entities = entities.filter((entity) => entity._ !== 'messageEntityCustomEmoji')
  }

  const fragment = wrapRichText(text, {
    ...options,
    entities,
    noLinks: true,
    wrappingDraft: true,
    passEntities: {
      messageEntityTextUrl: true,
      messageEntityMentionName: true,
    },
  })

  return fragment
}
