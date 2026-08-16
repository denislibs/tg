// DOM разметки сообщения — 1:1 с tweb.
//
// Эталон — живой дамп поста канала `docs/tweb/dom/dumps/20-channel-01-post-formatted.json`
// (снят с web.telegram.org/k) и `tweb/src/lib/richTextProcessor/wrapRichText.ts`:
//
//   strong "Голова"                                   ← messageEntityBold (215-221)
//   a.anchor-url[href] > strong "ПЕРЕЙТИ В СТАТЬЮ"     ← messageEntityTextUrl (601-603)
//   a.mention[href]    "@dollhouse_manager2"           ← messageEntityMention (660-663)
//   a.anchor-hashtag[href="tg://search_hashtag?…"]     ← messageEntityHashtag (627-636)
//
// До порта bold был инлайновым `font-weight: 600` на `<span>`, а ссылки/хэштеги —
// модульными классами: визуально похоже, но DOM расходился с tweb, и вес шрифта
// не наследовался от темы.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import RichText from './RichText'
import type { MessageEntity } from '../core/models'

afterEach(cleanup)

describe('RichText — семантические теги форматирования (tweb wrapRichText)', () => {
  it('bold → <strong>, italic → <em>, underline → <u>, strike → <del>', () => {
    const ents: MessageEntity[] = [
      { type: 'bold', offset: 0, length: 1 },
      { type: 'italic', offset: 1, length: 1 },
      { type: 'underline', offset: 2, length: 1 },
      { type: 'strikethrough', offset: 3, length: 1 },
    ]
    const { container } = render(<RichText text="bius" entities={ents} linkColor="var(--link-color)" />)

    expect(container.querySelector('strong')?.textContent).toBe('b')
    expect(container.querySelector('em')?.textContent).toBe('i')
    expect(container.querySelector('u')?.textContent).toBe('u')
    expect(container.querySelector('del')?.textContent).toBe('s')
  })

  it('text_link — a.anchor-url, а вложенный bold остаётся <strong> внутри ссылки', () => {
    const ents: MessageEntity[] = [
      { type: 'text_link', offset: 0, length: 6, url: 'https://example.com/a' },
      { type: 'bold', offset: 0, length: 6 },
    ]
    const { container } = render(<RichText text="СТАТЬЯ" entities={ents} linkColor="var(--link-color)" />)

    const a = container.querySelector('a.anchor-url')
    expect(a).not.toBeNull()
    expect(a!.getAttribute('href')).toBe('https://example.com/a')
    // в дампе именно так: a.anchor-url > strong
    expect(container.querySelector('strong')).not.toBeNull()
  })
})

describe('RichText — автолинковка plain-текста (классы и href из tweb)', () => {
  it('@упоминание → a.mention на t.me', () => {
    const { container } = render(<RichText text="Купить: @dollhouse_manager2" linkColor="var(--link-color)" />)
    const a = container.querySelector('a.mention')

    expect(a?.textContent).toBe('@dollhouse_manager2')
    expect(a?.getAttribute('href')).toBe('https://t.me/dollhouse_manager2')
  })

  it('#хэштег → a.anchor-hashtag на tg://search_hashtag', () => {
    const { container } = render(<RichText text="#силикон" linkColor="var(--link-color)" />)
    const a = container.querySelector('a.anchor-hashtag')

    expect(a?.textContent).toBe('#силикон')
    expect(a?.getAttribute('href')).toBe(`tg://search_hashtag?hashtag=${encodeURIComponent('силикон')}`)
  })

  it('голый URL → a.anchor-url', () => {
    const { container } = render(<RichText text="см. https://example.com/x" linkColor="var(--link-color)" />)

    expect(container.querySelector('a.anchor-url')?.getAttribute('href')).toBe('https://example.com/x')
  })
})
