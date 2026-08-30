import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { countUnmutedUnreadPeers, notificationsCountTitle } from './appBadge'
import { makeDialog } from '../core/dialogs/testDialog'
import { loadLang, useI18nStore } from '../i18n'

// Строка списка в форме конструктора: «замьючен» это СРОК, «в архиве» — номер
// папки. Обе величины теперь ВЫЧИСЛЯЮТСЯ, а не читаются полем.
const d = (unread: number, muted = false, archived = false) =>
  makeDialog({ peerId: 1, unread, archived, muteUntil: muted ? true : undefined })

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

  it('мьют с ИСТЁКШИМ сроком в бейдж идёт — иначе «на час» работает как «навсегда»', () => {
    const now = 1_700_000_000
    const expired = makeDialog({ peerId: 1, unread: 2, muteUntil: now - 1 })
    const live = makeDialog({ peerId: 2, unread: 2, muteUntil: now + 3600 })
    expect(countUnmutedUnreadPeers([expired, live], now)).toBe(1)
  })
})

describe('notificationsCountTitle', () => {
  // Форму выбирает ЯЗЫК: проверяем через настоящее хранилище (`tArgs` = `Intl.PluralRules`
  // + строки словаря), а не через подставной `t` — иначе проверка зеленела бы на любой
  // арифметике внутри самой функции, которой там больше нет.
  const title = (count: number) => notificationsCountTitle(count, useI18nStore.getState().tArgs)

  beforeEach(async () => {
    useI18nStore.setState({ lang: 'en' })
    await loadLang('en')
  })

  it('en: одна/много (tweb Notifications.Count one_value/other_value)', () => {
    expect(title(1)).toBe('1 notification')
    expect(title(2)).toBe('2 notifications')
    expect(title(42)).toBe('42 notifications')
  })

  it('ru: славянские формы 1 / 2-4 / 5+', async () => {
    useI18nStore.setState({ lang: 'ru' })
    await loadLang('ru')
    expect(title(1)).toBe('1 уведомление')
    expect(title(2)).toBe('2 уведомления')
    expect(title(5)).toBe('5 уведомлений')
    expect(title(11)).toBe('11 уведомлений')
    expect(title(21)).toBe('21 уведомление')
    expect(title(112)).toBe('112 уведомлений')
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
