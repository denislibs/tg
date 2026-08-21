// Порт tweb `lib/richTextProcessor/wrapEmojiText.ts`.
//
// Текст, в котором из всех сущностей ищутся ТОЛЬКО эмодзи. Ровно им оригинал
// рисует имя пира (`components/peerTitle.ts:114`, `wrappers/getPeerTitle.ts:91`)
// и текстовые аргументы служебной фразы (`wrapSomeText`): автолинков,
// @упоминаний и #хэштегов в имени искать нельзя — имя вида «t.me/x» стало бы
// ссылкой, а полный конвейер `wrapMessageText` именно это и сделает.
//
// Расхождение с оригиналом одно: аргументов `isDraft` (→ `wrappingDraft`) и
// готовых `entities` здесь нет — опции `wrappingDraft` у нашего `wrapRichText`
// не существует (разметка композера у нас своя, `core/richtext/markdown.ts`), а
// второго вызова с готовыми сущностями (`wrapEmojiTextWithEntities`) в клиенте
// нет ни одного.
import parseEntities from './parseEntities'
import wrapRichText from './wrapRichText'

export default function wrapEmojiText(text: string): DocumentFragment {
  if (!text) return wrapRichText('')

  const entities = parseEntities(text).filter((entity) => entity._ === 'messageEntityEmoji')
  return wrapRichText(text, { entities })
}
