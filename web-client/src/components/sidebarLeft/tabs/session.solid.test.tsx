/** @jsxImportSource solid-js */
/**
 * Экран сессии (`session.solid.tsx` + `sessionInfoRow.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/session.tsx`/`sessionInfoRow.tsx`, 812502980) — задача 9
 * плана волны 2D. Вкладка настоящая (`AppSessionTab` через хост); завершение
 * приходит колбэком `onTerminate` от списка, как у оригинала, — здесь он стаб.
 *
 * Предмет — разметка HEAD: шапка `MediaHeader` с иконкой платформы на плашке
 * реестра, секция `Info` (три строки «метка → значение справа, вторичным
 * цветом»), подпись про геолокацию только при известном месте, кнопка
 * завершения только при `onTerminate`, секции `AcceptTitle` нет (О-8).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Authorization } from '@layer'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { glyph } from '@core/tgico-icons'
import { getRowIconBackgroundImage } from '@helpers/rowIconBackground'
import { AppSessionTab } from '@components/solidJsTabs/tabs'
import { createSettingsSliderHost, type SettingsSliderHost } from '../settingsSliderHost'

type Auth = Authorization.authorization

const android = {
  _: 'authorization',
  hash: 2,
  pFlags: {},
  device_model: 'Pixel 8',
  platform: 'Android',
  system_version: 'Android 14',
  api_id: 6,
  app_name: 'Telegram Android',
  app_version: '11.2',
  date_created: 1_700_000_000,
  date_active: 1_700_000_100,
  ip: '1.2.3.4',
  country: 'Germany',
  region: 'Berlin',
} as Auth

const current = {
  ...android,
  hash: 0,
  pFlags: { current: true },
  device_model: 'Chrome',
  platform: 'browser',
  system_version: 'macOS',
  api_id: 0,
  app_name: 'Telegram Web',
  app_version: '1.0',
  country: '',
  region: '',
} as Auth

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: SettingsSliderHost

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = createSettingsSliderHost(columnEl, {} as Managers)
})

afterEach(async() => {
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const open = (authorization: Auth, onTerminate?: () => Promise<boolean>) =>
  host.openTab(AppSessionTab, { authorization, onTerminate })

const infoRows = (tab: SliderSuperTab) =>
  [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container .row')]
    .map((row) => [
      row.querySelector('.row-title:not(.row-title-right)')!.textContent,
      row.querySelector('.row-title-right')!.textContent,
    ])

const terminateButton = (tab: SliderSuperTab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('button')]
  .find((b) => b.textContent!.includes(lang['AuthSessions.View.TerminateSession']))

describe('экран сессии — разметка', () => {
  it('шапка вкладки — AuthSessions.View.Device', async() => {
    const tab = await open(android)
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent).toBe(lang['AuthSessions.View.Device'])
  })

  it('MediaHeader: иконка платформы на плашке 100px, имя устройства, дата активности', async() => {
    const tab = await open(android)
    const root = tab.scrollable.container

    const sticker = root.querySelector<HTMLElement>('[style*="--sticker-size: 100px"]')!
    expect(sticker).not.toBeNull()
    const plate = sticker.firstElementChild as HTMLElement
    expect(plate.style.backgroundImage).toBe(getRowIconBackgroundImage('android_filled'))
    expect(plate.querySelector('.tgico')!.textContent).toBe(glyph('android_filled'))

    expect(root.querySelector('[data-popup-title]')!.textContent).toBe('Pixel 8')
    // не текущая — дата последней активности, а не «online»
    const subtitle = root.querySelector('[data-popup-title]')!.nextElementSibling!
    expect(subtitle.textContent).not.toBe('')
    expect(subtitle.textContent).not.toBe(lang.Online)
  })

  it('текущая сессия: подзаголовок — Online; без device_model заголовок — приложение', async() => {
    const tab = await open({ ...current, device_model: '' } as Auth)
    const root = tab.scrollable.container

    expect(root.querySelector('[data-popup-title]')!.textContent).toBe('Telegram Web 1.0')
    expect(root.querySelector('[data-popup-title]')!.nextElementSibling!.textContent).toBe(lang.Online)
  })

  it('секция Info: Application / System / Location — значение справа вторичным цветом', async() => {
    const tab = await open(android)

    const info = tab.scrollable.container.querySelector<HTMLElement>('.sidebar-left-section-container')!
    expect(info.querySelector('.sidebar-left-section-name')!.textContent).toBe(lang.Info)
    expect(infoRows(tab)).toEqual([
      [lang['AuthSessions.View.Application'], 'Telegram Android 11.2'],
      [lang['AuthSessions.View.System'], 'Android 14'],
      [lang['AuthSessions.View.Location'], 'Berlin, Germany'],
    ])
    const right = info.querySelector<HTMLElement>('.row-title-right')!
    expect(right.classList.contains('row-title-right-secondary')).toBe(true)
    expect(right.classList.contains('text-overflow-no-wrap')).toBe(true)
    // подпись про оценку места по IP — под карточкой
    expect(info.querySelector(':scope > .sidebar-left-section-caption')!.textContent)
      .toBe(lang['AuthSessions.View.LocationInfo'])
  })

  it('место неизвестно — прочерк и без подписи; системы нет — платформа', async() => {
    const tab = await open({ ...current, system_version: '' } as Auth)

    expect(infoRows(tab)).toEqual([
      [lang['AuthSessions.View.Application'], 'Telegram Web 1.0'],
      [lang['AuthSessions.View.System'], 'browser'],
      [lang['AuthSessions.View.Location'], '—'],
    ])
    expect(tab.scrollable.container.querySelector('.sidebar-left-section-caption')).toBeNull()
  })

  it('секции AcceptTitle нет (О-8): тумблеров на экране нет', async() => {
    const tab = await open(android, async() => true)

    const names = [...tab.scrollable.container.querySelectorAll('.sidebar-left-section-name')].map((n) => n.textContent)
    expect(names).toEqual([lang.Info])
    expect(tab.scrollable.container.querySelector('input[type="checkbox"]')).toBeNull()
  })
})

describe('экран сессии — завершение', () => {
  it('без onTerminate кнопки нет', async() => {
    const tab = await open(current)
    expect(terminateButton(tab)).toBeUndefined()
  })

  it('кнопка — btn-primary btn-transparent danger с иконкой stop в отдельной секции', async() => {
    const tab = await open(android, async() => true)
    const button = terminateButton(tab)!

    expect([...button.classList]).toEqual(expect.arrayContaining(['btn-primary', 'btn-transparent', 'danger']))
    expect(button.querySelector('.tgico')!.textContent).toBe(glyph('stop'))
    expect(button.closest('.sidebar-left-section-container')!.querySelector('.sidebar-left-section-name')).toBeNull()
  })

  it('onTerminate → true: вкладка закрывается', async() => {
    const onTerminate = vi.fn(async() => true)
    const tab = await open(android, onTerminate)

    terminateButton(tab)!.click()

    await vi.waitFor(() => expect(onTerminate).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(tab.container.isConnected).toBe(false), { timeout: 1000 })
  })

  it('onTerminate → false (отмена/ошибка): вкладка остаётся', async() => {
    const onTerminate = vi.fn(async() => false)
    const tab = await open(android, onTerminate)

    terminateButton(tab)!.click()

    await vi.waitFor(() => expect(onTerminate).toHaveBeenCalledTimes(1))
    await pause(400)
    expect(tab.container.isConnected).toBe(true)
  })

  it('после закрытия Solid-остров снят (DoD 5)', async() => {
    const tab = await open(android)
    tab.close()
    await pause(400)
    expect(document.querySelectorAll('.sidebar-left-section-container')).toHaveLength(0)
  })
})
