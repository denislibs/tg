/**
 * Пины ПРОВОДКИ шва: строки React, которыми портированные вкладки подключены к
 * ещё не портированному корню настроек —
 *  1. `SettingsView` заводит слайдер и уносит его с собой (эффект + cleanup);
 *  2. строка «Devices» в корне настроек открывает вкладку «Устройства»;
 *  3. строка «Active Sessions» в разделе конфиденциальности — ту же вкладку;
 *  4. строка «Language» в корне настроек открывает вкладку «Язык»;
 *  5. строка «Passcode Lock» в разделе конфиденциальности открывает вкладки
 *     «Код-пароль» (при включённом коде — сначала ввод текущего).
 *
 * Почему отдельным файлом и почему вообще: раунд 1 ревью снял ВСЕ ТРИ строки
 * разом (пустой cleanup + вырезанная ветка `Devices` + `void
 * openActiveSessionsTab`) — и весь прогон остался зелёным. Ровно так мёртвый
 * `onClick={() => {}}` в `PrivacySecuritySettings` дожил от шага 7 до шага 8 плана волны 2:
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
import { useSettingsStore } from '@/settings'
import { enablePasscode } from '@lib/passcode/actions'

// Для «Код-пароля»: IndexedDB — словарь в памяти (хеш кода кладёт настоящий
// `lib/passcode/actions.ts`), канал к воркеру (шифрует хранилища) — заглушка,
// лотти-заставка — заглушка.
vi.mock('@/client/passcodeClient', () => ({ invokePasscode: vi.fn(async() => undefined) }))
const idb = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@core/store/idbKv', () => ({
  idbGet: async(key: string) => idb.get(key),
  idbSet: async(key: string, val: unknown) => { idb.set(key, val) },
  idbDel: async(key: string) => { idb.delete(key) },
}))
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { loadAnimationAsAsset: vi.fn(async() => ({ playOrRestart() {}, remove() {} })) },
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
      persist: { clearAll: vi.fn(async() => {}) },
    } as unknown as Managers,
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Переход (250) + разрушение вкладки (280) + запас. */
const settle = () => pause(400)

/** Узел вкладки «Устройства» в колонке (её заголовок — ключ `SessionsTitle`). */
const openedTab = () => columnEl.querySelector('.sidebar-slider > .tabs-tab.sidebar-slider-item')

/** Строки сессий доехавшей вкладки (`activeSessions.solid.tsx`, `Row class="session-row"`). */
const sessionRows = () => document.querySelectorAll('.session-row').length

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
      <SettingsView onBack={() => {}} />
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
    await flush(() => sessionRows() > 0)

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
    await flush(() => sessionRows() > 0)

    const tab = openedTab()!
    expect(tab).not.toBeNull()
    expect(sessionRows()).toBe(2)

    unmount()
    await settle()

    // Вкладка разрушена ЕЮ САМОЙ, а не выброшена поддеревом React: у узла нет
    // родителя. Разбор Solid-острова (опрос вне колонки) пинит
    // `settingsSliderHost.test.ts` — «размонтирование … уничтожает открытые вкладки».
    expect(tab.parentElement).toBeNull()
    expect(sessionRows()).toBe(0)
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
    await flush(() => sessionRows() > 0)

    expect(list).toHaveBeenCalledTimes(1)
    expect(openedTab()).not.toBeNull()

    host.destroy()
  })
})

describe('шов React → слайдер: проводка вкладки «Язык»', () => {
  it('строка «Language» в корне настроек открывает вкладку со списком языков', async() => {
    const { managers } = makeManagers()
    const getLanguages = vi.fn(async() => [
      { _: 'langPackLanguage', name: 'English', native_name: 'English', lang_code: 'en', pFlags: {} },
      { _: 'langPackLanguage', name: 'Russian', native_name: 'Русский', lang_code: 'ru', pFlags: {} },
    ])
    ;(managers as unknown as { langPack: unknown }).langPack = { getLanguages }

    const { getByText } = mountSettings(managers)
    expect(openedTab()).toBeNull()

    await act(async() => { fireEvent.click(getByText('Language')) })
    // Ждём НАПОЛНЕНИЯ, а не появления узла: вкладка не должна въезжать пустой,
    // и именно это отличает её от «узел создан».
    await flush(() => !!openedTab()?.querySelector('input[type="radio"]'))

    const tab = openedTab()
    expect(tab).not.toBeNull()
    expect(getLanguages).toHaveBeenCalledTimes(1)
    expect(tab!.querySelectorAll('input[type="radio"]')).toHaveLength(2)
  })
})

describe('шов React → слайдер: проводка вкладок «Код-пароль»', () => {
  const persist = { clearAll: async() => {} }

  function mountPrivacy() {
    const { managers } = makeManagers()
    const host = createSettingsSliderHost(columnEl, managers)
    const screen = document.createElement('div')
    columnEl.append(screen)
    render(
      <ManagersProvider managers={managers}>
        <PrivacySecuritySettings onBack={() => {}} />
      </ManagersProvider>,
      { container: screen },
    )
    return { host, screen }
  }

  const tabs = () => [...columnEl.querySelectorAll<HTMLElement>('.sidebar-slider > .tabs-tab.sidebar-slider-item')]
  const fieldLabel = (tab: HTMLElement) => tab.querySelector('.input-field label')?.textContent

  async function submit(tab: HTMLElement, value: string) {
    const input = tab.querySelector<HTMLInputElement>('input.input-field-input')!
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await act(async() => { await pause(0) })
    tab.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  }

  afterEach(() => {
    idb.clear()
    useSettingsStore.getState().update({ passcodeEnabled: false })
  })

  it('код не задан: строка открывает главную вкладку «Turn Passcode On»', async() => {
    useSettingsStore.getState().update({ passcodeEnabled: false })
    const { host, screen } = mountPrivacy()

    await act(async() => { fireEvent.click(rowByTitle(screen, 'Passcode Lock')) })
    await flush(() => tabs().some((t) => t.textContent?.includes('Turn Passcode On')))
    expect(tabs()).toHaveLength(1)

    host.destroy()
  })

  it('код задан: сначала ввод текущего; неверный — ошибка, верный — главная вкладка, ввод срезан', async() => {
    await enablePasscode('1111', persist)
    const { host, screen } = mountPrivacy()

    await act(async() => { fireEvent.click(rowByTitle(screen, 'Passcode Lock')) })
    await flush(() => tabs().some((t) => fieldLabel(t) === 'Enter your passcode'))
    const enter = tabs().find((t) => fieldLabel(t) === 'Enter your passcode')!

    await submit(enter, '0000')
    await flush(() => !!enter.querySelector('.input-field-error-label'))
    expect(enter.querySelector('.input-field-error-label')?.textContent).toBe('Passcodes don’t match, try again')

    await submit(enter, '1111')
    await flush(() => tabs().some((t) => t.textContent?.includes('Turn Passcode Off')))
    // `onOpenAfterTimeout` главной вкладки срезает ввод (О-12: до корня хоста)
    await flush(() => tabs().length === 1)
    expect(tabs()).toHaveLength(1)
    expect(tabs()[0].textContent).toContain('Turn Passcode Off')

    host.destroy()
  })
})
