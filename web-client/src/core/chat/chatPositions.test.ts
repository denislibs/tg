import { beforeEach, describe, expect, it } from 'vitest'
import { saveChatPosition, getChatPosition, clearChatPositions } from './chatPositions'

beforeEach(() => clearChatPositions())

describe('chatPositions', () => {
  it('возвращает сохранённую позицию', () => {
    saveChatPosition(5, undefined, { top: 120 })
    expect(getChatPosition(5, undefined)).toEqual({ top: 120 })
  })

  it('позиция треда не смешивается с позицией самого чата', () => {
    saveChatPosition(5, undefined, { top: 120 })
    saveChatPosition(5, 7, { top: 30 })

    expect(getChatPosition(5, undefined)).toEqual({ top: 120 })
    expect(getChatPosition(5, 7)).toEqual({ top: 30 })
  })

  it('для неизвестного ключа возвращает undefined', () => {
    expect(getChatPosition(42, undefined)).toBeUndefined()
  })
})
