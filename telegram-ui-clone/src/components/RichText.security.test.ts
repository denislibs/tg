import { describe, it, expect } from 'vitest'
import { createElement as h } from 'react'
import { render } from '@testing-library/react'
import { ThemeProvider } from '@mui/material'
import RichText from './RichText'
import { buildTheme } from '../theme'
import type { MessageEntity } from '../core/models'

const theme = buildTheme('day')
const renderRT = (text: string, entities: MessageEntity[]) =>
  render(h(ThemeProvider, { theme }, h(RichText, { text, entities, linkColor: '#39c' })))

describe('RichText link sanitization (XSS gate)', () => {
  it('does NOT render a javascript: URL as an anchor href', () => {
    const { container } = renderRT('click me', [
      { type: 'text_link', offset: 0, length: 8, url: 'javascript:alert(document.cookie)' },
    ])
    expect([...container.querySelectorAll('a')].some((el) => /javascript:/i.test(el.getAttribute('href') || ''))).toBe(false)
    expect(container.textContent).toContain('click me')
  })

  it('drops data:, vbscript:, mixed-case javascript: schemes', () => {
    for (const url of ['data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'JAVASCRIPT:alert(1)']) {
      const { container } = renderRT('x', [{ type: 'text_link', offset: 0, length: 1, url }])
      expect(container.querySelector('a')).toBeNull()
    }
  })

  it('keeps a normal https link clickable', () => {
    const { container } = renderRT('site', [
      { type: 'text_link', offset: 0, length: 4, url: 'https://example.com' },
    ])
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  })
})
