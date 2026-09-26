// Порт tweb `src/tests/matchTelegramUrlHost.test.ts` (fcfe06f76).
//
// Единственное место, которое отвечает «это хост ссылки Telegram?». Раньше ответом
// был регэксп по СЫРОМУ тексту адреса, и `https://t.me.evil.com/durov` ему
// удовлетворял: хост ничем не заканчивался, и чужой хост получал внутренние
// действия `im`/`call`.
//
// Блок оригинала «the pathname an internal handler receives» (`addAnchorListener`)
// не перенесён: у нас нет обработчика, который складывает поддомен в путь, —
// действие исполняет делегат ленты (`components/chat/bubbles.ts`,
// `openInternalLink`), а путь он из адреса не пересобирает.
import { describe, expect, test } from 'vitest'
import matchTelegramUrlHost, { matchUrlHost, TELESCOPE_LINK_HOST } from './matchTelegramUrlHost'

describe('matchTelegramUrlHost', () => {
  test.each([
    ['https://t.me/durov', undefined],
    ['https://t.me', undefined],
    ['https://telegram.me/durov', undefined],
    ['http://t.me/durov', undefined],
    ['https://T.ME/durov', undefined], // хост регистронезависим, заменённый регэксп — нет
    ['https://t.me:8443/durov', undefined],
    ['https://web.t.me/durov', undefined], // клиентский префикс пользователя не называет
    ['https://k.t.me/durov', undefined],
    ['https://durov.t.me/', 'durov'],
    ['https://durov.web.t.me/', 'durov'],
    ['https://durov.telegram.me/1', 'durov'],
    ['https://sub.sub.t.me/x', 'sub.sub'],
  ])('%s — хост Telegram, username из поддомена: %s', (url, prefix) => {
    expect(matchTelegramUrlHost(new URL(url))).toEqual({ prefix })
  })

  test.each([
    'https://t.me.evil.com/durov',
    'https://telegram.me.evil.com/durov',
    'https://durov.t.me.evil.com/',
    'https://t.me@evil.com/durov', // то, что читается как хост, здесь — логин
    'https://user@t.me/durov',
    'https://user:pw@t.me/durov',
    'https://myt.me/durov',
    'https://ttelegram.me/durov',
    'https://evil.com/?next=t.me/durov',
    'ftp://t.me/durov',
    'tg://resolve?domain=durov',
  ])('отказывает %s', (url) => {
    expect(matchTelegramUrlHost(new URL(url))).toBeUndefined()
  })

  test('вердикт — объект, а не префикс', () => {
    // вызывающий, проверяющий `match?.prefix` вместо `match`, счёл бы каждую обычную
    // `t.me/durov` внешней — поэтому голый хост обязан вернуться истинным и без префикса
    expect(matchTelegramUrlHost(new URL('https://t.me/durov'))).toBeTruthy()
  })
})

describe('matchUrlHost', () => {
  test('отделяет найденный хост от меток перед ним', () => {
    expect(matchUrlHost(new URL('https://telesco.pe/durov/1'), [TELESCOPE_LINK_HOST]))
      .toEqual({ host: TELESCOPE_LINK_HOST, subdomain: '' })
    expect(matchUrlHost(new URL('https://cdn.telesco.pe/durov/1'), [TELESCOPE_LINK_HOST]))
      .toEqual({ host: TELESCOPE_LINK_HOST, subdomain: 'cdn' })
    expect(matchUrlHost(new URL('https://telesco.pe.evil.com/durov/1'), [TELESCOPE_LINK_HOST]))
      .toBeUndefined()
  })

  test('переживает адрес, который парсер так и не построил', () => {
    expect(matchUrlHost(undefined, [TELESCOPE_LINK_HOST])).toBeUndefined()
  })
})
