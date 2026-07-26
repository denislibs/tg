// Маппинг emoji→эффект, гейт отправителя «ровно один эмодзи» и smoke-тест чистой
// генерации частиц (сам canvas-рендер не тестируется).
import { describe, it, expect } from 'vitest'
import {
  effectForEmoji,
  sendEffectForText,
  spawnEffectParticles,
  MAX_PARTICLES,
  type EmojiEffectKind,
} from './emojiEffects'

describe('effectForEmoji', () => {
  it('маппит все эффект-эмодзи на свой вид', () => {
    expect(effectForEmoji('❤️')).toBe('hearts') // с FE0F
    expect(effectForEmoji('❤')).toBe('hearts') // без FE0F
    expect(effectForEmoji('😍')).toBe('hearts')
    expect(effectForEmoji('🥰')).toBe('hearts')
    expect(effectForEmoji('🎉')).toBe('confetti')
    expect(effectForEmoji('🥳')).toBe('confetti')
    expect(effectForEmoji('🎊')).toBe('confetti')
    expect(effectForEmoji('🎆')).toBe('fireworks')
    expect(effectForEmoji('✨')).toBe('fireworks')
    expect(effectForEmoji('🌟')).toBe('fireworks')
    expect(effectForEmoji('👍')).toBe('thumbs')
    expect(effectForEmoji('💩')).toBe('poop')
    expect(effectForEmoji('🎂')).toBe('cake')
  })

  it('не-эффект-эмодзи и текст → null', () => {
    expect(effectForEmoji('😂')).toBeNull()
    expect(effectForEmoji('🔥')).toBeNull()
    expect(effectForEmoji('привет')).toBeNull()
    expect(effectForEmoji('')).toBeNull()
  })
})

describe('sendEffectForText (гейт «ровно один эмодзи»)', () => {
  it('одиночный эффект-эмодзи включает эффект (с пробелами и FE0F тоже)', () => {
    expect(sendEffectForText('❤️')).toBe('hearts')
    expect(sendEffectForText(' 👍 ')).toBe('thumbs')
    expect(sendEffectForText('🎉')).toBe('confetti')
  })

  it('несколько эмодзи, текст+эмодзи, обычный эмодзи и текст → null', () => {
    expect(sendEffectForText('❤️❤️')).toBeNull()
    expect(sendEffectForText('люблю ❤️')).toBeNull()
    expect(sendEffectForText('😂')).toBeNull()
    expect(sendEffectForText('привет')).toBeNull()
    expect(sendEffectForText('')).toBeNull()
  })
})

describe('spawnEffectParticles (smoke)', () => {
  const kinds: EmojiEffectKind[] = ['fireworks', 'confetti', 'hearts', 'thumbs', 'poop', 'cake']

  it.each(kinds)('%s: непустой набор ≤ MAX_PARTICLES с валидными числами', (kind) => {
    for (const origin of [null, { x: 300, y: 400 }]) {
      const parts = spawnEffectParticles(kind, origin, 1280, 800)
      expect(parts.length).toBeGreaterThan(0)
      expect(parts.length).toBeLessThanOrEqual(MAX_PARTICLES)
      for (const p of parts) {
        for (const n of [p.x, p.y, p.vx, p.vy, p.gravity, p.rot, p.vr, p.sway, p.size, p.delay, p.ttl]) {
          expect(Number.isFinite(n)).toBe(true)
        }
        expect(p.size).toBeGreaterThan(0)
        expect(p.ttl).toBeGreaterThan(0)
        expect(p.delay).toBeGreaterThanOrEqual(0)
        if (p.shape === 'glyph') expect(p.glyph).not.toBe('')
        else expect(p.color).not.toBe('')
      }
    }
  })

  it('origin задаёт точку запуска сердцам и глифам', () => {
    const origin = { x: 500, y: 600 }
    for (const kind of ['hearts', 'thumbs'] as const) {
      const parts = spawnEffectParticles(kind, origin, 1280, 800)
      for (const p of parts) {
        expect(Math.abs(p.x - origin.x)).toBeLessThanOrEqual(40)
        expect(Math.abs(p.y - origin.y)).toBeLessThanOrEqual(10)
      }
    }
  })

  it('глиф соответствует виду эффекта', () => {
    expect(spawnEffectParticles('thumbs', null, 100, 100)[0].glyph).toBe('👍')
    expect(spawnEffectParticles('poop', null, 100, 100)[0].glyph).toBe('💩')
    expect(spawnEffectParticles('cake', null, 100, 100)[0].glyph).toBe('🎂')
  })
})
