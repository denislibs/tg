// DOM разметки текста сообщения — 1:1 с tweb `lib/richTextProcessor/wrapRichText.ts`.
//
// Эталон — исходники tweb и живой дамп поста канала
// `docs/tweb/dom/dumps/20-channel-01-post-formatted.json`:
//
//   strong "Голова"                                   ← messageEntityBold (:215-221)
//   a.anchor-url[href] > strong "ПЕРЕЙТИ В СТАТЬЮ"     ← messageEntityTextUrl (:601-603)
//   a.mention[href]    "@dollhouse_manager2"           ← messageEntityMention (:660-663)
//   a.anchor-hashtag[href="tg://search_hashtag?…"]     ← messageEntityHashtag (:627-636)
//
// Смысл тестов перенесён из `components/RichText.tweb.test.tsx` (React-версия ещё
// жива и не трогается) + добавлено главное, чего та схема не умела: пересекающиеся
// сущности дают ОДИН элемент с вложением, а не два одинаковых.
import { describe, it, expect } from 'vitest'
import type { MessageEntity } from '@core/models'
import { wrapMessageText, wrapRichText, MAX_ENTITIES } from './index'

const render = (text: string, entities?: MessageEntity[]) => {
  const host = document.createElement('div')
  host.append(wrapMessageText(text, entities))
  return host
}

describe('wrapRichText — семантические теги форматирования', () => {
  it('bold → <strong>, italic → <em>, underline → <u>, strike → <del>', () => {
    const host = render('bius', [
      { type: 'bold', offset: 0, length: 1 },
      { type: 'italic', offset: 1, length: 1 },
      { type: 'underline', offset: 2, length: 1 },
      { type: 'strikethrough', offset: 3, length: 1 },
    ])

    expect(host.querySelector('strong')?.textContent).toBe('b')
    expect(host.querySelector('em')?.textContent).toBe('i')
    expect(host.querySelector('u')?.textContent).toBe('u')
    expect(host.querySelector('del')?.textContent).toBe('s')
  })

  it('инлайновый code → code.monospace-text (в tweb code-code только внутри pre)', () => {
    const host = render('a code b', [{ type: 'code', offset: 2, length: 4 }])

    const code = host.querySelector('code')
    expect(code?.className).toBe('monospace-text')
    expect(code?.textContent).toBe('code')
  })

  it('text_link — a.anchor-url, вложенный bold остаётся <strong> ВНУТРИ ссылки', () => {
    const host = render('СТАТЬЯ', [
      { type: 'text_link', offset: 0, length: 6, url: 'https://example.com/a' },
      { type: 'bold', offset: 0, length: 6 },
    ])

    const a = host.querySelector('a.anchor-url')
    expect(a?.getAttribute('href')).toBe('https://example.com/a')
    expect(a?.querySelector('strong')?.textContent).toBe('СТАТЬЯ')
    expect(host.querySelectorAll('a').length).toBe(1)
  })
})

describe('wrapRichText — однопроходная схема с рекурсией (главное отличие от React-версии)', () => {
  it('пересекающиеся сущности дают ОДИН элемент с вложением, а не два одинаковых', () => {
    // ссылка 0..10 и жирный 5..15 пересекаются: плоская нарезка по всем границам
    // (components/RichText.tsx:159-184) дала бы ДВЕ <a class="anchor-url">
    const host = render('0123456789abcdefghij', [
      { type: 'text_link', offset: 0, length: 10, url: 'https://example.com/a' },
      { type: 'bold', offset: 5, length: 10 },
    ])

    const anchors = host.querySelectorAll('a.anchor-url')
    expect(anchors.length).toBe(1)

    const strongs = anchors[0].querySelectorAll('strong')
    expect(strongs.length).toBe(1)
    expect(strongs[0].textContent).toBe('56789abcde')
    expect(host.textContent).toBe('0123456789abcdefghij')
  })

  it('вложенные сущности не плодят <span> на каждый прогон: голый текст — один текстовый узел', () => {
    const host = render('просто текст без сущностей')

    expect(host.childNodes.length).toBe(1)
    expect(host.firstChild?.nodeType).toBe(Node.TEXT_NODE)
    expect(host.querySelectorAll('span').length).toBe(0)
  })

  it('дыры между сущностями доливаются текстом, и fragment.normalize() их склеивает', () => {
    const host = render('a bold b', [{ type: 'bold', offset: 2, length: 4 }])

    expect(host.textContent).toBe('a bold b')
    // текст до, <strong>, текст после — ровно три узла, без обёрток
    expect(host.childNodes.length).toBe(3)
    expect(host.childNodes[0].textContent).toBe('a ')
    expect((host.childNodes[1] as HTMLElement).tagName).toBe('STRONG')
    expect(host.childNodes[2].textContent).toBe(' b')
  })

  it('три уровня вложенности сохраняются как вложенные элементы', () => {
    const host = render('текст', [
      { type: 'text_link', offset: 0, length: 5, url: 'https://example.com' },
      { type: 'bold', offset: 0, length: 5 },
      { type: 'italic', offset: 0, length: 5 },
    ])

    expect(host.querySelector('a.anchor-url > strong > em')?.textContent).toBe('текст')
  })
})

describe('wrapRichText — автолинковка plain-текста (parseEntities + классы tweb)', () => {
  it('@упоминание → a.mention на t.me', () => {
    const host = render('Купить: @dollhouse_manager2')
    const a = host.querySelector('a.mention')

    expect(a?.textContent).toBe('@dollhouse_manager2')
    expect(a?.getAttribute('href')).toBe('https://t.me/dollhouse_manager2')
  })

  it('#хэштег → a.anchor-hashtag на tg://search_hashtag', () => {
    const host = render('#силикон')
    const a = host.querySelector('a.anchor-hashtag')

    expect(a?.textContent).toBe('#силикон')
    expect(a?.getAttribute('href')).toBe(`tg://search_hashtag?hashtag=${encodeURIComponent('силикон')}`)
  })

  it('голый URL → a.anchor-url c target=_blank', () => {
    const host = render('см. https://example.com/x')
    const a = host.querySelector('a.anchor-url')

    expect(a?.getAttribute('href')).toBe('https://example.com/x')
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('домен без схемы линкуется по списку TLD (tweb parseEntities)', () => {
    const host = render('заходи на example.com сегодня')

    expect(host.querySelector('a.anchor-url')?.getAttribute('href')).toBe('https://example.com')
  })

  it('перевод строки остаётся текстом (в бабле его рисует white-space: pre-wrap)', () => {
    const host = render('a\nb')

    expect(host.textContent).toBe('a\nb')
    expect(host.querySelector('br')).toBeNull()
  })
})

describe('wrapRichText — блочные сущности', () => {
  it('pre → pre.quote-like.code > .code-header + .code-content > code.code-code', () => {
    const host = render('до\nconst a = 1\nпосле', [
      { type: 'pre', offset: 3, length: 11, language: 'js' },
    ])

    const container = host.querySelector('pre.quote-like.quote-like-border.code')
    expect(container).not.toBeNull()
    expect(container!.querySelector('.code-header > .code-header-name')?.textContent).toBe('JavaScript')
    expect(container!.querySelector('.code-header .code-header-copy')).not.toBeNull()
    expect(container!.querySelector('.code-content > code.code-code')?.textContent).toBe('const a = 1')
    // остальной текст сообщения остаётся снаружи блока
    expect(host.textContent).toContain('до')
    expect(host.textContent).toContain('после')
  })

  it('blockquote → blockquote.quote.quote-block.quote-like… c dir="auto", завёрнутый в <div>', () => {
    const host = render('a\nquote\nb', [{ type: 'blockquote', offset: 2, length: 5 }])

    const quote = host.querySelector('blockquote')
    expect(quote?.className).toBe('quote quote-block quote-like quote-like-border quote-like-icon')
    expect(quote?.getAttribute('dir')).toBe('auto')
    expect(quote?.textContent).toBe('quote')
    expect(quote?.parentElement?.tagName).toBe('DIV')
  })
})

describe('wrapRichText — кастомные эмодзи', () => {
  it('custom_emoji → плейсхолдер <custom-emoji-element> c data-doc-id и fallback-глифом', () => {
    const host = render('hi 😎', [{ type: 'custom_emoji', offset: 3, length: 2, document_id: 42 }])

    const el = host.querySelector('custom-emoji-element')
    expect(el?.classList.contains('custom-emoji')).toBe(true)
    expect((el as HTMLElement).dataset.docId).toBe('42')
    expect((el as HTMLElement).dataset.stickerEmoji).toBe('😎')
    expect(el?.textContent).toBe('😎')
  })
})

describe('wrapRichText — кап на число сущностей', () => {
  it('обрабатываются только первые MAX_ENTITIES сущностей', () => {
    const text = 'x'.repeat(MAX_ENTITIES + 50)
    const entities: MessageEntity[] = Array.from({ length: MAX_ENTITIES + 50 }, (_, i) => ({
      type: 'bold' as const, offset: i, length: 1,
    }))

    const host = document.createElement('div')
    host.append(wrapRichText(text, { entities }))

    expect(host.querySelectorAll('strong').length).toBe(MAX_ENTITIES)
    // текст при этом не теряется
    expect(host.textContent).toBe(text)
  })
})
