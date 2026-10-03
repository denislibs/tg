// Порт tweb `src/lib/richTextProcessor/parseMarkdown.ts` (812502980) — разбор
// маркеров разметки, набранных буквально (`**жирный**`, `` `код` ``, ```` ``` ````,
// `[текст](url)`, `@123 (имя)`), в сущности. У tweb его зовёт отправка
// (`appMessagesManager.sendText`, :2683) и ввод (`input.ts::onMessageInput`, :3476).
//
// Расхождения с оригиналом:
//  1. `currentEntities` не мутируется: оригинал сдвигает offset'ы сущностей
//     вызывающего по ходу разбора, у нас сдвигаются копии (сущности приходят из
//     `getRichValueWithCaret` поля ввода и дальше живут в его же объектах).
//  2. `MOUNT_CLASS_TO` (отладочная глобаль) не перенесён.
//
// Перенесён из `core/richtext/markdown.ts::parseMarkdown` (сносится вместе с
// React-композером в К-4) в место оригинала.
import type { MessageEntity } from '@core/models'
import { MARKDOWN_ENTITIES, combineSameEntities, findConflictingEntity, mergeEntities } from './entities'
import { MARKDOWN_REG_EXP } from './parseEntities'

export default function parseMarkdown(raw: string, currentEntities: MessageEntity[] = [], noTrim?: boolean) {
  // расхождение 1
  currentEntities = currentEntities.map((entity) => ({ ...entity }))

  const entities: MessageEntity[] = []
  let pushedEntity = false
  const pushEntity = (
    entity: MessageEntity,
    adjustOffset = 0,
    adjustLength = 0,
  ) => {
    // * we have to push entity even if it has no length
    // * to match the logic of other apps
    const conflictingEntity = findConflictingEntity(
      currentEntities,
      adjustOffset || adjustLength ? { ...entity, length: (entity.length ?? 0) + adjustLength + adjustOffset } : entity,
      true,
    )

    return !conflictingEntity ?
      (entities.push(entity), pushedEntity = true) :
      pushedEntity = false
  }

  const newTextParts: string[] = []
  let rawOffset = 0, match: RegExpMatchArray | null
  while((match = raw.match(MARKDOWN_REG_EXP))) {
    const matchWhitespace = match[1] || ''
    const matchIndexAfterWhitespace = (match.index ?? 0) + matchWhitespace.length
    const matchValueAfterWhitespace = match[0].slice(matchWhitespace.length)
    const matchIndex = rawOffset + matchIndexAfterWhitespace
    const possibleNextRawOffset = matchIndex + matchValueAfterWhitespace.length
    const beforeMatch = matchIndexAfterWhitespace > 0 && raw.slice(0, matchIndexAfterWhitespace)
    if(beforeMatch) newTextParts.push(beforeMatch)
    const text = match[3] || match[8] || match[11] || match[13]

    let entity: MessageEntity
    pushedEntity = false
    if(/^`*$/.test(text)) {
      // * the matched "content" is only backticks (e.g. a lone ``` that isn't a real fence): it's
      // * not inline code, so skip entity creation and fall through to the `!pushedEntity` push
      // * below, which emits the run verbatim ONCE. pushing here too duplicated it (` ``` ` on send).
    } else if(match[3]) { // pre
      const languageMatch = match[3].match(/(.*?)\n/)
      // * the first line of a ``` block is treated as a language tag only when it's a single
      // * identifier token (e.g. ```json). otherwise it's code and must NOT be swallowed — this
      // * keeps a leading `{` / `<` / etc. when the opening fence sits on the same line as the
      // * content (```{ ... }), which previously ate the first character(s) of the code.
      let language = languageMatch?.[1] || ''
      if(language && !/^[\w+#.-]{1,32}$/.test(language)) {
        language = ''
      }

      let code = language ? match[3].slice(language.length) : match[3]
      const startIndex = code[0] === '\n' ? 1 : 0
      const endIndex = code[code.length - 1] === '\n' ? -1 : undefined
      code = code.slice(startIndex, endIndex)
      entity = {
        _: 'messageEntityPre',
        language,
        offset: matchIndex,
        length: code.length,
      }

      const adjustOffset = match[2].length + (language ? language.length : 0) + (startIndex ? 1 : 0)
      const adjustLength = match[4].length + (endIndex ? 1 : 0)
      if(pushEntity(entity, adjustOffset, adjustLength)) {
        if(startIndex) {
          rawOffset -= 1
        }

        if(endIndex) {
          rawOffset -= 1
        }

        if(language) {
          rawOffset -= language.length
        }

        let whitespace = ''
        const previousPart = newTextParts[newTextParts.length - 1]
        if(previousPart && !/\s/.test(previousPart[previousPart.length - 1])) {
          whitespace = '\n'
        }

        newTextParts.push(whitespace, code, match[5])

        rawOffset -= match[2].length + match[4].length
      }
    } else if(match[7]) { // code|italic|bold
      const isSOH = match[6] === '\x01'
      const symbol = match[7]

      entity = {
        _: MARKDOWN_ENTITIES[symbol],
        offset: matchIndex + (isSOH ? 0 : match[6].length),
        length: text.length,
      } as MessageEntity

      if(pushEntity(entity, symbol.length, symbol.length)) {
        if(!isSOH) {
          newTextParts.push(match[6] + text + match[9])
        } else {
          newTextParts.push(text)
        }

        rawOffset -= symbol.length * 2 + (isSOH ? 2 : 0)
      }
    } else if(match[11]) { // custom mention
      entity = {
        _: 'messageEntityMentionName',
        user_id: +match[10],
        offset: matchIndex,
        length: text.length,
      }

      if(pushEntity(entity)) {
        newTextParts.push(text)

        rawOffset -= matchValueAfterWhitespace.length - text.length
      }
    } else if(match[12]) { // text url
      const url = match[14]
      entity = {
        _: 'messageEntityTextUrl',
        url,
        offset: matchIndex,
        length: text.length,
      }

      const adjustOffset = 1
      const adjustLength = 4 + url.length
      if(pushEntity(entity, adjustOffset, adjustLength)) {
        newTextParts.push(text)

        rawOffset -= match[12].length - text.length
      }
    }

    if(!pushedEntity) {
      newTextParts.push(matchValueAfterWhitespace)
    }

    raw = raw.slice(matchIndexAfterWhitespace + matchValueAfterWhitespace.length)
    rawOffset += matchIndexAfterWhitespace + matchValueAfterWhitespace.length

    const rawOffsetDiff = rawOffset - possibleNextRawOffset
    if(rawOffsetDiff) {
      currentEntities.forEach((entity) => {
        if((entity.offset ?? 0) >= matchIndex) {
          entity.offset = (entity.offset ?? 0) + rawOffsetDiff
        }
      })
    }
  }

  if(raw) newTextParts.push(raw)
  let newText = newTextParts.join('')
  if(!newText.replace(/\s+/g, '').length) {
    newText = raw
    entities.splice(0, entities.length)
  }

  currentEntities = mergeEntities(currentEntities, entities)
  combineSameEntities(currentEntities)

  let length = newText.length
  if(!noTrim) {
    // trim left
    newText = newText.replace(/^\s*/, '')

    let diff = length - newText.length
    if(diff) {
      currentEntities.forEach((entity) => {
        entity.offset = Math.max(0, (entity.offset ?? 0) - diff)
      })
    }

    // trim right
    newText = newText.replace(/\s*$/, '')
    diff = length - newText.length
    length = newText.length
    if(diff) {
      currentEntities.forEach((entity) => {
        if(((entity.offset ?? 0) + (entity.length ?? 0)) > length) {
          entity.length = length - (entity.offset ?? 0)
        }
      })
    }
  }

  return [newText, currentEntities] as const
}
