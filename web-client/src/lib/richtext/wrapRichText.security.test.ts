// Периметр безопасности ванильного rich-text.
//
// Правило `web-client/CLAUDE.md`: пользовательский контент НИКОГДА не рендерится
// сырой HTML-строкой, ссылки — только по allow-list схем (`@core/safeUrl`).
// В оригинале (tweb `wrapRichText.ts`) есть СЕМЬ мест, которые этому правилу
// противоречат; здесь по тесту на каждое — плюс подстановка пути в src эмодзи.
//
// Смысл первого блока перенесён из `components/RichText.security.test.ts`
// (React-версия жива и не трогается), остальное — новое.
import { describe, it, expect } from 'vitest'
import type { MessageEntity } from '@core/models'
import { wrapMessageText, wrapRichText, encodeEmoji, isSafeEmojiUnicode } from './index'

const render = (text: string, entities?: MessageEntity[], options = {}) => {
  const host = document.createElement('div')
  host.append(wrapMessageText(text, entities, options))
  return host
}

const allElements = (host: HTMLElement) => [...host.querySelectorAll('*')]

describe('#5 схемы ссылок — allow-list, а не «запрещён только javascript:» как в tweb', () => {
  it('javascript: не становится href анкера', () => {
    const host = render('click me', [
      { _: 'messageEntityTextUrl', offset: 0, length: 8, url: 'javascript:alert(document.cookie)' },
    ])

    expect([...host.querySelectorAll('a')].some((el) => /javascript:/i.test(el.getAttribute('href') || ''))).toBe(false)
    expect(host.textContent).toBe('click me')
  })

  it('data:, blob:, file:, vbscript:, JAVASCRIPT: — анкера нет вовсе, остаётся span.anchor-url', () => {
    for (const url of [
      'data:text/html,<script>alert(1)</script>',
      'blob:https://evil.example/1',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'JAVASCRIPT:alert(1)',
    ]) {
      const host = render('x', [{ _: 'messageEntityTextUrl', offset: 0, length: 1, url }])

      expect(host.querySelector('a')).toBeNull()
      // фолбэк — тот же, что у React-версии (RichText.tsx:80-83): текст в span с классом ссылки
      expect(host.querySelector('span.anchor-url')?.textContent).toBe('x')
    }
  })

  it('схема проверяется ДО дописывания https:// (иначе javascript: «отмылся» бы в https://javascript:…)', () => {
    const host = render('x', [{ _: 'messageEntityTextUrl', offset: 0, length: 1, url: 'javascript:alert(1)' }])

    expect(host.querySelector('a')).toBeNull()
    expect(host.innerHTML).not.toContain('javascript')
  })

  it('обычная https-ссылка кликабельна', () => {
    const host = render('site', [
      { _: 'messageEntityTextUrl', offset: 0, length: 4, url: 'https://example.com' },
    ])

    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  })
})

describe('#1 подсветка кода — токенами, а не innerHTML', () => {
  it('разметка внутри блока кода остаётся текстом (без подсветки)', () => {
    const host = render('<img src=x onerror=alert(1)>', [
      { _: 'messageEntityPre', offset: 0, length: 28, language: 'txt' },
    ])

    const code = host.querySelector('code.code-code')!
    expect(code.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(host.querySelector('img')).toBeNull()
  })

  it('и после того, как доедет prism: подсветка кладёт только span.token', async () => {
    const code = '<img src=x onerror="alert(1)">'
    const loadPromises: Promise<unknown>[] = []
    const host = render(code, [{ _: 'messageEntityPre', offset: 0, length: code.length, language: 'html' }], { loadPromises })

    expect(loadPromises.length).toBe(1)
    await Promise.all(loadPromises)

    const codeEl = host.querySelector('code.code-code')!
    expect(codeEl.textContent).toBe(code)
    expect(host.querySelector('img')).toBeNull()
    // подсветка реально отработала — появились токены, и это только <span>
    const tags = new Set([...codeEl.querySelectorAll('*')].map((el) => el.tagName))
    expect(tags.size).toBeGreaterThan(0)
    expect([...tags]).toEqual(['SPAN'])
  })

  it('устаревший middleware отменяет запись в DOM', async () => {
    const code = 'const a = 1'
    const loadPromises: Promise<unknown>[] = []
    const host = render(code, [{ _: 'messageEntityPre', offset: 0, length: code.length, language: 'js' }], {
      loadPromises,
      middleware: () => false,
    })
    await Promise.all(loadPromises)

    const codeEl = host.querySelector('code.code-code')!
    expect(codeEl.querySelectorAll('span.token').length).toBe(0)
    expect(codeEl.textContent).toBe(code)
  })
})

describe('#2 спойлер — без createElementFromMarkup (bluff-спойлер не портирован)', () => {
  it('текст спойлера кладётся textContent, разметка внутри не парсится', () => {
    const text = '<b>bold</b>'
    const host = render(text, [{ _: 'messageEntitySpoiler', offset: 0, length: text.length }])

    const spoilerText = host.querySelector('.spoiler > .spoiler-text')!
    expect(spoilerText.textContent).toBe(text)
    expect(host.querySelector('b')).toBeNull()
    // по букве на span (bluff-spoiler-letter) мы не режем
    expect(host.querySelector('.bluff-spoiler')).toBeNull()
  })
})

describe('#3 никаких inline-обработчиков: действия — в data-anchor-action', () => {
  it('ни у одного элемента нет атрибута onclick', () => {
    const host = render('t.me/durov/1 и #tag и @username1 и https://example.com', [])

    for (const el of allElements(host)) {
      expect(el.getAttribute('onclick')).toBeNull()
      for (const attr of el.getAttributeNames()) {
        expect(attr.startsWith('on')).toBe(false)
      }
    }
  })

  it('внутренняя t.me-ссылка несёт действие в data-anchor-action (tweb ставил onclick="im(this)")', () => {
    const host = render('@username1')

    const a = host.querySelector('a.mention')!
    expect(a.getAttribute('data-anchor-action')).toBe('im')
    expect(a.getAttribute('onclick')).toBeNull()
  })

  it('хэштег несёт searchByHashtag тем же способом', () => {
    const host = render('#tag')

    expect(host.querySelector('a.anchor-hashtag')?.getAttribute('data-anchor-action')).toBe('searchByHashtag')
  })
})

describe('#4 electron-ветка не портирована', () => {
  it('href никогда не начинается с javascript: — даже когда ссылка внутренняя', () => {
    const host = render('t.me/durov/1 https://example.com', [])

    for (const a of host.querySelectorAll('a')) {
      expect(a.getAttribute('href')?.startsWith('javascript:')).toBe(false)
    }
  })
})

describe('#6 mailto/tel — конкатенация + allow-list, без encodeEntities', () => {
  it('адрес не искажается HTML-энкодером', () => {
    const host = render('пиши на user@example.com')

    const a = host.querySelector('a[href^="mailto:"]')!
    // tweb здесь зовёт encodeEntities('mailto:' + text): HTML-энкодер на DOM-свойстве
    // ничего не защищает, зато превращает адрес в &amp;-мусор
    expect(a.getAttribute('href')).toBe('mailto:user@example.com')
    expect(a.getAttribute('href')).not.toContain('&')
  })
})

describe('#7 модуль не вешает глобаль', () => {
  it('window.wrapRichText не определён', () => {
    expect((window as unknown as { wrapRichText?: unknown }).wrapRichText).toBeUndefined()
  })
})

describe('img.src эмодзи — только численные кодпоинты (path injection)', () => {
  it('encodeEmoji возвращает исключительно hex и дефисы', () => {
    for (const emoji of ['😀', '👨‍👩‍👧', '❤️', '🇷🇺']) {
      expect(encodeEmoji(emoji)).toMatch(/^[0-9a-f-]+$/)
      expect(isSafeEmojiUnicode(encodeEmoji(emoji))).toBe(true)
    }
  })

  it('подделанный unicode в сущности не доходит до src — остаётся span.emoji-native', () => {
    const host = document.createElement('div')
    host.append(wrapRichText('😀', {
      entities: [{ _: 'messageEntityEmoji', offset: 0, length: 2, unicode: '../../../evil' }],
    }))

    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('span.emoji.emoji-native')?.textContent).toBe('😀')
    expect(isSafeEmojiUnicode('../../../evil')).toBe(false)
  })
})
