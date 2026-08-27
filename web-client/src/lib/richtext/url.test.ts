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
import type { MessageEntity } from '@core/models'
import { KNOWN_ANCHOR_ACTIONS, safeWrapUrl, wrapUrl } from './url'
import { wrapMessageText } from './index'

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

// ─────────────────────────────────────────────────────────────────────────────
// Задача #95. Порт tweb `wrapUrl.ts:86-88`:
//   `if(!(window as any)[onclick]) { onclick = undefined; }`
// Оригинал снимает действие, для которого нет зарегистрированного обработчика
// (`addAnchorListener` кладёт его в `window[protocol_ + name]`,
// `helpers/addAnchorListener.ts:58`). Без этой проверки имя действия для
// `tg:`-ссылок целиком под контролем ОТПРАВИТЕЛЯ: оно собирается конкатенацией
// (`wrapUrl.ts:65`), а схема `tg:` разрешена и бэком, и `@core/safeUrl`.

/** По одному адресу на каждое действие, которое эмитит сам `wrapUrl`. */
const EMITTED_BY_WRAP_URL: Record<string, string> = {
  im: 'https://t.me/durov',
  invoice: 't.me/invoice/abc',
  joinchat: 't.me/joinchat/abc',
  m: 't.me/m/abc',
  addlist: 't.me/addlist/abc',
  addstickers: 't.me/addstickers/abc',
  addemoji: 't.me/addemoji/abc',
  call: 't.me/call/abc',
  boost: 't.me/boost/abc',
  giftcode: 't.me/giftcode/abc',
  share: 't.me/share/url?url=https%3A%2F%2Fexample.com',
  nft: 't.me/nft/abc',
  addstyle: 't.me/addstyle/abc',
}

/** Оба оставшихся имени ставит `wrapRichText`, минуя `wrapUrl`, — берём их с готового DOM. */
const anchorActionsInDom = (text: string, entities?: MessageEntity[]) => {
  const host = document.createElement('div')
  host.append(wrapMessageText(text, entities))
  return [...host.querySelectorAll('[data-anchor-action]')]
    .map((el) => el.getAttribute('data-anchor-action')!)
}

describe('#95 действие — только из реестра, а не из самой ссылки', () => {
  for (const [action, url] of Object.entries(EMITTED_BY_WRAP_URL)) {
    it(`известное действие проходит: ${url} → ${action}`, () => {
      expect(wrapUrl(url).action).toBe(action)
    })
  }

  const SENDER_INVENTED = [
    'tg://evilaction?url=https%3A%2F%2Fevil.example',
    'tg://evilaction/sub?x=1',
    'tg://EVILACTION', // регистр имени тоже не спасает
    'tg://resolve?domain=durov', // зарегистрировано у tweb (`internalLinkProcessor.ts:404-405`), но исполнителя нет у нас
    'tg://settings', // то же самое (`:717-718`)
    'tg://iv?url=' + encodeURIComponent('javascript:alert(1)'), // задача #33 — теперь под общим гейтом
  ]

  for (const url of SENDER_INVENTED) {
    it(`выдуманное отправителем действие отбрасывается, адрес остаётся: ${url}`, () => {
      const wrapped = wrapUrl(url)

      expect(wrapped.action).toBeUndefined()
      // ссылка остаётся ссылкой: адрес не тронут и не подменён
      expect(wrapped.url).toBe(url)
    })
  }

  it('`t.me/voicechat/…` действия не получает — его снимает и гейт ОРИГИНАЛА', () => {
    // `voicechat` есть в `switch` оригинала (`wrapUrl.ts:41`) и в нашем
    // `T_ME_ACTION_PATHS`, но обработчик у tweb зарегистрирован ТОЛЬКО с
    // протоколом — `tg://voicechat` (`internalLinkProcessor.ts:216-217`).
    // Значит `window.voicechat` не существует и `wrapUrl.ts:86-88` действие
    // снимает. Наш реестр повторяет это: имени в нём нет.
    expect(wrapUrl('t.me/voicechat/abc').action).toBeUndefined()
  })

  it('в реестре нет мёртвых записей: он равен множеству имён, которые эмитит наш код', () => {
    const emitted = new Set<string>()

    for (const url of Object.values(EMITTED_BY_WRAP_URL)) {
      const { action } = wrapUrl(url)
      if (action) emitted.add(action)
    }

    // `searchByHashtag` — `wrapRichText.ts:417`
    for (const action of anchorActionsInDom('#tag')) emitted.add(action)
    // `showMaskedAlert` — `wrapRichText.ts:377` (адрес не совпал с текстом)
    for (const action of anchorActionsInDom('статья', [
      { _: 'messageEntityTextUrl', offset: 0, length: 6, url: 'https://example.com/a' },
    ])) emitted.add(action)

    expect([...emitted].sort()).toEqual([...KNOWN_ANCHOR_ACTIONS].sort())
  })
})

describe('остальные ветки wrapUrl не задеты', () => {
  it('t.me и обычный https — как раньше', () => {
    expect(wrapUrl('https://t.me/durov').action).toBe('im')
    expect(wrapUrl('t.me/joinchat/abc').action).toBe('joinchat')
    expect(wrapUrl('example.com')).toEqual({ url: 'https://example.com', action: undefined })
  })
})
