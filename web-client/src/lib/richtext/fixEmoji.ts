// Порт tweb `src/lib/richTextProcessor/fixEmoji.ts` (812502980) 1:1.
import type { MessageEntity } from '@layer'

export default function fixEmoji(text: string, entities?: MessageEntity[]) {
  text = text.replace(/[♀♂❤](?!️)/g, (match: string, offset: number) => {
    if(entities) {
      const length = match.length

      offset += length
      entities.forEach((entity) => {
        const end = entity.offset + entity.length
        if(end === offset) { // current entity
          entity.length += length
        } else if(end > offset) {
          entity.offset += length
        }
      })
    }

    return match + '️'
  })

  return text
}

