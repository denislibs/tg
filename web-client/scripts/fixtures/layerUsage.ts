// Фикстура для `npm run check-layer-types`: в продакшн-сборку не входит, из
// `src` не импортируется, живёт только в `tsconfig.layer-check.json`.
//
// Первый пин (`layerTypes.test.js`) доказывает, что `layer.d.ts` разрешает свои
// имена САМ ПО СЕБЕ. Это не то же самое, что «типами можно пользоваться»: алиас
// `@layer` может быть не прописан, дискриминатор `_` — не сузить объединение,
// а `pFlags` — оказаться не там, где его читает портируемый код. Фикстура
// проверяет ровно это, и падает она на этапе типов, а не в рантайме.
import type { Document, Message, MessageEntity, PhotoSize } from '@layer'

// Дискриминатор сужает объединение — на этом ветвится весь портируемый код.
export function isVisibleMessage(message: Message): message is Message.message {
  return message._ === 'message'
}

// Булев флаг лежит в `pFlags` и имеет тип-литерал `true`; «выключено» — это
// отсутствие ключа, поэтому обычная проверка на истинность и есть форма чтения.
export function isOutgoing(message: Message.message): boolean {
  return !!message.pFlags.out
}

// Про `flags` типами ничего доказать нельзя, и это стоит сказать прямо:
// генератор печатает `flags?: number` в тип (артефакт кодогенерации), хотя
// рантайм это поле не заполняет никогда — маска живёт только на проводе
// (`tl_utils.ts:747`). То есть чтение `message.flags` тип пропустит, а значение
// всегда будет `undefined`. Проверяется это не типом, а тестом на кодек
// (фаза 2): раскодировали → в объекте ключа `flags` нет.

// Лестница размеров: массив вариантов с собственными дискриминаторами. Именно
// её отсутствие в плоской модели заставляло подделывать превью.
export function findVectorThumb(doc: Document.document): PhotoSize.photoPathSize | undefined {
  return doc.thumbs?.find((thumb): thumb is PhotoSize.photoPathSize => thumb._ === 'photoPathSize')
}

// Сущности — тоже объединение по `_`, и у ветки есть свои поля.
export function entityLanguage(entity: MessageEntity): string | undefined {
  return entity._ === 'messageEntityPre' ? entity.language : undefined
}
