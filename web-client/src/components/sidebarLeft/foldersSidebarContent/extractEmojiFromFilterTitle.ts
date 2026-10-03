/**
 * Порт tweb `components/sidebarLeft/foldersSidebarContent/extractEmojiFromFilterTitle.ts`
 * (812502980): единственный эмодзи в начале или в конце названия папки уходит в
 * иконку колонки, остаток названия — подписью.
 *
 * Расхождение: на вход — строка, а не `TextWithEntities` (`Folder.title` у нас без
 * сущностей), поэтому ветки кастомного эмодзи (`messageEntityCustomEmoji` →
 * `docId`) нет — ищутся только юникод-эмодзи (`parseEntities`, как вторая ветка
 * оригинала `:20`).
 */
import parseEntities from '@lib/richtext/parseEntities'
import type { MessageEntity } from '@layer'

export type ExtractEmojiFromFilterTitleResult = {
  text: string
  emoji?: string
}

function canBeRemoved(len: number, entity: MessageEntity) {
  return entity.offset === 0 || entity.offset + entity.length === len
}

export default function extractEmojiFromFilterTitle(text: string): ExtractEmojiFromFilterTitleResult {
  const includedEmojis = parseEntities(text).filter((entity) => entity._ === 'messageEntityEmoji')
  const [emojiEntity] = includedEmojis

  if(includedEmojis.length !== 1 || !canBeRemoved(text.length, emojiEntity)) return {
    text,
  }

  return {
    text: (text.slice(0, emojiEntity.offset) + text.slice(emojiEntity.offset + emojiEntity.length)).trim(),
    emoji: text.slice(emojiEntity.offset, emojiEntity.offset + emojiEntity.length),
  }
}
