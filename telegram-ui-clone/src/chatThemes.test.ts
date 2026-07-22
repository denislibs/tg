import { describe, it, expect } from 'vitest'
import { CHAT_THEMES, chatThemeById, chatThemeVariant } from './chatThemes'

describe('chatThemes: разрешение темы по id и режиму', () => {
  it('у каждой темы уникальный id, эмодзи и по 4 цвета в градиенте (light+dark)', () => {
    const ids = new Set(CHAT_THEMES.map((t) => t.id))
    expect(ids.size).toBe(CHAT_THEMES.length)
    for (const t of CHAT_THEMES) {
      expect(t.emoji).toBeTruthy()
      expect(t.light.gradient).toHaveLength(4)
      expect(t.dark.gradient).toHaveLength(4)
      expect(t.light.accent).toMatch(/^#/)
      expect(t.dark.accent).toMatch(/^#/)
    }
  })

  it('chatThemeById находит тему и возвращает undefined для пустого/неизвестного id', () => {
    const first = CHAT_THEMES[0]
    expect(chatThemeById(first.id)?.id).toBe(first.id)
    expect(chatThemeById('')).toBeUndefined()
    expect(chatThemeById(undefined)).toBeUndefined()
    expect(chatThemeById('nope')).toBeUndefined()
  })

  it('chatThemeVariant отдаёт вариант под режим', () => {
    const t = CHAT_THEMES[0]
    expect(chatThemeVariant(t.id, 'light')).toEqual(t.light)
    expect(chatThemeVariant(t.id, 'dark')).toEqual(t.dark)
    expect(chatThemeVariant('', 'light')).toBeUndefined()
  })
})
