// Порт tweb `src/tests/cleanSearchText.test.ts` (первый describe — дословно)
// плюс пины на `processSearchText` — нормализацию, через которую `SearchIndex`
// прогоняет и индексируемый текст, и запрос.
import { describe, expect, it } from 'vitest'
import cleanSearchText, { clearBadCharsAndTrim, fixCyrillic, latinizeString, processSearchText } from './cleanSearchText'

describe('clearBadCharsAndTrim', () => {
  it('removes ALL leading whitespace', () => {
    expect(clearBadCharsAndTrim('   xyz')).toEqual('xyz')
  })

  it('removes ALL trailing whitespace (not just the last char)', () => {
    expect(clearBadCharsAndTrim('abc   ')).toEqual('abc')
  })

  it('trims both ends fully', () => {
    expect(clearBadCharsAndTrim('  hello  ')).toEqual('hello')
  })

  it('trims trailing tabs fully', () => {
    expect(clearBadCharsAndTrim('tab\t\t')).toEqual('tab')
  })

  it('keeps inner whitespace, only trims the edges', () => {
    expect(clearBadCharsAndTrim('a b   ')).toEqual('a b')
  })

  it('still strips bad chars while trimming', () => {
    expect(clearBadCharsAndTrim('  foo!!!  ')).toEqual('foo')
  })

  it('empty-after-trim collapses to empty string', () => {
    expect(clearBadCharsAndTrim('    ')).toEqual('')
  })
})

describe('processSearchText', () => {
  it('латинизация: диакритика и кириллица сводятся к латинице', () => {
    expect(latinizeString('José Денис')).toBe('Jose Denis')
  })

  it('fixCyrillic: кириллица — клавишами той же раскладки (запрос в «не той» раскладке)', () => {
    // «ыуфкср» — это «search», набранное в русской раскладке
    expect(fixCyrillic('ЫУФКСР')).toBe('search')
  })

  it('полный набор опций: чистка, латиница, регистр и вторая ветка через \\x01', () => {
    expect(processSearchText('@Денис!', { clearBadChars: true, latinize: true, ignoreCase: true }))
      .toBe('denis\x01@ltybc!')
  })

  it('includeTag сохраняет ведущий «%» тега при чистке спецсимволов', () => {
    expect(processSearchText('%pu John', { clearBadChars: true, ignoreCase: true, includeTag: true })).toBe('%pu john')
    expect(processSearchText('%pu John', { clearBadChars: true, ignoreCase: true })).toBe('pu john')
  })

  it('cleanSearchText — те же опции без тега; latinize=false отключает вторую ветку', () => {
    expect(cleanSearchText('Jöhn')).toBe('john\x01jöhn')
    expect(cleanSearchText('Jöhn', false)).toBe('jöhn')
  })
})
