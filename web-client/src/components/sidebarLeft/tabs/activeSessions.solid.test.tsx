/** @jsxImportSource solid-js */
/**
 * Вкладка «Устройства» (`activeSessions.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/activeSessions.tsx`, 812502980) — задача 9 плана волны 2D.
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppActiveSessionsTab` из `solidJsTabs/tabs.ts`,
 * открытая через колоночный слайдер (`sidebarLeft/index.ts`) тем же путём, что строка корня
 * настроек; клик по строке открывает НАСТОЯЩУЮ `AppSessionTab` тем же слайдером.
 * Стабы — только границы: менеджеры (`tab.managers.sessions` — граница с
 * воркером), попап подтверждения (`confirmationPopup` — свой DOM-слой со своими
 * тестами), всплывашка (`toastNew`), геометрия.
 *
 * Данные — конструкторы `authorization` ТАКИМИ, какими их шлёт наш бэкенд
 * (`internal/domain/mtaccount.go`): даты в СЕКУНДАХ эпохи, `pFlags` объектом у
 * КАЖДОЙ строки (у не-текущей — пустым), адрес текущей сессии — ноль.
 *
 * Предмет — расхождения прежней вкладки (старая база) с HEAD, видимые в DOM:
 *  • клик по строке — экран сессии (`AppSessionTab`), а не попап завершения;
 *  • завершение — из контекстного меню строки и с экрана сессии;
 *  • подпись `ClearOtherSessionsHelp` и кнопка — только при других сессиях;
 *  • `password_pending` — своя секция «Incomplete login attempts»;
 *  • список перечитывается раз в минуту, опрос гаснет с вкладкой.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Authorization } from '@layer'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { useI18nStore } from '@/i18n'
import { applyLang } from '@/test/lang'
import { glyph } from '@core/tgico-icons'
import { getRowIconBackgroundImage } from '@helpers/rowIconBackground'
import contextMenuController from '@helpers/contextMenuController'
import { AppActiveSessionsTab } from '@components/solidJsTabs/tabs'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'

const confirmationPopup = vi.hoisted(() => vi.fn(async(_options: unknown) => {}))
vi.mock('@components/popups/popupPeer', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmationPopup,
}))

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  toastNew,
}))

type Auth = Authorization.authorization

const baseAuth = {
  _: 'authorization',
  device_model: 'Chrome',
  platform: 'browser',
  system_version: 'macOS',
  api_id: 0,
  app_name: 'Telegram Web',
  app_version: '1.0',
  date_created: 1_700_000_000,
  date_active: 1_700_000_100,
  ip: '1.2.3.4',
  country: 'Germany',
  region: '',
} as Omit<Auth, 'pFlags' | 'hash'>

const current = { ...baseAuth, hash: 0, pFlags: { current: true } } as Auth
const other = { ...baseAuth, hash: 2, pFlags: {}, app_name: 'Telegram Android', app_version: '11.2' } as Auth

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: InstalledSidebarLeft
let sessions: {
  list: ReturnType<typeof vi.fn<() => Promise<Auth[]>>>
  terminate: ReturnType<typeof vi.fn<(id: number) => Promise<boolean>>>
  terminateOthers: ReturnType<typeof vi.fn<() => Promise<boolean>>>
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  confirmationPopup.mockReset().mockResolvedValue(undefined)
  toastNew.mockReset()
  sessions = {
    list: vi.fn(async() => [current, other]),
    terminate: vi.fn(async() => true),
    terminateOthers: vi.fn(async() => true),
  }

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = installSidebarLeft({ sessions } as unknown as Managers, columnEl)
})

afterEach(async() => {
  // Контекстное меню — общий синглтон-контроллер: незакрытое меню утекает
  // в следующий тест классом `active`.
  contextMenuController.close()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.useRealTimers()
  if(useI18nStore.getState().lang !== 'en') {
    useI18nStore.setState({ lang: 'en' })
    await applyLang('en')
  }
})

const open = (authorizations: Auth[]) => host.openTab(AppActiveSessionsTab, { authorizations })

function sectionByName(tab: SliderSuperTab, name: string) {
  return [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
    .find((c) => c.querySelector('.sidebar-left-section-name')?.textContent === name)
}

function section(tab: SliderSuperTab, name: string) {
  const el = sectionByName(tab, name)
  if(!el) throw new Error('no section ' + name)
  return el
}

function rowByTitle(root: ParentNode, title: string) {
  const el = [...root.querySelectorAll<HTMLElement>('.row')]
    .find((r) => r.querySelector('.row-title:not(.row-title-right)')?.textContent === title)
  if(!el) throw new Error('no row ' + title)
  return el
}

const caption = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(':scope > .sidebar-left-section-caption')

/** Верхняя (активная) вкладка слайдера хоста. */
const topTab = () => {
  const tabs = document.querySelectorAll<HTMLElement>('.sidebar-slider > .tabs-tab.sidebar-slider-item')
  return tabs[tabs.length - 1]
}

function rightClick(row: HTMLElement) {
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
}

/** Пункт открытого контекстного меню — меню собирается асинхронно (`filterAsync`). */
const openedMenuItem = () => vi.waitFor(() => {
  const item = document.querySelector<HTMLElement>('.btn-menu.active .btn-menu-item')
  if(!item) throw new Error('меню не открыто')
  return item
})

/** Экран сессии въехал и достроен (модуль вкладки грузится `import()`). */
const openedSessionTab = (listTab: SliderSuperTab) => vi.waitFor(() => {
  const el = topTab()
  if(el === listTab.container || !el.querySelector('.sidebar-left-section-container')) {
    throw new Error('экран сессии не открыт')
  }
  return el
})

describe('«Устройства» — разметка', () => {
  it('текущая сессия — секцией CurrentSession, прочие — OtherSessions; строки session-row', async() => {
    // Порядок обратный: текущая узнаётся по флагу, а не по месту в списке.
    const tab = await open([other, current])

    const names = [...tab.scrollable.container.querySelectorAll('.sidebar-left-section-name')].map((n) => n.textContent)
    expect(names).toEqual([lang.CurrentSession, lang.OtherSessions])

    const mine = rowByTitle(section(tab, lang.CurrentSession), 'Telegram Web 1.0')
    expect(mine.classList.contains('session-row')).toBe(true)
    expect(mine.classList.contains('row-clickable')).toBe(true)
    expect(mine.getAttribute('role')).toBe('button')
    expect(mine.getAttribute('tabindex')).toBe('0')
    expect(mine.querySelector('.row-midtitle')!.textContent).toBe('Chrome, macOS')
    expect(mine.querySelector('.row-subtitle')!.textContent).toBe('1.2.3.4 - Germany')
    // Дата активности — только у ЧУЖОЙ сессии (tweb `:312`).
    expect(mine.querySelector('.row-title-right')).toBeNull()

    const theirs = rowByTitle(section(tab, lang.OtherSessions), 'Telegram Android 11.2')
    expect(theirs.classList.contains('session-row')).toBe(true)
    expect(theirs.querySelector('.row-title-right')!.textContent).not.toBe('')
  })

  it('строка несёт иконку платформы на цветной плашке', async() => {
    const android = { ...other, api_id: 6, platform: 'Android', device_model: 'Pixel 8' } as Auth
    const tab = await open([current, android])

    const plate = (title: string) => rowByTitle(tab.scrollable.container, title)
      .querySelector<HTMLElement>(':scope > .row-icon.row-icon-colored')!
    expect(plate('Telegram Web 1.0').textContent).toBe(glyph('web_filled'))
    expect(plate('Telegram Web 1.0').style.backgroundImage).toBe(getRowIconBackgroundImage('web_filled'))
    expect(plate('Telegram Android 11.2').textContent).toBe(glyph('android_filled'))
    expect(plate('Telegram Android 11.2').style.backgroundImage).toBe(getRowIconBackgroundImage('android_filled'))
  })

  it('пустые поля не рисуют мусорных разделителей, платформа заменяет версию системы', async() => {
    const bare = { ...other, system_version: '', country: '' } as Auth
    const tab = await open([current, bare])

    const row = rowByTitle(section(tab, lang.OtherSessions), 'Telegram Android 11.2')
    expect(row.querySelector('.row-midtitle')!.textContent).toBe('Chrome, browser')
    expect(row.querySelector('.row-subtitle')!.textContent).toBe('1.2.3.4')
  })

  it('при других сессиях: подпись ClearOtherSessionsHelp под карточкой и кнопка «завершить все» с иконкой', async() => {
    const tab = await open([current, other])
    const mine = section(tab, lang.CurrentSession)

    expect(caption(mine)!.textContent).toBe(lang.ClearOtherSessionsHelp)
    const button = mine.querySelector<HTMLElement>('.sidebar-left-section-content > button')!
    expect([...button.classList]).toEqual(expect.arrayContaining(['btn-primary', 'btn-transparent', 'danger']))
    expect(button.querySelector('.tgico')!.textContent).toBe(glyph('stop'))
    expect(button.textContent).toContain(lang.TerminateAllSessions)
    expect(caption(section(tab, lang.OtherSessions))!.textContent).toBe(lang.SessionsListInfo)
  })

  it('одна сессия: ни подписи ClearOtherSessionsHelp, ни кнопки, ни секции прочих', async() => {
    const tab = await open([current])
    const mine = section(tab, lang.CurrentSession)

    expect(caption(mine)).toBeNull()
    expect(mine.querySelector('button')).toBeNull()
    expect(sectionByName(tab, lang.OtherSessions)).toBeUndefined()
  })

  it('password_pending — своя секция Incomplete login attempts, не в списке прочих', async() => {
    const pending = { ...other, hash: 5, app_name: 'Telegram iOS', app_version: '12', pFlags: { password_pending: true } } as Auth
    const tab = await open([current, pending])

    const incomplete = section(tab, lang['AuthSessions.IncompleteAttempts'])
    expect(rowByTitle(incomplete, 'Telegram iOS 12')).toBeTruthy()
    expect(caption(incomplete)!.textContent).toBe(lang['AuthSessions.IncompleteAttemptsInfo'])
    expect(sectionByName(tab, lang.OtherSessions)).toBeUndefined()
    // незавершённый вход — тоже «другая сессия»: подпись и кнопка есть
    expect(caption(section(tab, lang.CurrentSession))).not.toBeNull()
  })

  it('шапка — SessionsTitle', async() => {
    const tab = await open([current])
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent).toBe(lang.SessionsTitle)
  })
})

describe('«Устройства» — экран сессии и завершение', () => {
  it('клик по чужой строке открывает экран сессии, а не попап завершения', async() => {
    const tab = await open([current, other])

    rowByTitle(tab.scrollable.container, 'Telegram Android 11.2').click()

    const sessionTab = await openedSessionTab(tab)
    expect(sessionTab.querySelector('.sidebar-header__title')!.textContent).toBe(lang['AuthSessions.View.Device'])
    expect(sessionTab.querySelector('[data-popup-title]')!.textContent).toBe('Chrome')
    expect(confirmationPopup).not.toHaveBeenCalled()
    // у чужой сессии кнопка завершения на экране есть
    expect(sessionTab.textContent).toContain(lang['AuthSessions.View.TerminateSession'])
  })

  it('клик по строке ТЕКУЩЕЙ открывает её экран без кнопки завершения', async() => {
    const tab = await open([current, other])

    rowByTitle(tab.scrollable.container, 'Telegram Web 1.0').click()

    const sessionTab = await openedSessionTab(tab)
    expect(sessionTab.textContent).toContain(lang.Online)
    expect(sessionTab.textContent).not.toContain(lang['AuthSessions.View.TerminateSession'])
  })

  it('завершение с экрана сессии: подтверждение → terminate(hash) → экран закрыт, строки в списке нет', async() => {
    const tab = await open([current, other])
    rowByTitle(tab.scrollable.container, 'Telegram Android 11.2').click()
    const sessionTab = await openedSessionTab(tab)

    const button = [...sessionTab.querySelectorAll<HTMLElement>('button.danger')]
      .find((b) => b.textContent!.includes(lang['AuthSessions.View.TerminateSession']))!
    button.click()

    await vi.waitFor(() => expect(sessions.terminate).toHaveBeenCalledWith(2))
    expect(confirmationPopup).toHaveBeenCalledWith(expect.objectContaining({
      titleLangKey: 'AreYouSureSessionTitle',
      descriptionLangKey: 'TerminateSessionText',
    }))
    await vi.waitFor(() => expect(sessionTab.isConnected).toBe(false), { timeout: 1000 })
    expect(sectionByName(tab, lang.OtherSessions)).toBeUndefined()
  })

  it('правый клик по чужой строке: меню «Завершить» (переведено) → подтверждение → строка снята', async() => {
    useI18nStore.setState({ lang: 'ru' })
    await applyLang('ru')
    const tab = await open([current, other])

    rightClick(rowByTitle(tab.scrollable.container, 'Telegram Android 11.2'))
    const item = await openedMenuItem()
    expect(item.classList.contains('danger')).toBe(true)
    expect(item.querySelector('.btn-menu-item-text')!.textContent).toBe('Завершить')

    item.click()

    await vi.waitFor(() => expect(sessions.terminate).toHaveBeenCalledWith(2))
    await vi.waitFor(() => expect(tab.scrollable.container.querySelectorAll('.session-row')).toHaveLength(1))
  })

  it('правый клик по строке ТЕКУЩЕЙ не открывает меню', async() => {
    const tab = await open([current, other])

    rightClick(rowByTitle(tab.scrollable.container, 'Telegram Web 1.0'))
    await pause(0)

    expect(document.querySelector('.btn-menu.active')).toBeNull()
  })

  it('отказ от подтверждения — сессия не завершается', async() => {
    confirmationPopup.mockRejectedValue(undefined)
    const tab = await open([current, other])

    rightClick(rowByTitle(tab.scrollable.container, 'Telegram Android 11.2'))
    ;(await openedMenuItem()).click()

    await vi.waitFor(() => expect(confirmationPopup).toHaveBeenCalled())
    await pause(0)
    expect(sessions.terminate).not.toHaveBeenCalled()
    expect(tab.scrollable.container.querySelectorAll('.session-row')).toHaveLength(2)
  })

  it('отказ FRESH_* — всплывашка RecentSessions.Error.FreshReset, строка на месте', async() => {
    sessions.terminate.mockRejectedValue(Object.assign(new Error('x'), { type: 'FRESH_RESET_AUTHORISATION_FORBIDDEN' }))
    const tab = await open([current, other])

    rightClick(rowByTitle(tab.scrollable.container, 'Telegram Android 11.2'))
    ;(await openedMenuItem()).click()

    await vi.waitFor(() => expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'RecentSessions.Error.FreshReset' }))
    expect(tab.scrollable.container.querySelectorAll('.session-row')).toHaveLength(2)
  })

  it('прочий отказ — всплывашка Error.AnError', async() => {
    sessions.terminate.mockRejectedValue(Object.assign(new Error('x'), { type: 'SESSION_NOT_FOUND' }))
    const tab = await open([current, other])

    rightClick(rowByTitle(tab.scrollable.container, 'Telegram Android 11.2'))
    ;(await openedMenuItem()).click()

    await vi.waitFor(() => expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Error.AnError' }))
  })

  it('«завершить все»: подтверждение → terminateOthers → остаётся одна строка, подпись и кнопка ушли', async() => {
    const tab = await open([current, other])
    const mine = section(tab, lang.CurrentSession)

    mine.querySelector<HTMLElement>('.sidebar-left-section-content > button')!.click()

    await vi.waitFor(() => expect(sessions.terminateOthers).toHaveBeenCalledTimes(1))
    expect(confirmationPopup).toHaveBeenCalledWith(expect.objectContaining({
      titleLangKey: 'AreYouSureSessionsTitle',
      descriptionLangKey: 'AreYouSureSessions',
    }))
    await vi.waitFor(() => expect(sectionByName(tab, lang.OtherSessions)).toBeUndefined())
    expect(caption(mine)).toBeNull()
    expect(mine.querySelector('button')).toBeNull()
  })

  it('«завершить все» ответили false — всплывашка Error.AnError, список цел', async() => {
    sessions.terminateOthers.mockResolvedValue(false)
    const tab = await open([current, other])

    section(tab, lang.CurrentSession).querySelector<HTMLElement>('.sidebar-left-section-content > button')!.click()

    await vi.waitFor(() => expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Error.AnError' }))
    expect(tab.scrollable.container.querySelectorAll('.session-row')).toHaveLength(2)
  })
})

describe('«Устройства» — опрос и жизненный цикл', () => {
  it('список перечитывается раз в минуту: новая сессия появляется без переоткрытия', async() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const tab = await open([current])
    const fresh = { ...other, hash: 9, app_name: 'Telegram Desktop', app_version: '5.0' } as Auth
    sessions.list.mockResolvedValue([current, fresh])

    vi.advanceTimersByTime(59_999)
    expect(sessions.list).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(sessions.list).toHaveBeenCalledTimes(1)

    await vi.waitFor(() => expect(rowByTitle(section(tab, lang.OtherSessions), 'Telegram Desktop 5.0')).toBeTruthy())
  })

  it('после закрытия опрос погашен и Solid-остров снят (DoD 5)', async() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const tab = await open([current, other])
    expect(document.querySelectorAll('.session-row').length).toBe(2)

    tab.close()
    await pause(400)

    expect(document.querySelectorAll('.session-row')).toHaveLength(0)
    expect(tab.container.isConnected).toBe(false)
    vi.advanceTimersByTime(120_000)
    expect(sessions.list).not.toHaveBeenCalled()
  })
})
