/**
 * Пины ПРОВОДКИ шва: три строки React, которыми портированная вкладка
 * подключена к ещё не портированным экранам настроек —
 *  1. `SettingsView` заводит слайдер и уносит его с собой (эффект + cleanup);
 *  2. строка «Devices» в корне настроек открывает вкладку;
 *  3. строка «Active Sessions» в разделе конфиденциальности — та же вкладка.
 *
 * Почему отдельным файлом и почему вообще: раунд 1 ревью снял ВСЕ ТРИ строки
 * разом (пустой cleanup + вырезанная ветка `Devices` + `void
 * openActiveSessionsTab`) — и весь прогон остался зелёным. Ровно так мёртвый
 * `onClick={() => {}}` в `PrivacySecuritySettings` дожил от задачи 7 до задачи 8:
 * шов никто не держал. Пока корень настроек React'овый, эти три строки —
 * единственное, чем вкладка вообще достижима, поэтому у них есть тест, а не
 * пометка.
 *
 * Файл лежит рядом с хостом, а не с экранами: он про ШОВ, и умрёт вместе с ним
 * — когда корень настроек станет вкладкой слайдера, пинить будет нечего.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { Authorization } from '@layer'
import type { Managers } from '@/client/bootstrap'
import { ManagersProvider } from '@core/hooks/useManagers'
import SettingsView from '../SettingsView'
import PrivacySecuritySettings from '../settings/PrivacySecuritySettings'
import { createSettingsSliderHost } from './settingsSliderHost'

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
const other = { ...baseAuth, hash: 2, pFlags: {}, app_name: 'Telegram Android' } as Auth

function makeManagers() {
  const list = vi.fn<() => Promise<Auth[]>>(async() => [current, other])
  return {
    list,
    managers: {
      sessions: { list, terminate: vi.fn(), terminateOthers: vi.fn() },
      // Раздел конфиденциальности читает это на монтировании — к вкладке
      // отношения не имеет, но без ответов экран не соберётся.
      auth: {
        passwordState: vi.fn(async() => ({ enabled: false })),
        passkeysList: vi.fn(async() => []),
      },
      privacy: { autoDelete: vi.fn(async() => 0) },
    } as unknown as Managers,
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Переход (250) + разрушение вкладки (280) + запас. */
const settle = () => pause(400)

/** Узел вкладки «Устройства» в колонке (её заголовок — ключ `SessionsTitle`). */
const openedTab = () => columnEl.querySelector('.sidebar-slider > .tabs-tab.sidebar-slider-item')

/** Узел, который вкладка кладёт в `document.body` МИМО колонки. */
const tabMenu = () => document.getElementById('active-sessions-contextmenu')

/**
 * Ждать, пока содержимое вкладки доедет. Ждём именно ФАКТ, а не «достаточно
 * миллисекунд»: между кликом и наполнением вкладки лежит запрос списка сессий,
 * динамический `import()` модуля вкладки и монтирование Solid-острова — на
 * холодном прогоне это заметно дольше, чем на тёплом, и фиксированная пауза
 * дала бы мигающий тест.
 */
async function flush(ready: () => boolean, timeout = 3000) {
  const started = Date.now()
  while(!ready() && Date.now() - started < timeout) {
    await act(async() => { await pause(20) })
  }
}

/** Строка `.row` экрана по тексту заголовка (kit `Row` → `.row > .row-title`). */
function rowByTitle(root: HTMLElement, title: string) {
  const found = [...root.querySelectorAll<HTMLElement>('.row')]
    .find((row) => row.querySelector('.row-title')?.textContent === title)
  expect(found, `строка «${title}» не найдена`).toBeDefined()
  return found!
}

let columnEl: HTMLElement

beforeEach(() => {
  // Колонка настоящая: хост ищет родителя экрана, а не `document.body`.
  columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
})

afterEach(async() => {
  cleanup()
  await settle()
  document.body.replaceChildren()
})

function mountSettings(managers: Managers) {
  return render(
    <ManagersProvider managers={managers}>
      <SettingsView onBack={() => {}} onToggleMode={() => {}} />
    </ManagersProvider>,
    { container: columnEl },
  )
}

describe('шов React → слайдер: проводка вкладки «Устройства»', () => {
  it('строка «Devices» в корне настроек открывает вкладку слайдера', async() => {
    const { managers, list } = makeManagers()
    const { getByText } = mountSettings(managers)

    expect(openedTab()).toBeNull()

    await act(async() => { fireEvent.click(getByText('Devices')) })
    await flush(() => !!tabMenu())

    expect(list).toHaveBeenCalledTimes(1)
    const tab = openedTab()
    expect(tab).not.toBeNull()
    // Вкладка не пустая: список сессий доехал до неё.
    expect(tab!.querySelectorAll('.sidebar-left-section')).toHaveLength(2)
  })

  it('размонтирование экрана настроек уносит слайдер и открытую вкладку', async() => {
    const { managers } = makeManagers()
    const { getByText, unmount } = mountSettings(managers)

    await act(async() => { fireEvent.click(getByText('Devices')) })
    await flush(() => !!tabMenu())

    const tab = openedTab()!
    expect(tab).not.toBeNull()
    expect(tabMenu()).not.toBeNull()

    unmount()
    await settle()

    // Вкладка разрушена ЕЮ САМОЙ, а не выброшена поддеревом React: у узла нет
    // родителя, а Solid-остров успел снять своё меню из `document.body`.
    expect(tab.parentElement).toBeNull()
    expect(tabMenu()).toBeNull()
    // И слой хоста ушёл из колонки вместе с экраном.
    expect(columnEl.querySelector('.sidebar-slider')).toBeNull()
  })

  it('строка «Active Sessions» в конфиденциальности открывает ТУ ЖЕ вкладку', async() => {
    const { managers, list } = makeManagers()
    // Хост в этом сценарии заводит не Privacy, а владелец экрана настроек —
    // здесь его роль играет прямой вызов.
    const host = createSettingsSliderHost(columnEl, managers)

    const screen = document.createElement('div')
    columnEl.append(screen)
    render(
      <ManagersProvider managers={managers}>
        <PrivacySecuritySettings onBack={() => {}} />
      </ManagersProvider>,
      { container: screen },
    )

    await act(async() => { fireEvent.click(rowByTitle(screen, 'Active Sessions')) })
    await flush(() => !!tabMenu())

    expect(list).toHaveBeenCalledTimes(1)
    expect(openedTab()).not.toBeNull()

    host.destroy()
  })
})
