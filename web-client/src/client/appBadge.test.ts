import { describe, it, expect, vi, afterEach } from 'vitest'
import { countUnmutedUnreadPeers, notificationsCountTitle } from './appBadge'

const d = (unread: number, muted = false, archived = false) => ({ unread, muted, archived })

describe('countUnmutedUnreadPeers', () => {
  it('считает ЧАТЫ с непрочитанным, а не сумму сообщений (tweb unreadUnmutedPeerIds.size)', () => {
    expect(countUnmutedUnreadPeers([d(2), d(3), d(0)])).toBe(2)
  })

  it('muted-чаты в бейдж не идут', () => {
    expect(countUnmutedUnreadPeers([d(2), d(7, true), d(1)])).toBe(2)
  })

  it('архив не считается (бейдж по папке «Все»)', () => {
    expect(countUnmutedUnreadPeers([d(2), d(4, false, true)])).toBe(1)
  })

  it('пустой список → 0', () => {
    expect(countUnmutedUnreadPeers([])).toBe(0)
  })
})

describe('notificationsCountTitle', () => {
  // Английский t(): ключ И есть строка.
  const t = (s: string) => s
  const tRu = (s: string) =>
    ({
      '%d notification': '%d уведомление',
      '%d notifications (few)': '%d уведомления',
      '%d notifications': '%d уведомлений',
    })[s] ?? s

  it('en: одна/много (tweb Notifications.Count one_value/other_value)', () => {
    expect(notificationsCountTitle(1, 'en', t)).toBe('1 notification')
    expect(notificationsCountTitle(2, 'en', t)).toBe('2 notifications')
    expect(notificationsCountTitle(42, 'en', t)).toBe('42 notifications')
  })

  it('ru: славянские формы 1 / 2-4 / 5+', () => {
    expect(notificationsCountTitle(1, 'ru', tRu)).toBe('1 уведомление')
    expect(notificationsCountTitle(2, 'ru', tRu)).toBe('2 уведомления')
    expect(notificationsCountTitle(5, 'ru', tRu)).toBe('5 уведомлений')
    expect(notificationsCountTitle(11, 'ru', tRu)).toBe('11 уведомлений')
    expect(notificationsCountTitle(21, 'ru', tRu)).toBe('21 уведомление')
    expect(notificationsCountTitle(112, 'ru', tRu)).toBe('112 уведомлений')
  })
})

// Мигание: пока вкладка в простое, раз в секунду чередуются «N notifications» +
// синяя фавиконка и исходные title/иконка (tweb onTitleInterval). Возврат
// пользователя (focus) обнуляет счётчик и возвращает всё на место.
describe('мигание заголовка и фавиконки', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('уведомление → мигание, focus → возврат к исходным', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    document.head.innerHTML = '<title></title><link rel="icon" href="/favicon.svg">'
    document.title = 'Telegram'

    // happy-dom не рисует canvas — подменяем контекст и toDataURL заглушкой.
    const ctx = new Proxy({} as CanvasRenderingContext2D, { get: () => () => {}, set: () => true })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,BADGE')

    const { initAppBadge, incNotificationsCount } = await import('./appBadge')
    const icon = () => document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')!

    initAppBadge()
    const initialHref = icon().href
    expect(document.title).toBe('Telegram')

    incNotificationsCount()
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe('1 notification')
    expect(icon().href).toBe('data:image/png;base64,BADGE')

    // вторая половина мигания — исходные значения
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe('Telegram')
    expect(icon().href).toBe(initialHref)

    // и снова тревожные
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe('1 notification')

    // пользователь вернулся во вкладку — счётчик обнулён, мигание остановлено
    window.dispatchEvent(new Event('focus'))
    expect(document.title).toBe('Telegram')
    expect(icon().href).toBe(initialHref)
    vi.advanceTimersByTime(3000)
    expect(document.title).toBe('Telegram')
  })
})
