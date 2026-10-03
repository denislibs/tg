/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

/**
 * Порт tweb `helpers/dom/getRichValueWithCaret.ts` (812502980) — значение поля
 * ввода из DOM: `{value, entities, caretPos}`. Сущности — offset/length в UTF-16;
 * конфликтующие с «одиночными» (`pre`/`code`/дата) обрезаются, соседние
 * одинаковые склеиваются, список сортируется. Это и есть модель ввода tweb:
 * разметку хранит DOM поля, сущности читаются из него (на отправке, черновике,
 * автокомплите).
 *
 * Отличие: отладочные `MOUNT_CLASS_TO.getCaretPos`/`getRichValueWithCaret`
 * (глобали окна, tweb `:120-121`) не заводятся.
 */
import type { MessageEntity } from '@layer'
import { SINGLE_ENTITIES, combineSameEntities, findConflictingEntity, sortEntities } from '@lib/richtext/entities'
import getRichElementValue, { SELECTION_SEPARATOR } from '@helpers/dom/getRichElementValue'

export function getCaretPos(field: Node) {
  const sel = field.ownerDocument!.defaultView!.getSelection()
  let selNode: Node | undefined
  let selOffset: number | undefined
  if(sel?.rangeCount) {
    const range = sel.getRangeAt(0)
    const startOffset = range.startOffset
    if(
      range.startContainer &&
      range.startContainer == range.endContainer &&
      startOffset == range.endOffset
    ) {
      // * if focused on img, or caret has been set via placeCaretAtEnd
      const possibleChildrenFocusOffset = startOffset - 1
      const childNodes = field.childNodes
      if(range.startContainer === field && childNodes[possibleChildrenFocusOffset]) {
        selNode = childNodes[possibleChildrenFocusOffset]
        selOffset = 0

        for(let i = 0; i < range.endOffset; ++i) {
          const node = childNodes[i]
          const value = node.nodeValue || (node as HTMLImageElement).alt

          if(value) {
            selOffset += value.length
          }
        }
      } else {
        selNode = range.startContainer
        selOffset = startOffset
      }
    }
  }

  return { node: selNode, offset: selOffset }
}

export default function getRichValueWithCaret(
  field: Node | HTMLElement | DocumentFragment,
  withEntities = true,
  withCaret = true,
) {
  const lines: string[] = []
  const line: string[] = []

  const { node: selNode, offset: selOffset } = !(field instanceof DocumentFragment) && withCaret ?
    getCaretPos(field) :
    { node: undefined, offset: undefined }

  const entities: MessageEntity[] | undefined = withEntities ? [] : undefined
  const offset = { offset: 0 }
  if(field instanceof DocumentFragment) {
    let curChild = field.firstChild as HTMLElement | null
    while(curChild) {
      getRichElementValue(curChild, lines, line, selNode, selOffset, entities, offset)
      curChild = curChild.nextSibling as HTMLElement | null
    }
  } else {
    getRichElementValue(field as HTMLElement, lines, line, selNode, selOffset, entities, offset)
  }

  if(line.length) {
    lines.push(line.join(''))
  }

  let value = lines.join('\n')
  const caretPos = value.indexOf(SELECTION_SEPARATOR)
  if(caretPos !== -1) {
    value = value.substr(0, caretPos) + value.substr(caretPos + 1)
  }
  value = value.replace(/ /g, ' ')

  if(entities?.length) {
    // ! cannot do that here because have the same check before the sending in RichTextProcessor.parseMarkdown
    const singleEntities = entities.filter((entity) => SINGLE_ENTITIES.has(entity._))
    for(let i = 0; i < entities.length; ++i) { // * filter conflicting entities
      const entity = entities[i]
      if(SINGLE_ENTITIES.has(entity._)) {
        continue
      }

      const conflictingEntity = findConflictingEntity(singleEntities, entity)
      if(!conflictingEntity) {
        continue
      }

      entity.length = conflictingEntity.offset! - entity.offset!
      if(entity.length <= 0) {
        entities.splice(i--, 1)
      }
    }

    combineSameEntities(entities)
    sortEntities(entities)
  }

  // при `withEntities = false` — `undefined`, как в tweb (у него strict выключен)
  return { value, entities: entities as MessageEntity[], caretPos }
}
