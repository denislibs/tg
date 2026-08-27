// `tg://iv?url=…` и флаг `safe` — фиксация решения, а не порта.
//
// Оригинал (tweb `wrapUrl.ts:67-81`) для `tg://iv?url=…` ПОДМЕНЯЕТ адрес ссылки
// содержимым параметра `?url=`, но только когда у сущности выставлен `safe`.
// Флаг не проводной (`schema/schema.json`: `messageEntityTextUrl` — offset/length/url;
// `safe` дописан в `schema/schema_additional_params.json`) и в tweb выставляется
// ровно в двух местах, оба — внутри читалки Instant View, собранной из `page.RichText`
// (`wrapTelegramRichText.ts:114`, `instantView.tsx:443`). У нас такой читалки нет:
// статью отдаёт своя ручка `/iv` плоскими блоками, вход — `webPage.has_iv` на карточке
// ссылки. Значит `safe` истинным не бывает, подмена не портирована, а действие
// `tg_iv` снимается — ровно то, что оригинал отдаёт на любом возможном у нас вводе.
//
// Ввод здесь ЗЛОЙ: `tg://iv?url=…` приходит из чужого сообщения (`tg:` разрешён
// и бэкендом — `usecase/chat/sanitize.go`, и `@core/safeUrl`), то есть отправитель
// управляет тем, что лежит в `?url=`.
import { describe, it, expect } from 'vitest'
import { safeWrapUrl, wrapUrl } from './url'

// Каждый payload — то, куда увела бы ссылка, если бы подмену портировали.
const EVIL_PAYLOADS = {
  'javascript:': 'javascript:alert(document.cookie)',
  'JAVASCRIPT: в другом регистре': 'JaVaScRiPt:alert(1)',
  'data:': 'data:text/html,<script>alert(1)</script>',
  'blob:': 'blob:https://evil.example/1',
  'относительный адрес': '/settings?steal=1',
  'вложение второго уровня': 'tg://iv?url=' + encodeURIComponent('javascript:alert(1)'),
}

describe('tg://iv — подмена адреса не портирована', () => {
  it('адрес остаётся исходным, действия нет (даже у безобидного https)', () => {
    const url = 'tg://iv?url=' + encodeURIComponent('https://example.com/article')

    expect(wrapUrl(url)).toEqual({ url, action: undefined })
  })

  for (const [name, payload] of Object.entries(EVIL_PAYLOADS)) {
    it(`ЗЛОЙ ввод (${name}) не становится адресом ссылки`, () => {
      const url = 'tg://iv?url=' + encodeURIComponent(payload)
      const wrapped = safeWrapUrl(url)!

      expect(wrapped.url).toBe(url)
      expect(wrapped.url).not.toContain(payload)
      expect(wrapped.action).toBeUndefined()
    })
  }

  it('незакодированный payload в `?url=` — тоже мимо', () => {
    const url = 'tg://iv?url=javascript:alert(1)'
    const wrapped = safeWrapUrl(url)!

    // адрес анкера — сам `tg:`-линк целиком; `javascript:` в нём остаётся ЗНАЧЕНИЕМ
    // параметра, а не схемой ссылки, и браузер его не исполняет
    expect(wrapped.url).toBe(url)
    expect(wrapped.url.startsWith('tg://')).toBe(true)
    expect(wrapped.action).toBeUndefined()
  })

  it('под гейт попадает и `tg://iv/…` без запроса (в оригинале там живёт `tg_iv`)', () => {
    expect(wrapUrl('tg://iv/foo').action).toBeUndefined()
    expect(wrapUrl('tg://iv/foo?url=' + encodeURIComponent('javascript:alert(1)')).action).toBeUndefined()
  })
})

describe('allow-list схем — второй рубеж, если адрес всё же подменят', () => {
  it('payload, поданный ссылкой напрямую, отбрасывается', () => {
    for (const payload of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'blob:https://e/1']) {
      expect(safeWrapUrl(payload)).toBeUndefined()
    }
  })

  it('ОТНОСИТЕЛЬНЫЙ адрес allow-list НЕ отбрасывает — поэтому подмену и не портируем', () => {
    // `@core/safeUrl` пропускает адреса без схемы (это его правило, не оплошность),
    // а `wrapUrl` дописывает им `https://`. Разверни мы `?url=/settings`, вышло бы
    // `https:///settings?steal=1` — allow-list такое пропускает, второй рубеж не
    // сработал бы. Единственная защита здесь — отсутствие подмены.
    expect(safeWrapUrl('/settings?steal=1')).toEqual({ url: 'https:///settings?steal=1', action: undefined })
  })
})

describe('остальные ветки wrapUrl не задеты', () => {
  it('прочие tg-ссылки сохраняют действие', () => {
    expect(wrapUrl('tg://resolve?domain=durov').action).toBe('tg_resolve')
    expect(wrapUrl('tg://settings').action).toBe('tg_settings')
  })

  it('t.me и обычный https — как раньше', () => {
    expect(wrapUrl('https://t.me/durov').action).toBe('im')
    expect(wrapUrl('t.me/joinchat/abc').action).toBe('joinchat')
    expect(wrapUrl('example.com')).toEqual({ url: 'https://example.com', action: undefined })
  })
})
