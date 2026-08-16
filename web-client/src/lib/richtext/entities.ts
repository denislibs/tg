// Модель сущностей и работа со списком — порт tweb
// `lib/richTextProcessor/{sortEntities,isEntityIntersecting,findConflictingEntity,mergeEntities,fixEmoji}.ts`
// + наборы типов из `lib/richTextProcessor/index.ts` (SINGLE_ENTITIES / PASS_*).
//
// Отличие от tweb ровно одно — модель сущности. В tweb это TL-объект и ветвление
// идёт по строке конструктора (`entity._ === 'messageEntityBold'`); у нас
// `MessageEntity.type` (`@core/models`). Служебные сущности (их порождает
// parseEntities: emoji/linebreak/url/hashtag/mention/email) на бэк не ходят и в
// `EntityType` не входят — поэтому расширяем модель здесь, локально для рендера.
import type { EntityType } from '@core/models'

/** Сущности, которых нет в сообщении на проводе — их находит parseEntities по тексту. */
export type ServiceEntityType = 'emoji' | 'linebreak' | 'url' | 'hashtag' | 'mention' | 'email'
export type WrapEntityType = EntityType | ServiceEntityType

/** Сущность на входе рендера: серверная (`MessageEntity`) либо служебная. */
export interface WrapEntity {
  type: WrapEntityType
  offset: number
  length: number
  /** 'text_link' */
  url?: string
  /** 'pre' */
  language?: string
  /** 'text_mention' */
  user_id?: number
  /** 'custom_emoji' */
  document_id?: number
  /** 'emoji' — кодпоинты глифа через '-', считаются ЧИСЛЕННО (см. emoji.ts) */
  unicode?: string
}

// tweb MARKDOWN_ENTITIES (index.ts:75-83) — типы, которые умеет ставить разметка.
const MARKDOWN_ENTITY_TYPES: WrapEntityType[] = [
  'code', 'pre', 'bold', 'italic', 'strikethrough', 'underline', 'spoiler',
]

// tweb SINGLE_ENTITIES (index.ts:87): pre, code, formattedDate.
// `messageEntityFormattedDate` не портирован (solid-js-ветка), поэтому его тут нет.
export const SINGLE_ENTITIES = new Set<WrapEntityType>(['pre', 'code'])

// tweb PASS_SINGLE_CONFLICTING_ENTITIES (index.ts:97) — КОПИЯ базового набора
// ДО того, как в PASS_CONFLICTING_ENTITIES дольются markdown-типы (index.ts:102-104):
// emoji, linebreak, caret. Каретки (черновик поля ввода) у нас нет.
export const PASS_SINGLE_CONFLICTING_ENTITIES = new Set<WrapEntityType>(['emoji', 'linebreak'])
export const PASS_CONFLICTING_ENTITIES = new Set<WrapEntityType>([
  ...PASS_SINGLE_CONFLICTING_ENTITIES,
  ...MARKDOWN_ENTITY_TYPES,
])
// tweb PASS_SINGLE_CONFLICTING_ENTITIES_WITH_QUOTE (index.ts:98): code, formattedDate.
export const PASS_SINGLE_CONFLICTING_ENTITIES_WITH_QUOTE = new Set<WrapEntityType>(['code'])

/** Порт tweb `sortEntities.ts` — по offset, при равном offset длинная раньше короткой. */
export function sortEntities(entities: WrapEntity[]) {
  entities.sort((a, b) => {
    return (a.offset - b.offset) || (b.length - a.length)
  })
}

/** Порт tweb `isEntityIntersecting.ts`. */
export function isEntityIntersecting(entity1: WrapEntity, entity2: WrapEntity) {
  return entity1.offset < entity2.offset + entity2.length && entity1.offset + entity1.length > entity2.offset
}

/** Порт tweb `findConflictingEntity.ts` 1:1. */
export function findConflictingEntity(
  currentEntities: WrapEntity[],
  newEntity: WrapEntity,
  isInsertingSingleEntity = SINGLE_ENTITIES.has(newEntity.type),
) {
  if (isInsertingSingleEntity) {
    return currentEntities.find((currentEntity) => {
      return isEntityIntersecting(currentEntity, newEntity)
    })
  }

  let singleStart = -1, singleEnd = -1, singleType: WrapEntityType | undefined
  return currentEntities.find((currentEntity) => {
    const { offset, length } = currentEntity
    if (SINGLE_ENTITIES.has(currentEntity.type)) {
      singleStart = offset
      singleEnd = singleStart + length
      singleType = currentEntity.type
    }

    // `singleType !== undefined &&` — только чтобы Set<WrapEntityType>.has не получил
    // undefined под strict; в tweb такой проверки нет, поведение то же.
    const isQuoteException = newEntity.type === 'blockquote' &&
      singleType !== undefined && PASS_SINGLE_CONFLICTING_ENTITIES_WITH_QUOTE.has(singleType)

    if (singleStart !== -1) {
      if (
        newEntity.offset >= singleStart &&
        newEntity.offset < singleEnd &&
        !PASS_SINGLE_CONFLICTING_ENTITIES.has(newEntity.type) &&
        !isQuoteException
      ) {
        return true
      }
    }

    const isConflictingTypes = newEntity.type === currentEntity.type ||
      (
        !PASS_CONFLICTING_ENTITIES.has(newEntity.type) &&
        !PASS_CONFLICTING_ENTITIES.has(currentEntity.type) &&
        !isQuoteException
      )

    if (!isConflictingTypes) {
      return false
    }

    const isConflictingOffset = newEntity.offset >= offset &&
      (newEntity.length + newEntity.offset) <= (length + offset)

    return isConflictingOffset
  })
}

/** Порт tweb `mergeEntities.ts` 1:1. */
export function mergeEntities(currentEntities: WrapEntity[], newEntities: WrapEntity[]) {
  currentEntities = currentEntities.slice()
  const filtered = newEntities.filter((e) => {
    return !findConflictingEntity(currentEntities, e)
  })

  currentEntities.push(...filtered)
  sortEntities(currentEntities)

  // * fix splitted emoji. messageEntityTextUrl can split the emoji if starts before its end (e.g. on fe0f)
  // * have to fix even if emoji supported since it's being wrapped in span
  for (let i = 0; i < currentEntities.length; ++i) {
    let entity = currentEntities[i]
    if (entity.type === 'emoji') {
      const nextEntity = currentEntities[i + 1]
      if (nextEntity && nextEntity.offset < (entity.offset + entity.length)) {
        entity = currentEntities[i] = { ...entity }
        entity.length = nextEntity.offset - entity.offset
      }
    }
  }

  return currentEntities
}

/**
 * Порт tweb `fixEmoji.ts` — дописывает VS16 к «голым» ♀/♂/❤ и сдвигает сущности.
 *
 * ВАЖНО: мутирует переданные сущности (как и в tweb). Наши сущности приходят из
 * стора и общие с React-ветками, поэтому вызывающий (wrapMessageEntities) отдаёт
 * сюда КОПИИ — см. комментарий там.
 */
export function fixEmoji(text: string, entities?: WrapEntity[]) {
  text = text.replace(/[\u2640\u2642\u2764](?!\ufe0f)/g, (match: string, offset: number) => {
    if (entities) {
      const length = match.length

      offset += length
      entities.forEach((entity) => {
        const end = entity.offset + entity.length
        if (end === offset) { // current entity
          entity.length += length
        } else if (end > offset) {
          entity.offset += length
        }
      })
    }

    return match + '\ufe0f'
  })

  return text
}
