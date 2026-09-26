// Порт tweb `src/tests/wrapUrl.test.ts` (fcfe06f76). Оригинал проверяет `onclick`
// (имя глобали), у нас то же имя едет в `action` (шапка `url.ts`), а вместо
// заглушек `window.im` работает реестр `KNOWN_ANCHOR_ACTIONS`.
import { describe, expect, test } from 'vitest'
import { wrapUrl } from './url'

describe('wrapUrl: ссылки Telegram', () => {
  test.each([
    'https://t.me/durov',
    'https://telegram.me/durov',
    'https://durov.t.me/',
    'https://web.t.me/durov',
    'https://T.ME:443/durov?start=source#fragment',
    // порт — не проверка хоста: явный порт на настоящем хосте остаётся внутренним, как и был
    'https://t.me:8443/durov',
  ])('внутреннее действие у хоста Telegram %s', (url) => {
    expect(wrapUrl(url).action).toBe('im')
  })

  test.each([
    't.me.evil.com/durov',
    'https://t.me.evil.com/durov',
    'https://telegram.me.evil.com/durov',
    'https://durov.t.me.evil.com/',
    'https://t.me@evil.com/durov',
    'https://user@t.me/durov',
    'ftp://t.me/durov',
  ])('недоверенный адрес %s внутреннего действия не получает', (url) => {
    expect(wrapUrl(url).action).toBeUndefined()
  })

  test('сначала разрешает хост, который пишет поддомен, потом читает путь', () => {
    // `durov.t.me` — это `t.me/durov`, поэтому путь под клиентским префиксом читается
    // уровнем ниже: `k.t.me/+abc` — инвайт `t.me/+abc`, а `durov.t.me/+abc` — не инвайт вовсе
    expect(wrapUrl('https://k.t.me/+AbCdEf').action).toBe('joinchat')
    expect(wrapUrl('https://durov.t.me/+AbCdEf').action).toBe('im')
  })

  test.each([
    'https://telesco.pe/durov/123',
  ])('внутреннее действие у медиа-зеркала %s', (url) => {
    expect(wrapUrl(url).action).toBe('im')
  })

  test.each([
    'https://telesco.pe.evil.com/durov/123',
    'https://telesco.pe@evil.com/durov/123',
    'https://evil.com/telesco.pe/durov/123',
  ])('двойник медиа-зеркала %s внутреннего действия не получает', (url) => {
    expect(wrapUrl(url).action).toBeUndefined()
  })

  test('tg: внутри внешнего адреса — не tg-ссылка', () => {
    expect(wrapUrl('https://evil.com/tg:resolve?domain=durov').action).toBeUndefined()
  })

  test('адрес, который отвергает парсер, возвращается как есть, без исключения', () => {
    // порт вне диапазона не разбирается нигде. `wrapRichText` не ловит исключения
    // вокруг `wrapUrl`, так что бросок здесь уронил бы рендер каждого сообщения с такой ссылкой
    const url = 'https://t.me:99999/durov'
    expect(() => wrapUrl(url)).not.toThrow()
    expect(wrapUrl(url)).toEqual({ url, action: undefined })
  })
})
