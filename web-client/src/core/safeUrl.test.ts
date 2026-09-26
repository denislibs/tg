// Allow-list схем обязан читать схему так же, как её прочтёт браузер: парсер URL
// выбрасывает табы/переводы строк где угодно и пропускает ведущие C0/пробел, так что
// `java\nscript:` и `\x01javascript:` для него — та же `javascript:`. Тот же разбор,
// что у `normalizeUrlProtocol` (порт tweb fcfe06f76, `matchUrlProtocol.ts`).
import { describe, expect, it } from 'vitest'
import { safeUrl } from './safeUrl'

describe('safeUrl', () => {
  it.each([
    'javascript:alert(1)',
    ' javascript:alert(1)',
    '\x01javascript:alert(1)',
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    'javascript\r\n:alert(1)',
    'data:text/html,<b>x</b>',
  ])('отвергает %j', (url) => {
    expect(safeUrl(url)).toBeUndefined()
  })

  it.each([
    'https://t.me/durov',
    'tg://resolve?domain=durov',
    'mailto:a@b.c',
    't.me/durov',
    '/relative',
  ])('пропускает %s', (url) => {
    expect(safeUrl(url)).toBe(url)
  })
})
