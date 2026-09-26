/** @jsxImportSource solid-js */
/**
 * Вкладки «Код-пароль» (`mainTab.solid.tsx`, `enterPasswordTab.solid.tsx`,
 * порт tweb `sidebarLeft/tabs/passcodeLock/*`, 812502980) — задача 18 плана 2D.
 *
 * Вкладки гоняются НАСТОЯЩИЕ — `AppPasscodeLockTab`/`AppPasscodeEnterPasswordTab`
 * из `solidJsTabs/tabs.ts` через хост (`settingsSliderHost.ts`), логика кода —
 * настоящая (`core/passcode.ts`: PBKDF2 и сравнение хеша). Стабы — только
 * границы: IndexedDB (`idbKv` — словарь в памяти), writer офлайн-стора
 * (`managers.persist.clearAll`), лотти-заставка, попап подтверждения,
 * Web Animations (у happy-dom их нет) и геометрия.
 *
 * Предмет — то, что видно в DOM и в настройках:
 *  • без кода: заставка, описание, `button.btn-primary.btn-color-primary.btn-large`
 *    «Turn Passcode On», подпись `PasscodeLock.Notice` — ВНЕ карточки;
 *  • включение: два шага ввода, несовпадение — ошибка поля, совпадение — код
 *    задан, вкладки ввода срезаны, подсказка «Passcode has been set.»;
 *  • с кодом: «Turn Passcode Off» — обычная строка (не danger) с `lockoff`,
 *    «Change passcode» с `key_filled`, автоблокировка — InlineSelect, пишет
 *    `passcodeAutoLockMins`; тумблер сочетания и ShortcutBuilder пишут свои ключи;
 *  • выключение — через попап подтверждения (кнопка danger), затем код снят;
 *  • DoD 5: закрытая вкладка снимает свой Solid-остров.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import lang from '@/lang'
import { useSettingsStore } from '@/settings'
import { useLockStore } from '@/stores/lockStore'
import Icon from '@components/icon'
import { AppPasscodeEnterPasswordTab, AppPasscodeLockTab } from '@components/solidJsTabs/tabs'
import type SidebarSlider from '@components/slider'
import { createSettingsSliderHost, type SettingsSliderHost } from '../../settingsSliderHost'
import { installSpecLabelActivation } from '@/test/specLabelActivation'
import styles from './mainTab.module.scss'
import shortcutStyles from './shortcutBuilder.module.scss'
import selectStyles from './inlineSelect.module.scss'

const idb = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@core/store/idbKv', () => ({
  idbGet: async(key: string) => idb.get(key),
  idbSet: async(key: string, val: unknown) => { idb.set(key, val) },
  idbDel: async(key: string) => { idb.delete(key) },
}))

vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { loadAnimationAsAsset: vi.fn(async() => ({ playOrRestart() {}, remove() {} })) },
}))

const confirmationPopup = vi.hoisted(() => vi.fn(async() => {}))
vi.mock('@components/popups/popupPeer', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmationPopup,
}))

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(get: () => T | null | undefined | false, timeout = 3000): Promise<T> {
  const started = Date.now()
  for(;;) {
    const value = get()
    if(value) return value
    if(Date.now() - started > timeout) throw new Error('waitFor: timeout')
    await pause(10)
  }
}

let host: SettingsSliderHost
let columnEl: HTMLElement
let clearAll: ReturnType<typeof vi.fn>
let uninstallLabelActivation: () => void

beforeEach(() => {
  uninstallLabelActivation = installSpecLabelActivation()
  Element.prototype.animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  idb.clear()
  useLockStore.getState().unlock()
  useSettingsStore.getState().update({
    passcodeEnabled: false,
    passcodeAutoLockMins: 0,
    passcodeLockShortcutEnabled: false,
    passcodeLockShortcut: ['Alt'],
  })

  clearAll = vi.fn(async() => {})
  const managers = { persist: { clearAll } } as unknown as Managers

  columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = createSettingsSliderHost(columnEl, managers)
})

afterEach(async() => {
  uninstallLabelActivation()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  delete (Element.prototype as { animate?: unknown }).animate
  vi.restoreAllMocks()
  confirmationPopup.mockClear()
})

/** Все открытые вкладки хоста (кроме заглушки-корня), в порядке DOM. */
const tabs = () => [...columnEl.querySelectorAll<HTMLElement>('.sidebar-slider > .tabs-tab.sidebar-slider-item')]
const titleOf = (tab: HTMLElement) => tab.querySelector('.sidebar-header__title')?.textContent

function row(root: HTMLElement, title: string) {
  const el = [...root.querySelectorAll<HTMLElement>('.row')]
    .find((r) => r.querySelector('.row-title')?.textContent === title)
  if(!el) throw new Error('no row ' + title)
  return el
}

function button(root: HTMLElement, text: string) {
  const el = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)
  if(!el) throw new Error('no button ' + text)
  return el
}

/** Вкладка ввода кода: ждём, пока въедет вкладка с полем и нужной подписью. */
async function enterTab(label: string) {
  return waitFor(() => tabs().find((t) => t.querySelector('.input-field label')?.textContent === label))
}

async function typeAndSubmit(tab: HTMLElement, value: string) {
  const input = tab.querySelector<HTMLInputElement>('.input-field input.input-field-input')!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await pause(0)
  tab.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

const iconText = (name: Parameters<typeof Icon>[0]) => Icon(name).textContent

describe('вкладка «Код-пароль» — код не задан', () => {
  it('заставка, описание, кнопка btn-large и подпись Notice вне карточки', async() => {
    const tab = await host.openTab(AppPasscodeLockTab)
    const container = tab.scrollable.container.querySelector<HTMLElement>('.sidebar-left-section-container')!
    const section = container.querySelector<HTMLElement>('.sidebar-left-section-content')!

    expect(titleOf(tab.container)).toBe(lang['PasscodeLock.Title'])
    expect(section.querySelector(`.${styles.MainDescription}`)?.textContent).toBe(lang['PasscodeLock.Description'])
    const turnOn = button(section, lang['PasscodeLock.TurnOn'])
    expect([...turnOn.classList]).toEqual(expect.arrayContaining(['btn-primary', 'btn-color-primary', 'btn-large']))

    const caption = container.querySelector('.sidebar-left-section-caption')!
    expect(caption.textContent).toBe(lang['PasscodeLock.Notice'])
    expect(caption.parentElement).toBe(container)
  })

  it('включение: два шага, несовпадение — ошибка, совпадение — код задан, ввод срезан, подсказка', async() => {
    const main = await host.openTab(AppPasscodeLockTab)
    button(main.scrollable.container, lang['PasscodeLock.TurnOn']).click()

    const first = await enterTab(lang['PasscodeLock.EnterAPasscode'])
    const next = button(first, lang['PasscodeLock.Next'])
    expect(next.disabled).toBe(true)
    await typeAndSubmit(first, '1234')

    const second = await enterTab(lang['PasscodeLock.ReEnterPasscode'])
    expect(button(second, lang['PasscodeLock.SetPasscode'])).toBeTruthy()

    await typeAndSubmit(second, '4321')
    const error = await waitFor(() => second.querySelector('.input-field-error-label'))
    expect(error.textContent).toBe(lang['PasscodeLock.PasscodesDontMatch'])
    expect(useSettingsStore.getState().passcodeEnabled).toBe(false)

    await typeAndSubmit(second, '1234')
    await waitFor(() => useSettingsStore.getState().passcodeEnabled)
    expect(clearAll).toHaveBeenCalledTimes(1)

    const hint = await waitFor(() => main.scrollable.container.querySelector<HTMLElement>('.quiz-hint'))
    expect(hint.classList.contains(styles.Hint)).toBe(true)
    expect(hint.querySelector('.quiz-hint-text')?.textContent).toBe(lang['PasscodeLock.PasscodeHasBeenSet'])

    // вкладки ввода срезаны: в истории слайдера — одна главная (срез и
    // закрытие синхронны и идут до подсказки), узлы ввода разобраны после
    // перехода; содержимое — уже «код задан»
    expect((main.slider as unknown as SidebarSlider).getHistory()).toEqual([main])
    await waitFor(() => tabs().length === 1)
    expect(tabs()).toEqual([main.container])
    expect(row(main.scrollable.container, lang['PasscodeLock.TurnOff.Title'])).toBeTruthy()
  })
})

describe('вкладка «Код-пароль» — код задан', () => {
  beforeEach(() => {
    useSettingsStore.getState().update({ passcodeEnabled: true })
  })

  it('строки Turn Off (lockoff, не danger) и Change (key_filled); подпись — Description + Notice вне карточки', async() => {
    const tab = await host.openTab(AppPasscodeLockTab)
    const [first] = [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
    const turnOff = row(first, lang['PasscodeLock.TurnOff.Title'])
    const change = row(first, lang['PasscodeLock.ChangePasscode'])

    expect(turnOff.querySelector('.row-icon-icon')?.textContent).toBe(iconText('lockoff'))
    expect(change.querySelector('.row-icon-icon')?.textContent).toBe(iconText('key_filled'))
    // tweb `mainTab.tsx:260` — строка без `color="danger"`
    expect(turnOff.classList.contains('hover-effect')).toBe(true)
    expect(turnOff.classList.contains('hover-danger-effect')).toBe(false)
    expect(turnOff.classList.contains('danger')).toBe(false)

    // tweb `section.tsx`: `class` секции — на контейнере
    expect(first.classList.contains(styles.FirstSection)).toBe(true)
    const caption = first.querySelector('.sidebar-left-section-caption')!
    expect(caption.parentElement).toBe(first)
    expect(caption.textContent).toBe(lang['PasscodeLock.Description'] + lang['PasscodeLock.Notice'])
  })

  it('автоблокировка: InlineSelect со значением «Disabled», выбор пишет passcodeAutoLockMins', async() => {
    const tab = await host.openTab(AppPasscodeLockTab)
    const autoLock = row(tab.scrollable.container, lang['PasscodeLock.AutoLock'])
    expect(autoLock.classList.contains(styles.Row)).toBe(true)
    expect(autoLock.querySelector(`.row-right .${selectStyles.Value}`)?.textContent).toBe(lang['PasscodeLock.Disabled'])

    autoLock.querySelector<HTMLElement>('.row-title')!.click()
    const options = await waitFor(() => {
      const list = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      return list.length ? list : null
    })
    expect(options.map((o) => o.textContent)).toEqual(['Disabled', '1 min', '5 min', '10 min', '15 min', '30 min'])

    options[2].click()
    expect(useSettingsStore.getState().passcodeAutoLockMins).toBe(5)
    await waitFor(() => autoLock.querySelector(`.${selectStyles.Value}`)?.textContent === '5 min')
  })

  it('сочетание: тумблер пишет passcodeLockShortcutEnabled ровно один раз, билдер свёрнут, пока выключен', async() => {
    const tab = await host.openTab(AppPasscodeLockTab)
    const [, second] = [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
    const toggle = row(second, lang['PasscodeLock.EnableLockShortcut'])
    const builderRow = second.querySelector<HTMLElement>(`.${styles.ShortcutBuilderRow}`)!

    expect(second.querySelector('.sidebar-left-section-caption')?.textContent).toBe(lang['PasscodeLock.LockShortcutDescription'])
    expect(builderRow.classList.contains(styles.collapsed)).toBe(true)

    toggle.querySelector<HTMLElement>('.row-title')!.click()
    await pause(0)
    expect(useSettingsStore.getState().passcodeLockShortcutEnabled).toBe(true)
    expect(toggle.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true)
    expect(builderRow.classList.contains(styles.collapsed)).toBe(false)
  })

  it('ShortcutBuilder: клавиша добавляется, снятие последней подставляет другую', async() => {
    useSettingsStore.getState().update({ passcodeLockShortcutEnabled: true })
    const tab = await host.openTab(AppPasscodeLockTab)
    const keys = [...tab.scrollable.container.querySelectorAll<HTMLButtonElement>(`.${shortcutStyles.KeyButton}`)]
    expect(keys.map((k) => k.textContent)).toEqual(['Ctrl', 'Alt', 'Shift', iconText('win_key_filled')])
    expect(keys.map((k) => k.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false'])
    expect(tab.scrollable.container.querySelector(`.${shortcutStyles.TargetKey}`)?.textContent).toBe('L')

    keys[0].click()
    expect(useSettingsStore.getState().passcodeLockShortcut).toEqual(['Alt', 'Ctrl'])
    await pause(0)
    expect(keys[0].getAttribute('aria-pressed')).toBe('true')

    // сняли последнюю (Ctrl) — случайная из трёх других (tweb :36-40): random 0 → Alt
    useSettingsStore.getState().update({ passcodeLockShortcut: ['Ctrl'] })
    await pause(0)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    keys[0].click()
    expect(useSettingsStore.getState().passcodeLockShortcut).toEqual(['Alt'])
  })

  it('выключение: попап подтверждения с danger-кнопкой, код снят, вкладка закрыта, подсказка', async() => {
    idb.set('passcode', { verificationHash: [1], verificationSalt: [2] })
    const tab = await host.openTab(AppPasscodeLockTab)
    row(tab.scrollable.container, lang['PasscodeLock.TurnOff.Title']).querySelector<HTMLElement>('.row-title')!.click()

    expect(confirmationPopup).toHaveBeenCalledTimes(1)
    expect(confirmationPopup).toHaveBeenCalledWith(expect.objectContaining({
      titleLangKey: 'PasscodeLock.TurnOff.Title',
      descriptionLangKey: 'PasscodeLock.TurnOff.Description',
      button: expect.objectContaining({ langKey: 'PasscodeLock.TurnOff', isDanger: true }),
    }))

    await waitFor(() => !useSettingsStore.getState().passcodeEnabled)
    expect(idb.has('passcode')).toBe(false)
    const hint = await waitFor(() => columnEl.querySelector<HTMLElement>('.quiz-hint'))
    expect(hint.querySelector('.quiz-hint-text')?.textContent).toBe(lang['PasscodeLock.PasscodeHasBeenDisabled'])
    await waitFor(() => tabs().length === 0 || !tabs().some((t) => t.classList.contains('active')))
  })

  it('смена кода: ввод без старого кода (он спрошен при входе), совпадение — новый хеш, подсказка', async() => {
    const main = await host.openTab(AppPasscodeLockTab)
    row(main.scrollable.container, lang['PasscodeLock.ChangePasscode']).querySelector<HTMLElement>('.row-title')!.click()

    const first = await enterTab(lang['PasscodeLock.EnterAPasscode'])
    expect(titleOf(first)).toBe(lang['PasscodeLock.EnterANewPasscode'])
    await typeAndSubmit(first, '5555')

    const second = await enterTab(lang['PasscodeLock.ReEnterPasscode'])
    expect(titleOf(second)).toBe(lang['PasscodeLock.ReEnterPasscode'])
    await typeAndSubmit(second, '5555')

    const hint = await waitFor(() => main.scrollable.container.querySelector<HTMLElement>('.quiz-hint'))
    expect(hint.querySelector('.quiz-hint-text')?.textContent).toBe(lang['PasscodeLock.PasscodeHasBeenChanged'])
    expect(idb.has('passcode')).toBe(true)
    expect(clearAll).toHaveBeenCalledTimes(1)
  })

  it('DoD 5: закрытая вкладка снимает свой Solid-остров', async() => {
    const tab = await host.openTab(AppPasscodeLockTab)
    expect(tab.scrollable.container.querySelector('.row')).not.toBeNull()
    tab.close()
    await pause(400)
    expect(tab.scrollable.container.querySelector('.row')).toBeNull()
  })
})

describe('вкладка ввода кода', () => {
  const openEnter = (onSubmit: (...args: unknown[]) => Promise<void> | void) => host.openTab(AppPasscodeEnterPasswordTab, {
    onSubmit,
    buttonText: 'PasscodeLock.Next',
    inputLabel: 'PasscodeLock.EnterYourPasscode',
  })

  it('поле пароля (type=password, глаз), кнопка гаснет пустой и длиннее 32; подпись Notice вне карточки', async() => {
    const tab = await openEnter(vi.fn())
    const root = tab.scrollable.container
    const field = root.querySelector<HTMLElement>('.input-field')!
    const input = field.querySelector<HTMLInputElement>('input.input-field-input')!
    const next = button(root, lang['PasscodeLock.Next'])

    expect(field.classList.contains('input-field-password')).toBe(true)
    expect(input.type).toBe('password')
    expect(field.querySelectorAll('input.stealthy')).toHaveLength(2)
    field.querySelector<HTMLElement>('.toggle-visible')!.click()
    expect(input.type).toBe('text')

    expect(next.disabled).toBe(true)
    input.value = 'x'.repeat(33)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await pause(0)
    expect(next.disabled).toBe(true)
    input.value = 'x'.repeat(32)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await pause(0)
    expect(next.disabled).toBe(false)

    const container = root.querySelector('.sidebar-left-section-container')!
    const caption = container.querySelector('.sidebar-left-section-caption')!
    expect(caption.parentElement).toBe(container)
    expect(caption.textContent).toBe(lang['PasscodeLock.Notice'])
  })

  it('onSubmit получает код, саму вкладку и действия; бросок — ошибка поля, ввод её снимает', async() => {
    const onSubmit = vi.fn(async() => { throw new Error('WRONG') })
    const tab = await openEnter(onSubmit)
    await typeAndSubmit(tab.container, '4242')
    await pause(0)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [passcode, self, actions] = onSubmit.mock.calls[0] as unknown as [string, unknown, { isMyPasscode: unknown }]
    expect(passcode).toBe('4242')
    expect(self).toBe(tab)
    expect(typeof actions.isMyPasscode).toBe('function')
    const error = await waitFor(() => tab.container.querySelector('.input-field-error-label'))
    expect(error.textContent).toBe(lang['PasscodeLock.PasscodesDontMatch'])

    const input = tab.container.querySelector<HTMLInputElement>('input.input-field-input')!
    input.value = '42421'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await pause(0)
    expect(tab.container.querySelector('.input-field-error-label')).toBeNull()
  })
})
