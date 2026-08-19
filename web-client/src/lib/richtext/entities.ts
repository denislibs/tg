// Модель сущностей и работа со списком — порт tweb
// `lib/richTextProcessor/{sortEntities,isEntityIntersecting,findConflictingEntity,mergeEntities,fixEmoji}.ts`
// + наборы конструкторов из `lib/richTextProcessor/index.ts`
// (MARKDOWN_ENTITIES / SINGLE_ENTITIES / PASS_*).
//
// Сущность — TL-объект из схемы (`@layer`), ветвление по конструктору `entity._`,
// как в оригинале. Служебные сущности разбора (emoji/linebreak/url/hashtag/
// mention/email) — те же конструкторы схемы, отдельной модели под них больше нет.
//
// Единственное расхождение тел с tweb — `?? 0` / дефолты при чтении offset/length:
// у клиентских конструкторов (`messageEntityEmoji`/`Linebreak`/`Caret`/…) схема
// объявляет оба поля необязательными, а у tweb `strictNullChecks: false`
// (tweb/tsconfig.json:34), поэтому арифметика компилируется у него как есть.
// У нас strict — читаем со значением по умолчанию, значения при этом те же.
import type { MessageEntity } from '@layer'

/** Порт tweb `index.ts:75-83` — разметка → конструктор сущности. */
export const MARKDOWN_ENTITIES: { [markdown: string]: MessageEntity['_'] } = {
  '`': 'messageEntityCode',
  '``': 'messageEntityPre',
  '**': 'messageEntityBold',
  '__': 'messageEntityItalic',
  '~~': 'messageEntityStrike',
  '_-_': 'messageEntityUnderline',
  '||': 'messageEntitySpoiler',
}

// Порт tweb `index.ts:87-104` — включая порядок: PASS_SINGLE_CONFLICTING_ENTITIES
// это КОПИЯ базового набора, снятая ДО того, как в PASS_CONFLICTING_ENTITIES
// дольются markdown-конструкторы.
export const SINGLE_ENTITIES: Set<MessageEntity['_']> = new Set([
  'messageEntityPre',
  'messageEntityCode',
  'messageEntityFormattedDate',
])
export const PASS_CONFLICTING_ENTITIES: Set<MessageEntity['_']> = new Set([
  'messageEntityEmoji',
  'messageEntityLinebreak',
  'messageEntityCaret',
])
export const PASS_SINGLE_CONFLICTING_ENTITIES = new Set(PASS_CONFLICTING_ENTITIES)
export const PASS_SINGLE_CONFLICTING_ENTITIES_WITH_QUOTE = new Set<MessageEntity['_']>([
  'messageEntityCode',
  'messageEntityFormattedDate',
])
for (const i in MARKDOWN_ENTITIES) {
  PASS_CONFLICTING_ENTITIES.add(MARKDOWN_ENTITIES[i])
}

/** Порт tweb `sortEntities.ts` — по offset, при равном offset длинная раньше короткой. */
export function sortEntities(entities: MessageEntity[]) {
  entities.sort((a, b) => {
    return ((a.offset ?? 0) - (b.offset ?? 0)) || ((b.length ?? 0) - (a.length ?? 0))
  })
}

/** Порт tweb `isEntityIntersecting.ts`. */
export function isEntityIntersecting(entity1: MessageEntity, entity2: MessageEntity) {
  const { offset: offset1 = 0, length: length1 = 0 } = entity1
  const { offset: offset2 = 0, length: length2 = 0 } = entity2
  return offset1 < offset2 + length2 && offset1 + length1 > offset2
}

/** Порт tweb `findConflictingEntity.ts` 1:1. */
export function findConflictingEntity(
  currentEntities: MessageEntity[],
  newEntity: MessageEntity,
  isInsertingSingleEntity = SINGLE_ENTITIES.has(newEntity._),
) {
  if (isInsertingSingleEntity) {
    return currentEntities.find((currentEntity) => {
      return isEntityIntersecting(currentEntity, newEntity)
    })
  }

  const { offset: newOffset = 0, length: newLength = 0 } = newEntity
  let singleStart = -1, singleEnd = -1, singleType: MessageEntity['_'] | undefined
  return currentEntities.find((currentEntity) => {
    const { offset = 0, length = 0 } = currentEntity
    if (SINGLE_ENTITIES.has(currentEntity._)) {
      singleStart = offset
      singleEnd = singleStart + length
      singleType = currentEntity._
    }

    // `singleType !== undefined &&` — только чтобы Set<MessageEntity['_']>.has не
    // получил undefined под strict; в tweb такой проверки нет, поведение то же.
    const isQuoteException = newEntity._ === 'messageEntityBlockquote' &&
      singleType !== undefined && PASS_SINGLE_CONFLICTING_ENTITIES_WITH_QUOTE.has(singleType)

    if (singleStart !== -1) {
      if (
        newOffset >= singleStart &&
        newOffset < singleEnd &&
        !PASS_SINGLE_CONFLICTING_ENTITIES.has(newEntity._) &&
        !isQuoteException
      ) {
        return true
      }
    }

    const isConflictingTypes = newEntity._ === currentEntity._ ||
      (
        !PASS_CONFLICTING_ENTITIES.has(newEntity._) &&
        !PASS_CONFLICTING_ENTITIES.has(currentEntity._) &&
        !isQuoteException
      )

    if (!isConflictingTypes) {
      return false
    }

    const isConflictingOffset = newOffset >= offset &&
      (newLength + newOffset) <= (length + offset)

    return isConflictingOffset
  })
}

/** Порт tweb `mergeEntities.ts` 1:1. */
export function mergeEntities(currentEntities: MessageEntity[], newEntities: MessageEntity[]) {
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
    if (entity._ === 'messageEntityEmoji') {
      const nextEntity = currentEntities[i + 1]
      const offset = entity.offset ?? 0
      if (nextEntity && (nextEntity.offset ?? 0) < (offset + (entity.length ?? 0))) {
        entity = currentEntities[i] = { ...entity }
        entity.length = (nextEntity.offset ?? 0) - offset
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
export function fixEmoji(text: string, entities?: MessageEntity[]) {
  text = text.replace(/[\u2640\u2642\u2764](?!\ufe0f)/g, (match: string, offset: number) => {
    if (entities) {
      const length = match.length

      offset += length
      entities.forEach((entity) => {
        const { offset: entityOffset = 0, length: entityLength = 0 } = entity
        const end = entityOffset + entityLength
        if (end === offset) { // current entity
          entity.length = entityLength + length
        } else if (end > offset) {
          entity.offset = entityOffset + length
        }
      })
    }

    return match + '\ufe0f'
  })

  return text
}
