/**
 * Пины моста «React-экран вкладкой колоночного слайдера»
 * (`reactScreenTab.tsx`, ВРЕМЕННО до 2D-23/26/27) и проводки React-экрана
 * «Конфиденциальность», который через него живёт:
 *  1. мост кладёт React-экран в узел вкладки слайдера (соседом `.item-main`),
 *     стрелка кита закрывает вкладку, закрытая вкладка РАЗМОНТИРУЕТ React-корень;
 *  2. `z-index` кита замкнут в хосте вкладки: следующая вкладка встаёт поверх;
 *  3. «Active Sessions» открывает вкладку «Устройства» на том же слайдере;
 *  4. «Passcode Lock» открывает вкладки «Код-пароль»; главная вкладка срезает
 *     ввод ДО `AppPrivacyAndSecurityTab` (tweb `solidJsTabs/tabs.ts:31-37`) —
 *     сама «Конфиденциальность» в истории остаётся.
 *
 * Строки «Конфиденциальности» — единственный вход в эти вкладки, пока хаб не
 * портирован (задача 23), поэтому у них пин, а не пометка.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { useEffect } from 'react'
import type { Authorization } from '@layer'
import type { Managers } from '@/client/bootstrap'
import { useSettingsStore } from '@/settings'
import { enablePasscode } from '@lib/passcode/actions'
import { AppPasscodeLockTab, AppPrivacyAndSecurityTab } from '@components/solidJsTabs/tabs'
import { mountTestColumnSlider, type TestColumnSlider } from '@/test/columnSlider'
import { scaffoldReactScreenTab, type ReactScreenTabProps } from './reactScreenTab'
import { SettingsScreen } from '../settings/kit'

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

const auth = (hash: number, app_name = 'Telegram Web') => ({
  _: 'authorization', hash, pFlags: hash ? {} : { current: true },
  device_model: 'Chrome', platform: 'browser', system_version: 'macOS', api_id: 0,
  app_name, app_version: '1.0', date_created: 1_700_000_000,
  date_active: 1_700_000_100, ip: '1.2.3.4', country: 'Germany', region: '',
}) as Auth

function makeManagers() {
  const list = vi.fn<() => Promise<Auth[]>>(async() => [auth(0), auth(2, 'Telegram Android')])
  return {
    list,
    managers: {
      sessions: { list, terminate: vi.fn(), terminateOthers: vi.fn() },
      // «Конфиденциальность» читает это на монтировании
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
const settle = () => act(async() => { await pause(400) })

async function flush(ready: () => boolean, timeout = 3000) {
  const started = Date.now()
  while(!ready() && Date.now() - started < timeout) {
    await act(async() => { await pause(20) })
  }
}

/** Вкладки слайдера, кроме `.item-main`, в порядке DOM. */
const tabs = () => [...columnEl.querySelectorAll<HTMLElement>('.sidebar-slider > .tabs-tab.item-secondary')]

function rowByTitle(root: HTMLElement, title: string) {
  const found = [...root.querySelectorAll<HTMLElement>('.row')]
    .find((row) => row.querySelector('.row-title')?.textContent === title)
  expect(found, `строка «${title}» не найдена`).toBeDefined()
  return found!
}

let columnEl: HTMLElement
let host: TestColumnSlider
let managers: Managers
let list: ReturnType<typeof makeManagers>['list']

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  ;({ managers, list } = makeManagers())
  columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = mountTestColumnSlider(columnEl, managers)
})

afterEach(async() => {
  host.destroy()
  await settle()
  document.body.replaceChildren()
  idb.clear()
  useSettingsStore.getState().update({ passcodeEnabled: false })
  vi.restoreAllMocks()
})

async function openPrivacy() {
  const tab = await act(() => host.openTab(AppPrivacyAndSecurityTab))
  await flush(() => !!tab.container.querySelector('.row'))
  return tab
}

describe('мост React-экрана: вкладка колоночного слайдера', () => {
  const unmounted = vi.fn()
  function Probe({ onBack }: ReactScreenTabProps) {
    useEffect(() => unmounted, [])
    return (
      <SettingsScreen title="PrivacySettings" onBack={onBack}>
        <div className="probe-body" />
      </SettingsScreen>
    )
  }
  const AppProbeTab = scaffoldReactScreenTab({ getComponentModule: async() => ({ default: Probe }) })

  it('экран встаёт в узел вкладки соседом .item-main; стрелка кита закрывает вкладку и размонтирует React-корень', async() => {
    unmounted.mockClear()
    const tab = await act(() => host.openTab(AppProbeTab))

    expect(tab.container.previousElementSibling).toBe(host.mainEl)
    expect(tab.container.classList.contains('active')).toBe(true)
    expect(tab.container.querySelector('.probe-body')).not.toBeNull()
    // шапку и скроллер вкладки заменил каркас кита — второй шапки нет
    expect(tab.container.querySelectorAll('.sidebar-header')).toHaveLength(1)

    await act(async() => { tab.container.querySelector<HTMLElement>('.sidebar-close-button')!.click() })
    await settle()

    expect(tab.container.isConnected).toBe(false)
    expect(host.slider.hasTabsInNavigation()).toBe(false)
    expect(unmounted).toHaveBeenCalledTimes(1)
  })

  it('React-экран замкнут в хосте вкладки (isolation): следующая вкладка въезжает поверх, а не под ним', async() => {
    const tab = await act(() => host.openTab(AppProbeTab))
    const screenHost = tab.container.firstElementChild as HTMLElement
    expect(screenHost.className).toMatch(/host/)
    expect(screenHost.contains(tab.container.querySelector('.probe-body'))).toBe(true)
    // happy-dom каскад CSS-модулей не считает — пин по исходнику правила
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const scss = readFileSync(join(__dirname, 'reactScreenTab.module.scss'), 'utf8')
    expect(scss).toMatch(/\.host\s*\{[^}]*position:\s*relative;[^}]*isolation:\s*isolate;/)
  })
})

describe('«Конфиденциальность» на мосту → вкладки слайдера', () => {
  it('«Active Sessions» открывает вкладку «Устройства» на том же слайдере', async() => {
    const privacy = await openPrivacy()

    await act(async() => { fireEvent.click(rowByTitle(privacy.container, 'Active Sessions')) })
    await flush(() => columnEl.querySelectorAll('.session-row').length > 0)

    expect(list).toHaveBeenCalledTimes(1)
    expect(tabs()).toHaveLength(2)
    expect(tabs()[1].querySelectorAll('.session-row')).toHaveLength(2)
  })

  it('«Passcode Lock» при заданном коде: ввод → верный код → главная вкладка, ввод срезан ДО «Конфиденциальности»', async() => {
    await enablePasscode('1111', { clearAll: async() => {} })
    useSettingsStore.getState().update({ passcodeEnabled: true })
    const privacy = await openPrivacy()

    await act(async() => { fireEvent.click(rowByTitle(privacy.container, 'Passcode Lock')) })
    const fieldLabel = (tab: HTMLElement) => tab.querySelector('.input-field label')?.textContent
    await flush(() => tabs().some((t) => fieldLabel(t) === 'Enter your passcode'))
    const enter = tabs().find((t) => fieldLabel(t) === 'Enter your passcode')!

    const input = enter.querySelector<HTMLInputElement>('input.input-field-input')!
    input.value = '1111'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await act(async() => { await pause(0) })
    enter.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await flush(() => tabs().some((t) => t.textContent?.includes('Turn Passcode Off')))
    await flush(() => tabs().length === 2)
    const history = host.slider.getHistory()
    expect(history).toHaveLength(2)
    expect(history[0]).toBe(privacy)
    expect(history[1]).toBeInstanceOf(AppPasscodeLockTab)
    expect(tabs()[0]).toBe(privacy.container)
  })
})
