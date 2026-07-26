import { describe, it, expect } from 'vitest'
import {
  formatCardNumber,
  formatExpiry,
  isValidCardNumber,
  isValidCvc,
  isValidExpiry,
  isValidCard,
  luhnCheck,
} from './card'

describe('card number', () => {
  it('groups digits into blocks of 4', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242')
    expect(formatCardNumber('4242 4242 42')).toBe('4242 4242 42')
  })
  it('strips non-digits and caps at 19', () => {
    expect(formatCardNumber('abc4111-1111 1111')).toBe('4111 1111 1111')
    expect(formatCardNumber('1'.repeat(25))).toBe('1111 1111 1111 1111 111')
  })
  it('accepts 13-19 digits, rejects shorter', () => {
    expect(isValidCardNumber('4242424242424242')).toBe(true)
    expect(isValidCardNumber('4111 1111 111')).toBe(false) // 10 digits
    expect(isValidCardNumber('4222222222222')).toBe(true) // 13
  })
})

describe('luhn', () => {
  it('validates a known-good number and rejects a bad one', () => {
    expect(luhnCheck('4242 4242 4242 4242')).toBe(true)
    expect(luhnCheck('4242 4242 4242 4241')).toBe(false)
  })
})

describe('expiry', () => {
  it('formats MM/YY', () => {
    expect(formatExpiry('12')).toBe('12')
    expect(formatExpiry('1225')).toBe('12/25')
    expect(formatExpiry('12/25')).toBe('12/25')
  })
  const now = new Date('2026-07-22T00:00:00Z')
  it('accepts a future date', () => {
    expect(isValidExpiry('12/26', now)).toBe(true)
    expect(isValidExpiry('07/26', now)).toBe(true) // current month still valid
  })
  it('rejects past and malformed', () => {
    expect(isValidExpiry('06/26', now)).toBe(false)
    expect(isValidExpiry('13/30', now)).toBe(false)
    expect(isValidExpiry('1/26', now)).toBe(false)
    expect(isValidExpiry('', now)).toBe(false)
  })
})

describe('cvc', () => {
  it('accepts 3-4 digits', () => {
    expect(isValidCvc('123')).toBe(true)
    expect(isValidCvc('1234')).toBe(true)
    expect(isValidCvc('12')).toBe(false)
    expect(isValidCvc('12345')).toBe(false)
  })
})

describe('isValidCard', () => {
  const now = new Date('2026-07-22T00:00:00Z')
  it('passes a well-formed, non-expired card (Luhn not required)', () => {
    expect(isValidCard({ number: '4000 0000 0000 0002', expiry: '12/28', cvc: '123' }, now)).toBe(true)
  })
  it('fails when any field is wrong', () => {
    expect(isValidCard({ number: '400', expiry: '12/28', cvc: '123' }, now)).toBe(false)
    expect(isValidCard({ number: '4242424242424242', expiry: '01/20', cvc: '123' }, now)).toBe(false)
    expect(isValidCard({ number: '4242424242424242', expiry: '12/28', cvc: '1' }, now)).toBe(false)
  })
})
