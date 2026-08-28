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
import type { MessageEntity } from '@layer'
import { wrapMessageText, wrapRichText, MAX_ENTITIES } from './index'

const render = (text: string, entities?: MessageEntity[]) => {
  const host = document.createElement('div')
  host.append(wrapMessageText(text, entities))
  return host
}

describe('wrapRichText — семантические теги форматирования', () => {
  it('bold → <strong>, italic → <em>, underline → <u>, strike → <del>', () => {
    const host = render('bius', [
      { _: 'messageEntityBold', offset: 0, length: 1 },
      { _: 'messageEntityItalic', offset: 1, length: 1 },
      { _: 'messageEntityUnderline', offset: 2, length: 1 },
      { _: 'messageEntityStrike', offset: 3, length: 1 },
    ])

    expect(host.querySelector('strong')?.textContent).toBe('b')
    expect(host.querySelector('em')?.textContent).toBe('i')
    expect(host.querySelector('u')?.textContent).toBe('u')
    expect(host.querySelector('del')?.textContent).toBe('s')
  })

  it('инлайновый code → code.monospace-text (в tweb code-code только внутри pre)', () => {
    const host = render('a code b', [{ _: 'messageEntityCode', offset: 2, length: 4 }])

    const code = host.querySelector('code')
    expect(code?.className).toBe('monospace-text')
    expect(code?.textContent).toBe('code')
  })

  it('text_link — a.anchor-url, вложенный bold остаётся <strong> ВНУТРИ ссылки', () => {
    const host = render('СТАТЬЯ', [
      { _: 'messageEntityTextUrl', offset: 0, length: 6, url: 'https://example.com/a' },
      { _: 'messageEntityBold', offset: 0, length: 6 },
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
      { _: 'messageEntityTextUrl', offset: 0, length: 10, url: 'https://example.com/a' },
      { _: 'messageEntityBold', offset: 5, length: 10 },
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
    const host = render('a bold b', [{ _: 'messageEntityBold', offset: 2, length: 4 }])

    expect(host.textContent).toBe('a bold b')
    // текст до, <strong>, текст после — ровно три узла, без обёрток
    expect(host.childNodes.length).toBe(3)
    expect(host.childNodes[0].textContent).toBe('a ')
    expect((host.childNodes[1] as HTMLElement).tagName).toBe('STRONG')
    expect(host.childNodes[2].textContent).toBe(' b')
  })

  it('три уровня вложенности сохраняются как вложенные элементы', () => {
    const host = render('текст', [
      { _: 'messageEntityTextUrl', offset: 0, length: 5, url: 'https://example.com' },
      { _: 'messageEntityBold', offset: 0, length: 5 },
      { _: 'messageEntityItalic', offset: 0, length: 5 },
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
      { _: 'messageEntityPre', offset: 3, length: 11, language: 'js' },
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
    const host = render('a\nquote\nb', [{ _: 'messageEntityBlockquote', pFlags: {}, offset: 2, length: 5 }])

    const quote = host.querySelector('blockquote')
    expect(quote?.className).toBe('quote quote-block quote-like quote-like-border quote-like-icon')
    expect(quote?.getAttribute('dir')).toBe('auto')
    expect(quote?.textContent).toBe('quote')
    expect(quote?.parentElement?.tagName).toBe('DIV')
  })
})

describe('wrapRichText — кастомные эмодзи', () => {
  it('custom_emoji → плейсхолдер <custom-emoji-element> c data-doc-id и fallback-глифом', () => {
    const host = render('hi 😎', [{ _: 'messageEntityCustomEmoji', offset: 3, length: 2, document_id: 42 }])

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
      _: 'messageEntityBold' as const, offset: i, length: 1,
    }))

    const host = document.createElement('div')
    host.append(wrapRichText(text, { entities }))

    expect(host.querySelectorAll('strong').length).toBe(MAX_ENTITIES)
    // текст при этом не теряется
    expect(host.textContent).toBe(text)
  })
})

// Таблица «конструктор схемы → элемент DOM». Держит ГЛАВНОЕ, что может молча
// разъехаться при переводе сущностей на TL: ветвление идёт по дискриминатору `_`
// (`switch (entity._)`, tweb wrapRichText.ts:190), и каждый конструктор обязан
// попадать ровно в свою ветку. Опечатка в имени конструктора ловится тайпчеком
// (`case` не сравним с объединением), а вот перепутанные местами ветки — только
// здесь. Строки таблицы перечислены в порядке веток оригинала.
describe('wrapRichText — ветвление по дискриминатору `_`', () => {
  const CASES: { name: string; text: string; entity: MessageEntity; selector: string }[] = [
    { name: 'messageEntityBold', text: 'x', entity: { _: 'messageEntityBold', offset: 0, length: 1 }, selector: 'strong' },
    { name: 'messageEntityItalic', text: 'x', entity: { _: 'messageEntityItalic', offset: 0, length: 1 }, selector: 'em' },
    { name: 'messageEntityStrike', text: 'x', entity: { _: 'messageEntityStrike', offset: 0, length: 1 }, selector: 'del' },
    { name: 'messageEntityUnderline', text: 'x', entity: { _: 'messageEntityUnderline', offset: 0, length: 1 }, selector: 'u' },
    { name: 'messageEntityCode', text: 'x', entity: { _: 'messageEntityCode', offset: 0, length: 1 }, selector: 'code.monospace-text' },
    { name: 'messageEntityPre', text: 'x', entity: { _: 'messageEntityPre', offset: 0, length: 1, language: '' }, selector: 'pre.code > .code-content > code.code-code' },
    { name: 'messageEntityCustomEmoji', text: '😎', entity: { _: 'messageEntityCustomEmoji', offset: 0, length: 2, document_id: 7 }, selector: 'custom-emoji-element.custom-emoji' },
    { name: 'messageEntityUrl', text: 'https://example.com', entity: { _: 'messageEntityUrl', offset: 0, length: 19 }, selector: 'a.anchor-url' },
    { name: 'messageEntityTextUrl', text: 'x', entity: { _: 'messageEntityTextUrl', offset: 0, length: 1, url: 'https://example.com' }, selector: 'a.anchor-url' },
    { name: 'messageEntityEmail', text: 'user@example.com', entity: { _: 'messageEntityEmail', offset: 0, length: 16 }, selector: 'a[href="mailto:user@example.com"]' },
    { name: 'messageEntityHashtag', text: '#abc', entity: { _: 'messageEntityHashtag', offset: 0, length: 4 }, selector: 'a.anchor-hashtag' },
    { name: 'messageEntityMentionName', text: 'Иван', entity: { _: 'messageEntityMentionName', offset: 0, length: 4, user_id: 77 }, selector: 'a.follow[data-follow="77"]' },
    { name: 'messageEntityMention', text: '@durov', entity: { _: 'messageEntityMention', offset: 0, length: 6 }, selector: 'a.mention' },
    { name: 'messageEntitySpoiler', text: 'секрет', entity: { _: 'messageEntitySpoiler', offset: 0, length: 6 }, selector: 'span.spoiler > span.spoiler-text' },
    { name: 'messageEntityBlockquote', text: 'цитата', entity: { _: 'messageEntityBlockquote', pFlags: {}, offset: 0, length: 6 }, selector: 'blockquote.quote.quote-block' },
  ]

  for (const { name, text, entity, selector } of CASES) {
    it(`${name} → ${selector}`, () => {
      const host = document.createElement('div')
      host.append(wrapRichText(text, { entities: [entity] }))

      expect(host.querySelector(selector), name).not.toBeNull()
    })
  }

  // Служебная сущность перевода строки собственного элемента не порождает
  // (tweb :523-545: ветка только «съедает» текст рядом с блочной сущностью).
  it('messageEntityLinebreak элемента не создаёт, текст остаётся текстом', () => {
    const host = document.createElement('div')
    host.append(wrapRichText('a\nb', { entities: [{ _: 'messageEntityLinebreak', offset: 1, length: 1 }] }))

    expect(host.querySelectorAll('*').length).toBe(0)
    expect(host.textContent).toBe('a\nb')
  })
})
