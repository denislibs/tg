/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

/**
 * Порт tweb `helpers/dom/getRichElementValue.ts` (812502980) — обход DOM поля
 * ввода: текст по строкам + сущности `MessageEntity` с offset/length в UTF-16
 * (индексы JS-строки). Разметку поле хранит самим DOM: markup-span'ы
 * `wrapDraftText` (`[style*="font-family: markup-bold"]`, `[data-markup]`),
 * плюс теги из буфера обмена (`b`, `strong`, `em`, `pre`, `a`…) — таблица
 * `markdownTags` по образцу Bot API HTML-style.
 *
 * Отличия от оригинала:
 *  1. `getFormattedDateEntityByElement` не подмешивает сущность из
 *     `ENTITY_ELEMENT_MAP` (tweb `:136`): карту наполняет ветка
 *     `messageEntityFormattedDate` у `wrapRichText`, а её у нас нет (см. шапку
 *     `lib/richtext/wrapRichText.ts`). Дата берётся из `data-date`, как и в tweb.
 *  2. `follow.toUserId()` (расширение `String.prototype` tweb) → `Number(follow)`.
 */
import type { MessageEntity } from '@layer'
import { normalizeUrlProtocol } from '@lib/richtext/url'
import { BOM_REG_EXP } from '@helpers/string/bom'

export type MarkdownType = 'bold' | 'italic' | 'underline' | 'strikethrough' |
  'monospace' | 'link' | 'mentionName' | 'spoiler' | 'quote' | 'date'
export type MarkdownTag = {
  match: string
  entityName: Extract<
    MessageEntity['_'], 'messageEntityBold' | 'messageEntityUnderline' |
    'messageEntityItalic' | 'messageEntityCode' | 'messageEntityStrike' |
    'messageEntityTextUrl' | 'messageEntityMentionName' | 'messageEntitySpoiler' |
    'messageEntityBlockquote' | 'messageEntityFormattedDate'
  >
}

type CurrentEntities = { [_ in MessageEntity['_']]?: MessageEntity }

function join(...arr: string[]) {
  return arr.join(', ')
}

// https://core.telegram.org/bots/api#html-style
export const markdownTags: { [type in MarkdownType]: MarkdownTag } = {
  bold: {
    match: join(
      '[style*="bold"]',
      '[style*="font-weight: 700"]',
      '[style*="font-weight: 600"]',
      '[style*="font-weight:700"]',
      '[style*="font-weight:600"]',
      'b',
      'strong',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
    ),
    entityName: 'messageEntityBold',
  },
  underline: {
    match: join('[style*="underline"]', 'u', 'ins'),
    entityName: 'messageEntityUnderline',
  },
  italic: {
    match: join('[style*="italic"]', 'i', 'em'),
    entityName: 'messageEntityItalic',
  },
  monospace: {
    match: join('[style*="monospace"]', '[face*="monospace"]', 'pre'),
    entityName: 'messageEntityCode',
  },
  strikethrough: {
    match: join(
      '[style*="line-through"]',
      '[style*="strikethrough"]',
      'strike',
      'del',
      's',
    ),
    entityName: 'messageEntityStrike',
  },
  link: {
    match: 'A:not(.follow)',
    entityName: 'messageEntityTextUrl',
  },
  mentionName: {
    match: 'A.follow',
    entityName: 'messageEntityMentionName',
  },
  spoiler: {
    match: '[style*="spoiler"]',
    entityName: 'messageEntitySpoiler',
  },
  quote: {
    match: join('[style*="quote"]', '.quote'),
    entityName: 'messageEntityBlockquote',
  },
  date: {
    match: join('[style*="date"]', '.formatted-date'),
    entityName: 'messageEntityFormattedDate',
  },
}

const tabulationMatch = join('[style*="table-cell"]', 'th', 'td')

const BLOCK_TAGS = new Set([
  'DIV',
  'P',
  'BR',
  'LI',
  'SECTION',
  'H6',
  'H5',
  'H4',
  'H3',
  'H2',
  'H1',
  'TR',
  'OL',
  'UL',
  'BLOCKQUOTE',
])

export const SELECTION_SEPARATOR = '\x01'

export function getFormattedDateEntityByElement(
  element: HTMLElement,
  offset: number,
  length: number,
): MessageEntity.messageEntityFormattedDate {
  const dateStr = element.dataset.date
  const date = dateStr ? +dateStr : undefined
  return {
    _: 'messageEntityFormattedDate',
    pFlags: {},
    date: 0,
    ...(date ? { date } : {}),
    offset,
    length,
  }
}

function pushEntity(entities: MessageEntity[], entity: MessageEntity) {
  entities.push(entity)
  return entity
}

function checkElementForEntity(
  element: HTMLElement,
  value: string,
  entities: MessageEntity[],
  offset: { offset: number },
  line: string[],
  currentEntities: CurrentEntities,
) {
  for(const type in markdownTags) {
    const tag = markdownTags[type as MarkdownType]
    const closest = element.closest<HTMLElement>(tag.match + ', [contenteditable="true"]')
    if(closest?.getAttribute('contenteditable') !== null) {
      continue
    }

    let codeElement: HTMLElement | null
    if(tag.entityName === 'messageEntityCode' && (codeElement = element.closest<HTMLElement>('[data-language]'))) {
      (currentEntities[tag.entityName] ||= pushEntity(entities, {
        _: 'messageEntityPre',
        language: codeElement.dataset.language || '',
        offset: offset.offset,
        length: 0,
      })).length! += value.length
    } else if(tag.entityName === 'messageEntityTextUrl') {
      if(!value) {
        continue
      }

      let entity = currentEntities[tag.entityName]
      if(!entity) {
        let good = false
        try {
          const url1 = new URL((closest as HTMLAnchorElement).href)
          const url1String = url1.toString()
          const isRealUrl = url1.protocol === 'http:' || url1.protocol === 'https:'
          if(!isRealUrl) {
            throw 1
          }

          const url2Before = normalizeUrlProtocol(value)

          let url2String: string | undefined
          try {
            url2String = new URL(url2Before).toString()
          } catch{}

          const isSameUrl = url1String === url2String
          good = !isSameUrl
        } catch{}

        if(good) {
          entity = currentEntities[tag.entityName] = pushEntity(entities, {
            _: tag.entityName,
            url: (closest as HTMLAnchorElement).href,
            offset: offset.offset,
            length: 0,
          })
        }
      }

      if(entity) {
        entity.length! += value.length
      }
    } else if(tag.entityName === 'messageEntityMentionName') {
      // `data-follow` also arrives with pasted HTML, so it is untrusted: only a
      // numeric user id becomes an entity — a missing one used to throw here and
      // any other value reached `getUserInput` as NaN, i.e. as `inputUserSelf`.
      const follow = closest.dataset.follow
      if(!follow || !/^\d+$/.test(follow) || !+follow) {
        continue
      }

      (currentEntities[tag.entityName] ||= pushEntity(entities, {
        _: tag.entityName,
        offset: offset.offset,
        length: 0,
        user_id: Number(follow),
      })).length! += value.length
    } else if(tag.entityName === 'messageEntityBlockquote') {
      (currentEntities[tag.entityName] ||= pushEntity(entities, {
        _: tag.entityName,
        pFlags: {
          collapsed: !!closest.dataset.collapsed || undefined,
        },
        offset: offset.offset,
        length: 0,
      })).length! += value.length
    } else if(tag.entityName === 'messageEntityFormattedDate') {
      if(!value) {
        continue
      }

      const entity = getFormattedDateEntityByElement(closest, offset.offset, value.length)
      const { originalText, fakeText } = closest.dataset
      if(originalText && fakeText) { // * fix the text
        entity.length = originalText.length + value.length - fakeText.length // * can have \x02 (quoting), calculating the difference
        offset.offset += originalText.length - fakeText.length
        line[line.length - 1] = line[line.length - 1].replace(fakeText, originalText)
      }
      entities.push(entity)
    } else {
      // * ignore local visible entities
      if(!(
        tag.entityName === 'messageEntityUnderline' &&
        closest.classList.contains('anchor-url') &&
        closest === element
      )) {
        (currentEntities[tag.entityName] ||= pushEntity(entities, {
          _: tag.entityName,
          offset: offset.offset,
          length: 0,
        })).length! += value.length
      }
    }
  }
}

function isLineEmpty(line: string[]) {
  const { length } = line
  if(!length) {
    return true
  }

  if(line[length - 1] === SELECTION_SEPARATOR && length === SELECTION_SEPARATOR.length) {
    return true
  }

  return false
}

export default function getRichElementValue(
  node: HTMLElement,
  lines: string[],
  line: string[],
  selNode?: Node,
  selOffset?: number,
  entities?: MessageEntity[],
  offset: { offset: number, contentEnd?: number } = { offset: 0 },
  currentEntities: CurrentEntities = {},
) {
  if(node.nodeType === node.TEXT_NODE) { // TEXT
    const nodeValue = node.nodeValue!.replace(BOM_REG_EXP, '')

    if(nodeValue) {
      if(selNode === node) {
        line.push(nodeValue.substr(0, selOffset) + SELECTION_SEPARATOR + nodeValue.substr(selOffset!))
      } else {
        line.push(nodeValue)
      }
    } else if(selNode === node) {
      line.push(SELECTION_SEPARATOR)
    }

    if(entities && nodeValue.length && node.parentElement) {
      checkElementForEntity(node.parentElement, nodeValue, entities, offset, line, currentEntities)
    }

    offset.offset += nodeValue.length
    if(nodeValue.length) { // * track the last real-content offset (excludes trailing block line breaks)
      offset.contentEnd = offset.offset
    }
    return
  }

  if(node.nodeType !== node.ELEMENT_NODE) { // NON-ELEMENT
    return
  }

  const pushLine = () => {
    lines.push(line.join(''))
    line.length = 0
    ++offset.offset
  }

  const isSelected = selNode === node
  const isQuote = node.matches('.quote') // * can have inner formatted quotes, check by class
  const isBlock = BLOCK_TAGS.has(node.tagName) || isQuote
  if(isBlock && ((line.length && line[line.length - 1].slice(-1) !== '\n') || node.tagName === 'BR')) {
    pushLine()
  } else {
    const alt = node.dataset.stickerEmoji || (node as HTMLImageElement).alt
    const stickerEmoji = node.dataset.stickerEmoji

    if(alt && entities) {
      checkElementForEntity(node, alt, entities, offset, line, currentEntities)
    }

    if(stickerEmoji && entities) {
      entities.push({
        _: 'messageEntityCustomEmoji',
        document_id: node.dataset.docId!,
        offset: offset.offset,
        length: alt.length,
      })
    }

    if(alt) {
      line.push(alt)
      offset.offset += alt.length
      offset.contentEnd = offset.offset
    }
  }

  if(isSelected && !selOffset) {
    line.push(SELECTION_SEPARATOR)
  }

  const isTableCell = node.matches(tabulationMatch)
  const wasEntitiesLength = entities?.length
  let wasNodeEmpty = true

  // * prefill currentEntities for current element
  if(node.getAttribute('contenteditable') === null && entities) {
    checkElementForEntity(node, '', entities, offset, line, currentEntities)
  }

  let curChild = node.firstChild as HTMLElement | null
  while(curChild) {
    getRichElementValue(
      curChild,
      lines,
      line,
      selNode,
      selOffset,
      entities,
      offset,
      curChild.nodeType === curChild.TEXT_NODE ? currentEntities : { ...currentEntities },
    )
    curChild = curChild.nextSibling as HTMLElement | null

    if(!isLineEmpty(line)) {
      wasNodeEmpty = false
    }
  }

  if(isQuote) {
    const lastValue = line[line.length - 1]
    if(lastValue?.endsWith('\n')) { // slice last linebreak from quote
      line[line.length - 1] = lastValue.slice(0, -1)
      offset.offset -= 1
    }

    // * inner line breaks of a quote can come from block children (<br>/<div>): their \n lands in the
    // * value but never in the blockquote length (only text nodes feed checkElementForEntity), so the
    // * last character would spill outside the quote. Re-span the entity up to the last content offset
    // * (trailing block line breaks excluded).
    const quoteEntity = currentEntities.messageEntityBlockquote
    if(quoteEntity) {
      const contentEnd = Math.min(offset.contentEnd ?? offset.offset, offset.offset)
      quoteEntity.length = Math.max(0, contentEnd - quoteEntity.offset!)
    }
  }

  // can test on text with list (https://www.who.int/initiatives/sports-and-health)
  if(wasNodeEmpty && node.textContent?.replace(/[\r\n]/g, '')) {
    wasNodeEmpty = false
  }

  if(isSelected && selOffset) {
    line.push(SELECTION_SEPARATOR)
  }

  if(isTableCell && node.nextSibling && !isLineEmpty(line)) {
    line.push(' ')
    ++offset.offset

    // * combine entities such as url after adding space
    if(wasEntitiesLength !== undefined) {
      for(let i = wasEntitiesLength, length = entities!.length; i < length; ++i) {
        ++entities![i].length!
      }
    }
  }

  if(isBlock && !wasNodeEmpty) {
    pushLine()
  }

  if(!wasNodeEmpty && node.tagName === 'P' && node.nextSibling) {
    lines.push('')
    ++offset.offset
  }
}
