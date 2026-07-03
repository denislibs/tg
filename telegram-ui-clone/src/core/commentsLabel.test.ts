import { describe, it, expect } from 'vitest'
import { commentsLabel } from './commentsLabel'

// English fallback t(): key IS the string.
const t = (s: string) => (s === 'Comments' ? 'Comments' : s === 'Comment' ? 'Comment' : s)
// Russian t(): only the two keys we need here.
const tRu = (s: string) => (s === 'Comments' ? 'Комментарии' : s === 'Comment' ? 'Комментарий' : s)

describe('commentsLabel plural forms', () => {
  it('ru: Slavic 1 / 2-4 / 5+ forms', () => {
    expect(commentsLabel(0, 'ru', tRu)).toBe('Комментарии')
    expect(commentsLabel(1, 'ru', tRu)).toBe('1 комментарий')
    expect(commentsLabel(2, 'ru', tRu)).toBe('2 комментария')
    expect(commentsLabel(4, 'ru', tRu)).toBe('4 комментария')
    expect(commentsLabel(5, 'ru', tRu)).toBe('5 комментариев')
    expect(commentsLabel(11, 'ru', tRu)).toBe('11 комментариев') // 11 is an exception (not "1")
    expect(commentsLabel(15, 'ru', tRu)).toBe('15 комментариев')
    expect(commentsLabel(21, 'ru', tRu)).toBe('21 комментарий')
    expect(commentsLabel(22, 'ru', tRu)).toBe('22 комментария')
    expect(commentsLabel(112, 'ru', tRu)).toBe('112 комментариев') // 12 exception
  })
  it('en: singular/plural via t()', () => {
    expect(commentsLabel(0, 'en', t)).toBe('Comments')
    expect(commentsLabel(1, 'en', t)).toBe('1 Comment')
    expect(commentsLabel(5, 'en', t)).toBe('5 Comments')
  })
})
