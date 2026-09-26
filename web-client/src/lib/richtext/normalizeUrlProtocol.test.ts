// Порт tweb `src/tests/normalizeUrlProtocol.test.ts` (fcfe06f76).
//
// Каждый адрес, который мы рисуем или открываем, сначала проходит здесь. Вопрос один —
// пишет ли текст уже свою схему? — и ответом раньше было «разбирает ли его `new URL`»,
// что смешивало «схемы нет» с «не разбирается» и превращало `https://t.me:99999/x`
// в бессмысленный `https://https://t.me:99999/x`.
//
// Отличие от оригинала — наш allow-list схем (`@core/safeUrl`, шапка `url.ts`):
// tweb обезвреживает только `javascript:`, мы — всё, чего нет в списке
// (`data:` поэтому переехал из «оставляет как есть» в «обезвреживает»).
import { describe, expect, test } from 'vitest'
import { matchUrlProtocol, normalizeUrlProtocol } from './url'

describe('normalizeUrlProtocol', () => {
  test.each([
    'https://t.me/durov',
    'http://example.com/',
    'tg://resolve?domain=durov',
    'tg:resolve?domain=durov',
    'mailto:durov@example.com',
    'HTTPS://T.ME/durov',
  ])('оставляет %s как есть', (url) => {
    expect(normalizeUrlProtocol(url)).toBe(url)
  })

  test.each([
    'https://t.me:99999/durov', // порт вне диапазона
    'https://[not-an-address]/x',
    'http://a b/',
  ])('оставляет %s как есть, хотя парсер его отвергает', (url) => {
    expect(normalizeUrlProtocol(url)).toBe(url)
    expect(matchUrlProtocol(url)).toBeNull() // т. е. прежняя проверка разбором дописала бы схему
  })

  test.each([
    ['t.me/durov', 'https://t.me/durov'],
    ['example.com', 'https://example.com'],
    ['/k/#durov', 'https:///k/#durov'],
    ['//example.com/x', 'https:////example.com/x'],
    ['1password://open', 'https://1password://open'], // схема не может начинаться с цифры
  ])('дописывает %s недостающий https', (url, expected) => {
    expect(normalizeUrlProtocol(url)).toBe(expected)
  })

  test.each([
    'javascript:alert(document.domain)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)', // парсер пропускает ведущие C0 и пробел, прежде чем читать схему
    '\x01javascript:alert(1)',
    'java\nscript:alert(1)', // …и выбрасывает табы и переводы строк где угодно
    'java\tscript:alert(1)',
    'javascript\r\n:alert(1)',
    'data:text/plain,hi', // allow-list: у tweb проходит, у нас — нет
  ])('обезвреживает %j в https-адрес', (url) => {
    const normalized = normalizeUrlProtocol(url)
    expect(normalized).toBe('https://' + url)
    // смысл префикса: чем бы ни была теперь строка, браузер не исполнит её как скрипт
    expect(normalized.replace(/[\t\n\r]/g, '').trimStart().startsWith('javascript:')).toBe(false)
  })
})
