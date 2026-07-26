// Читалка Instant View: блоки рендерятся React-нодами; img с не-http(s) src
// (javascript:) не рендерится вовсе; Esc закрывает.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import InstantView from './InstantView'
import type { IVArticle } from '../core/managers/ivManager'

const article: IVArticle = {
  title: 'Заголовок статьи',
  byline: 'Иван Автор',
  site_name: 'Example',
  blocks: [
    { type: 'p', text: 'Первый абзац.' },
    { type: 'h2', text: 'Подзаголовок' },
    { type: 'blockquote', text: 'Цитата из статьи' },
    { type: 'pre', text: 'const x = 1' },
    { type: 'ul', items: ['один', 'два'] },
    { type: 'ol', items: ['раз'] },
    { type: 'img', src: 'https://example.com/pic.png' },
    { type: 'img', src: 'javascript:alert(1)' }, // клиентский гейт: не рендерится
  ],
}

describe('InstantView', () => {
  afterEach(cleanup)

  it('рендерит блоки статьи React-нодами', () => {
    const { baseElement } = render(
      <InstantView url="https://example.com/a" article={article} onClose={() => {}} />,
    )
    expect(screen.getByText('Заголовок статьи')).toBeTruthy()
    expect(screen.getByText('Иван Автор')).toBeTruthy()
    expect(screen.getByText('Первый абзац.')).toBeTruthy()
    expect(screen.getByText('Подзаголовок').tagName).toBe('H2')
    expect(screen.getByText('Цитата из статьи').tagName).toBe('BLOCKQUOTE')
    expect(screen.getByText('const x = 1').tagName).toBe('PRE')
    expect(screen.getByText('один').tagName).toBe('LI')
    expect(screen.getByText('раз').tagName).toBe('LI')
    // домен в шапке + ссылка «Открыть в браузере»
    expect(screen.getByText('example.com')).toBeTruthy()
    const a = baseElement.querySelector('a[target="_blank"]') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('https://example.com/a')
    expect(a.getAttribute('rel')).toContain('noopener')
  })

  it('img: только http/https — javascript:-src не попадает в DOM', () => {
    const { baseElement } = render(
      <InstantView url="https://example.com/a" article={article} onClose={() => {}} />,
    )
    const imgs = Array.from(baseElement.querySelectorAll('img'))
    expect(imgs.length).toBe(1)
    expect(imgs[0].getAttribute('src')).toBe('https://example.com/pic.png')
    expect(imgs[0].getAttribute('loading')).toBe('lazy')
  })

  it('Esc закрывает читалку', () => {
    const onClose = vi.fn()
    render(<InstantView url="https://example.com/a" article={article} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
