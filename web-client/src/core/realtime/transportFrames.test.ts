// src/core/realtime/transportFrames.test.ts
import { describe, it, expect } from 'vitest'
import { LOGGED_WITHOUT_CONSTRUCTOR, PASS_THROUGH, TRANSPORT_FRAMES } from './transportFrames'

describe('transportFrames', () => {
  it('PASS_THROUGH = ровно эфемерные типы, каждый с rt', () => {
    const ephemeral = Object.entries(TRANSPORT_FRAMES).filter(([, e]) => e.kind === 'ephemeral').map(([t]) => t)
    expect(Object.keys(PASS_THROUGH).sort()).toEqual(ephemeral.sort())
    for (const rt of Object.values(PASS_THROUGH)) expect(rt).toMatch(/^rt:/)
  })

  it('logged/bespoke типы НЕ попадают в PASS_THROUGH (идут через воронку/onFrame)', () => {
    expect(PASS_THROUGH[LOGGED_WITHOUT_CONSTRUCTOR]).toBeUndefined()
    expect(PASS_THROUGH['hello']).toBeUndefined()
  })

  // Кадр с курсором, но без конструктора, у нас ровно один — и это ЗАДАЧА (#51),
  // а не свойство. Появление второго означает, что кадр завели мимо схемы.
  it('кадр с курсором без конструктора ровно один — folder_update (#51)', () => {
    const logged = Object.entries(TRANSPORT_FRAMES).filter(([, e]) => e.kind === 'logged').map(([t]) => t)
    expect(logged).toEqual([LOGGED_WITHOUT_CONSTRUCTOR])
  })

  // Каталог сжат до кадров БЕЗ конструктора: апдейты уехали в updateCatalog.
  // Возврат любого из них сюда — возврат ветвления по строке.
  it('портированных апдейтов в каталоге нет', () => {
    for (const t of ['read', 'reaction', 'typing', 'presence', 'dialog_pin', 'chat_update', 'bot_callback_answer']) {
      expect(TRANSPORT_FRAMES).not.toHaveProperty(t)
    }
  })
})
