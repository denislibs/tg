import { describe, expect, it } from 'vitest'
import { formatUserPhone } from './phone'

describe('formatUserPhone', () => {
  it('группирует российский номер по паттерну страны (+7 XXX XXX XXXX)', () => {
    expect(formatUserPhone('+79261234567')).toBe('+7 926 123 4567')
  })

  it('принимает цифры без «+»', () => {
    expect(formatUserPhone('79261234567')).toBe('+7 926 123 4567')
  })

  it('страна без предмета (номер не совпал ни с одним кодом) — просто «+цифры»', () => {
    expect(formatUserPhone('0000000')).toBe('+0000000')
  })

  it('номер длиннее паттерна страны — остаток хвостом, цифры не теряются', () => {
    // +7 926 123 4567 89 — 2 лишние цифры после паттерна [3,3,4]
    expect(formatUserPhone('+7926123456789')).toBe('+7 926 123 4567 89')
  })
})
