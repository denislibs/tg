/** @jsxImportSource solid-js */
/**
 * Экран блокировки код-паролем — порт tweb `components/passcodeLock/*`
 * (812502980): `passcodeLockScreen.tsx`, `passwordMonkeyTsx.tsx`,
 * `simplePopup.tsx`, `background.tsx`.
 *
 * Пины — на разметку и классы оригинала (баг со стенда: прежний React-экран был
 * самодельным и под замком рисовался «голым HTML»), строки — ключи tweb, и на
 * поведение: 5 попыток, на шестой — таймаут в настройках (через мост
 * `useAppSettings`, путь tweb `passcode.canAttemptAgainOn`); «забыли код» — попап
 * подтверждения с `forceLogout`, текст по числу аккаунтов; запирание кнопкой
 * замка — клон иконки едет к обезьянке и растворяется; попап и его Esc следуют
 * за окном выноса клиента.
 *
 * Стабы — только границы: канал к воркеру (`invokePasscode`), сверка/разблокировка
 * (`lib/passcode/actions.ts` — PBKDF2 и ключ проверены своими тестами), число
 * аккаунтов из открытого слоя, лотти обезьянки и холсты фона (у happy-dom нет 2D).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { setAppWindow } from '@helpers/appWindow'
import { useSettingsStore } from '@/settings'
import PasscodeLockScreen from './passcodeLockScreen.solid'
import styles from './passcodeLockScreen.module.scss'
import monkeyStyles from './passwordMonkeyTsx.module.scss'

const invokePasscode = vi.hoisted(() => vi.fn(async(_task: { method: string }) => undefined))
vi.mock('@/client/passcodeClient', () => ({ invokePasscode }))

const actions = vi.hoisted(() => ({
  isMyPasscode: vi.fn(async(passcode: string) => passcode === '1234'),
  unlockWithPasscode: vi.fn(async(_passcode: string) => {}),
}))
vi.mock('@lib/passcode/actions', () => actions)

const totalAccounts = vi.hoisted(() => ({ value: undefined as number | undefined }))
vi.mock('@core/auth/numberOfAccounts', () => ({
  getUnencryptedTotalAccounts: async() => totalAccounts.value,
}))

vi.mock('@lib/lottie/lottieLoader', () => ({
  default: {
    loadAnimationAsAsset: vi.fn(async() => ({ addEventListener() {}, remove() {} })),
    waitForFirstFrame: vi.fn(async() => {}),
  },
}))

const toNextPosition = vi.hoisted(() => vi.fn())
vi.mock('@core/chat/gradientRenderer', () => ({
  default: class {
    init() {}
    toNextPosition = toNextPosition
    static createCanvas() { return document.createElement('canvas') }
  },
}))
vi.mock('@core/chat/patternRenderer', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  renderPattern: vi.fn(),
}))

// мост настроек — настоящий, запись под шпионом: срок попытки идёт путём tweb
const bridge = vi.hoisted(() => ({ setAppSettings: undefined as unknown as ReturnType<typeof vi.fn> }))
vi.mock('@stores/appSettings.solid', async(importOriginal) => {
  const original = await importOriginal<typeof import('@stores/appSettings.solid')>()
  bridge.setAppSettings = vi.fn(original.setAppSettings)
  return { ...original, useAppSettings: () => [original.appSettings, bridge.setAppSettings] }
})

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(get: () => T | null | undefined | false, timeout = 2000): Promise<T> {
  const started = Date.now()
  for(;;) {
    const value = get()
    if(value) return value
    if(Date.now() - started > timeout) throw new Error('waitFor: timeout')
    await pause(10)
  }
}

let dispose: (() => void) | undefined
let onUnlock: ReturnType<typeof vi.fn<() => void>>

function mount(lock?: { fromLockIcon: HTMLElement, onAnimationEnd: () => void }) {
  const host = document.createElement('div')
  host.classList.add('passcode-lock-screen')
  if(lock) host.append(lock.fromLockIcon)
  document.body.append(host)
  onUnlock = vi.fn<() => void>()
  dispose = render(() => <PasscodeLockScreen onUnlock={onUnlock} {...lock} />, host)
  return host
}

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)
// у поля пароля по бокам — «невидимки» против автозаполнения (`passwordInputField.ts`)
const input = () => $<HTMLInputElement>('.input-field input:not(.stealthy)')!
const errorLabel = () => $('.input-field .input-field-error-label')?.textContent
const submit = () => $<HTMLButtonElement>('button[type="submit"]')!

function type(value: string) {
  input().value = value
  input().dispatchEvent(new Event('input', { bubbles: true }))
}

async function send() {
  $<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await pause(0)
  await pause(0)
}

beforeEach(() => {
  totalAccounts.value = undefined
  invokePasscode.mockClear()
  actions.isMyPasscode.mockClear()
  actions.unlockWithPasscode.mockClear()
  toNextPosition.mockClear()
  bridge.setAppSettings.mockClear()
  useSettingsStore.setState({ passcodeCanAttemptAgainOn: null })
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  setAppWindow(window)
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('PasscodeLockScreen — разметка tweb', () => {
  it('контейнер → фон + карточка: обезьянка, форма (поле, «Proceed»), подпись «забыли код»', async() => {
    const host = mount()

    const container = host.firstElementChild as HTMLElement
    expect(container.classList.contains(styles.Container)).toBe(true)

    // tweb `background.tsx`: фон чата за экраном — первым ребёнком контейнера
    // (не на мобильном — там `<Show>` его не рисует)
    const card = container.querySelector(`:scope > .${styles.Card}`) as HTMLElement
    expect(card).not.toBeNull()
    expect(container.firstElementChild).not.toBe(card)

    const [monkey, space1, form, space2, description] = Array.from(card.children) as HTMLElement[]
    expect(monkey.classList.contains(monkeyStyles.PasswordMonkey)).toBe(true)
    expect(monkey.style.getPropertyValue('--size')).toBe('100px')
    expect(monkey.querySelector('.media-sticker-wrapper')).not.toBeNull()
    // заглушка до загрузки лотти (tweb: «Prevent the monkey blinking»)
    expect(monkey.querySelector(`img.${monkeyStyles.MonkeyImage}`)?.getAttribute('src'))
      .toBe('assets/img/password-monkey-closed.png')

    expect(space1.style.paddingTop).toBe('1.125rem')
    expect(form.tagName).toBe('FORM')
    expect(space2.style.paddingTop).toBe('1.625rem')
    expect(description.classList.contains(styles.Description)).toBe(true)

    const [field, space3, button] = Array.from(form.children) as HTMLElement[]
    expect(field.classList.contains('input-field')).toBe(true)
    expect(field.classList.contains(styles.Input)).toBe(true)
    expect(field.classList.contains('input-field-password')).toBe(true)
    expect(input().getAttribute('type')).toBe('password')
    expect(field.querySelector('label')?.textContent).toBe('Enter your passcode')
    expect(space3.style.paddingTop).toBe('1rem')

    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('submit')
    for(const cls of ['btn-primary', 'btn-color-primary', 'btn-large', styles.SubmitButton]) {
      expect(button.classList.contains(cls)).toBe(true)
    }
    expect(button.textContent).toBe('Proceed')
    expect((button as HTMLButtonElement).disabled).toBe(true)

    await waitFor(() => description.querySelector(`button.${styles.LogoutButton}`))
    expect(description.textContent).toBe('Note: if you forget your passcode, you\'ll need to log out.')
    const logout = description.querySelector(`button.${styles.LogoutButton}`)!
    expect(logout.textContent).toBe('log out')
    expect(logout.getAttribute('aria-label')).toBe('Log out')
  })

  it.each([undefined, 1])('аккаунтов %s — просто «выйти» (`ForgotPasscode.OneAccount`)', async(count) => {
    totalAccounts.value = count
    mount()
    await waitFor(() => $(`.${styles.Description} button`))
    await pause(10)
    expect($(`.${styles.Description}`)!.textContent)
      .toBe('Note: if you forget your passcode, you\'ll need to log out.')
  })

  it('несколько аккаунтов — «выйти из всех» (`ForgotPasscode.MultipleAccounts`)', async() => {
    totalAccounts.value = 2
    mount()
    await waitFor(() => $(`.${styles.Description}`)?.textContent?.includes('all your current accounts'))
    expect($(`.${styles.Description}`)!.textContent)
      .toBe('Note: if you forget your passcode, you\'ll need to log out from all your current accounts.')
  })

  it('ввод включает кнопку и сдвигает градиент фона', async() => {
    mount()
    type('12')
    expect(submit().disabled).toBe(false)
    await waitFor(() => toNextPosition.mock.calls.length > 0)
  })
})

describe('PasscodeLockScreen — поведение tweb', () => {
  it('верный код → `unlockWithPasscode` и `onUnlock`', async() => {
    mount()
    type('1234')
    await send()
    await waitFor(() => onUnlock.mock.calls.length > 0)
    expect(actions.unlockWithPasscode).toHaveBeenCalledWith('1234')
  })

  it('неверный код — ошибка поля `PasscodeLock.WrongPasscode`, ввод снимает её', async() => {
    mount()
    type('0000')
    await send()
    const field = await waitFor(() => $('.input-field.has-error-label'))
    expect(field.querySelector('.input-field-error-label[role="alert"]')!.textContent).toBe('Wrong passcode. Please try again.')
    expect(input().classList.contains('error')).toBe(true)
    expect(onUnlock).not.toHaveBeenCalled()

    type('00000')
    await waitFor(() => !$('.input-field.has-error-label') && !input().classList.contains('error'))
  })

  it('шестая неудача — «слишком много попыток» и таймаут 60 с в настройках; до него код не сверяется', async() => {
    mount()
    // tweb `attempts > MAX_ATTEMPTS` (5): пять неудач — ещё обычная ошибка, без срока
    for(let i = 0; i < 5; i++) {
      type('000' + i)
      await send()
    }
    await waitFor(() => errorLabel() === 'Wrong passcode. Please try again.')
    expect(useSettingsStore.getState().passcodeCanAttemptAgainOn).toBeNull()
    expect(bridge.setAppSettings).not.toHaveBeenCalled()

    type('0005')
    await send()
    await waitFor(() => errorLabel() === 'Too many attempts, try again later')
    // запись — мостом, путём tweb `settings.passcode.canAttemptAgainOn`
    expect(bridge.setAppSettings).toHaveBeenCalledTimes(1)
    const [section, field, until] = bridge.setAppSettings.mock.calls[0] as [string, string, number]
    expect([section, field]).toEqual(['passcode', 'canAttemptAgainOn'])
    expect(useSettingsStore.getState().passcodeCanAttemptAgainOn).toBe(until)
    expect(until - Date.now()).toBeGreaterThan(55_000)
    expect(until - Date.now()).toBeLessThanOrEqual(60_000)

    actions.isMyPasscode.mockClear()
    type('1234')
    await send()
    await waitFor(() => errorLabel() === 'Too many attempts, try again later')
    expect(actions.isMyPasscode).not.toHaveBeenCalled()
    expect(onUnlock).not.toHaveBeenCalled()
  })

  it('истёкший срок — сверка снова идёт, срок снимается мостом (null)', async() => {
    useSettingsStore.setState({ passcodeCanAttemptAgainOn: Date.now() - 1 })
    mount()
    type('1234')
    await send()
    await waitFor(() => onUnlock.mock.calls.length > 0)
    expect(bridge.setAppSettings).toHaveBeenCalledWith('passcode', 'canAttemptAgainOn', null)
    expect(useSettingsStore.getState().passcodeCanAttemptAgainOn).toBeNull()
  })

  it('срок, записанный в настройки снаружи (соседняя вкладка), читается мостом — код не сверяется', async() => {
    mount()
    useSettingsStore.getState().update({ passcodeCanAttemptAgainOn: Date.now() + 60_000 })
    type('1234')
    await send()
    await waitFor(() => errorLabel() === 'Too many attempts, try again later')
    expect(actions.isMyPasscode).not.toHaveBeenCalled()
  })

  it('«log out» → попап подтверждения tweb; «Log out» зовёт `forceLogout`, «Cancel» и Esc закрывают', async() => {
    mount()
    const logout = await waitFor(() => $<HTMLButtonElement>(`button.${styles.LogoutButton}`))
    logout.click()

    const popup = await waitFor(() => $('.popup.popup-peer.popup-confirmation.active'))
    // `Portal` в `getOverlayRoot()` — поверх, вне корня экрана
    expect(popup.closest('.passcode-lock-screen')).toBeNull()
    expect(popup.parentElement!.parentElement).toBe(document.body)
    const dialog = popup.querySelector('.popup-container')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.querySelector('.popup-header .popup-title')!.textContent).toBe('Log out')
    expect(dialog.querySelector('.popup-description')!.textContent).toBe('Are you sure you want to log out?')
    const [confirm, cancel] = Array.from(dialog.querySelectorAll('.popup-buttons > .popup-button.btn')) as HTMLButtonElement[]
    expect(confirm.classList.contains('danger')).toBe(true)
    expect(confirm.textContent).toBe('Log out')
    expect(cancel.classList.contains('primary')).toBe(true)
    expect(cancel.textContent).toBe('Cancel')

    cancel.click()
    await waitFor(() => !$('.popup-confirmation'))

    logout.click()
    await waitFor(() => $('.popup-confirmation.active'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await waitFor(() => !$('.popup-confirmation'))

    logout.click()
    const again = await waitFor(() => $('.popup-confirmation.active'))
    ;(again.querySelector('.popup-button.danger') as HTMLButtonElement).click()
    expect(invokePasscode).toHaveBeenCalledWith({ method: 'forceLogout' })
  })
})

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect

describe('PasscodeLockScreen — запирание кнопкой замка (tweb `passcodeLockScreen.tsx:73-91`)', () => {
  it('клон иконки едет к центру обезьянки со своим масштабом, растворяется; обезьянка — после; в конце onAnimationEnd', async() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function(this: Element) {
      return this.classList.contains(monkeyStyles.PasswordMonkey) ? rect(100, 200, 100, 100) : rect(300, 20, 24, 24)
    })
    const fromLockIcon = document.createElement('span')
    fromLockIcon.className = 'sidebar-lock-button-icon passcode-lock-screen__animated-lock-icon'
    const onAnimationEnd = vi.fn()

    mount({ fromLockIcon, onAnimationEnd })

    const monkey = $(`.${monkeyStyles.PasswordMonkey}`)!
    // пока клон в пути, обезьянка скрыта
    expect(monkey.classList.contains(monkeyStyles.hidden)).toBe(true)
    expect(fromLockIcon.style.getPropertyValue('--x')).toBe('150px')
    expect(fromLockIcon.style.getPropertyValue('--y')).toBe('250px')
    expect(Number(fromLockIcon.style.getPropertyValue('--scale'))).toBeCloseTo(100 / 24)
    expect(fromLockIcon.classList.contains('passcode-lock-screen__animated-lock-icon--shift-body')).toBe(true)
    expect(fromLockIcon.classList.contains('passcode-lock-screen__animated-lock-icon--disappear')).toBe(false)

    await waitFor(() => fromLockIcon.classList.contains('passcode-lock-screen__animated-lock-icon--disappear'))
    expect(monkey.classList.contains(monkeyStyles.hidden)).toBe(false)
    expect(fromLockIcon.isConnected).toBe(true)
    expect(onAnimationEnd).not.toHaveBeenCalled()

    await waitFor(() => onAnimationEnd.mock.calls.length > 0)
    expect(fromLockIcon.isConnected).toBe(false)
  })

  it('без иконки (старт под замком) обезьянка видна сразу', () => {
    mount()
    expect($(`.${monkeyStyles.PasswordMonkey}`)!.classList.contains(monkeyStyles.hidden)).toBe(false)
  })
})

// tweb `tests/simplePopupWindow.test.tsx`: клиент вынесен в окно Document PiP —
// портал попапа переехал туда, и Esc приходит в документ окна выноса.
describe('SimplePopup — Esc в документе окна выноса (tweb bindActiveWindowListener)', () => {
  it('после setAppWindow Esc из перенесённого попапа закрывает его', async() => {
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    mount()
    const logout = await waitFor(() => $<HTMLButtonElement>(`button.${styles.LogoutButton}`))
    logout.click()
    const popup = await waitFor(() => $('.popup-confirmation.active'))

    const portal = popup.parentElement!
    setAppWindow(iframe.contentWindow!)
    iframe.contentDocument!.body.append(portal)
    await pause(0)

    popup.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await waitFor(() => !iframe.contentDocument!.querySelector('.popup-confirmation'))
  })
})
