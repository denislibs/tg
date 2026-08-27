// Хранилище сохранённых позиций чата — порт карты `appImManager.chatPositions`
// (tweb lib/appImManager.ts:236-238). Правила, ПО КОТОРЫМ запись появляется и
// исчезает, живут у владельца фактов (`chat/bubbles.ts::saveChatPosition`) и
// проверяются в `components/chat/bubbles.firstLoad.test.ts`; здесь — только
// ключ и жизненный цикл записи.
import { beforeEach, describe, expect, it } from 'vitest'
import { saveChatPosition, getChatPosition, deleteChatPosition, clearChatPositions } from './chatPositions'

beforeEach(() => clearChatPositions())

describe('chatPositions', () => {
  it('возвращает сохранённую позицию', () => {
    saveChatPosition(5, undefined, { mids: [3, 2, 1], top: 120 })
    expect(getChatPosition(5, undefined)).toEqual({ mids: [3, 2, 1], top: 120 })
  })

  it('позиция треда не смешивается с позицией самого чата', () => {
    saveChatPosition(5, undefined, { mids: [3, 2, 1], top: 120 })
    saveChatPosition(5, 7, { mids: [9], top: 30 })

    expect(getChatPosition(5, undefined)).toEqual({ mids: [3, 2, 1], top: 120 })
    expect(getChatPosition(5, 7)).toEqual({ mids: [9], top: 30 })
  })

  it('для неизвестного ключа возвращает undefined', () => {
    expect(getChatPosition(42, undefined)).toBeUndefined()
  })

  // Порт ветки `delete chatPositions[key]` (tweb appImManager.ts:2144): чат
  // оставлен у низа — прошлая запись обязана исчезнуть, иначе следующее
  // открытие уедет в середину истории.
  it('deleteChatPosition убирает запись только своего ключа', () => {
    saveChatPosition(5, undefined, { mids: [3], top: 120 })
    saveChatPosition(5, 7, { mids: [9], top: 30 })

    deleteChatPosition(5, undefined)

    expect(getChatPosition(5, undefined)).toBeUndefined()
    expect(getChatPosition(5, 7)).toEqual({ mids: [9], top: 30 })
  })

  it('clearChatPositions очищает все сохранённые позиции', () => {
    saveChatPosition(5, undefined, { mids: [3], top: 120 })
    saveChatPosition(10, 7, { mids: [4], top: 50 })

    expect(getChatPosition(5, undefined)).toEqual({ mids: [3], top: 120 })
    expect(getChatPosition(10, 7)).toEqual({ mids: [4], top: 50 })

    clearChatPositions()

    expect(getChatPosition(5, undefined)).toBeUndefined()
    expect(getChatPosition(10, 7)).toBeUndefined()
  })
})
