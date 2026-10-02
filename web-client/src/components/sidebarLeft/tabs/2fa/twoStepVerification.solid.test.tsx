/** @jsxImportSource solid-js */
/**
 * Мастер 2FA (`sidebarLeft/tabs/2fa/*.solid.tsx`, порт tweb `sidebarLeft/tabs/2fa/*`,
 * 812502980) — задача 19 плана волны 2D.
 *
 * Вкладки гоняются НАСТОЯЩИЕ — объявления из `solidJsTabs/tabs.ts`, открытые через
 * колоночный слайдер (`sidebarLeft/index.ts`) тем же путём, что строка «Конфиденциальности»;
 * следующий шаг каждая открывает сама (`slider.createTab(…).open(…)`). Стабы —
 * только границы: воркер (`managers.auth`), загрузчик лотти (обезьянки, конверт),
 * набор анимированных эмодзи (заставки), геометрия.
 *
 * Предмет — видимое в DOM и на проводе:
 *  • подпись главной и финальной вкладки — ВНУТРИ карточки (`captionOld`, дамп
 *    `14-left-34-two-step-verification`), кнопки — `Button`, не строки;
 *  • проверка текущего пароля: ошибка — `.error` на поле и текст в кнопке,
 *    успех — главная вкладка вместо шага ввода;
 *  • новый пароль проходит все шаги и уходит на сервер ОДНИМ вызовом с почтой;
 *  • финальный шаг срезает шаги мастера из истории;
 *  • выключение — попап `popup-disable-password` → `removePassword(current)`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import lang from '@/lang'
import type { PasswordState } from '@core/managers/authManager'
import type SidebarSlider from '@components/slider'
import type SliderSuperTab from '@components/sliderTab'
import {
  AppTwoStepVerificationEmailTab,
  AppTwoStepVerificationEnterPasswordTab,
  AppTwoStepVerificationHintTab,
  AppTwoStepVerificationReEnterPasswordTab,
  AppTwoStepVerificationSetTab,
  AppTwoStepVerificationTab,
} from '@components/solidJsTabs/tabs'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'

const players = vi.hoisted(() => [] as { remove: ReturnType<typeof vi.fn> }[])
const loadAnimationAsAsset = vi.hoisted(() => vi.fn())
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: {
    loadAnimationAsAsset,
    waitForFirstFrame: (player: unknown) => Promise.resolve(player),
  },
}))

vi.mock('@core/animatedEmoji', () => ({ getAnimatedEmoji: async() => null }))

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  toastNew,
}))

function makePlayer() {
  const player = {
    canvas: [document.createElement('canvas')],
    direction: 1,
    curFrame: 0,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    setSpeed: vi.fn(),
    setDirection: vi.fn(),
    addEventListener: vi.fn(),
    remove: vi.fn(),
  }
  players.push(player)
  return player
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const OFF: PasswordState = { enabled: false, hint: '', email: '' }
const ON: PasswordState = { enabled: true, hint: 'кот', email: 'd***@e***.com' }

let host: InstalledSidebarLeft
let auth: {
  passwordState: ReturnType<typeof vi.fn>
  verifyPassword: ReturnType<typeof vi.fn>
  setPassword: ReturnType<typeof vi.fn>
  removePassword: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  players.length = 0
  loadAnimationAsAsset.mockImplementation(async() => makePlayer())
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)

  auth = {
    passwordState: vi.fn(async() => ON),
    verifyPassword: vi.fn(async(password: string) => {
      if(password !== 'secret') throw new Error('invalid password')
    }),
    setPassword: vi.fn(async() => {}),
    removePassword: vi.fn(async() => {}),
  }
  const managers = { auth } as unknown as Managers

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = installSidebarLeft(managers, columnEl)
})

afterEach(async() => {
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  toastNew.mockClear()
})

const history = (tab: SliderSuperTab) => (tab.slider as SidebarSlider).getHistory()

/** Дождаться, пока верхней вкладкой истории станет вкладка этого класса. */
async function waitTop<T extends SliderSuperTab>(
  from: SliderSuperTab,
  ctor: abstract new (...args: never[]) => T,
): Promise<T> {
  let top: T | undefined
  await vi.waitFor(() => {
    const h = history(from)
    const last = h[h.length - 1]
    expect(last).toBeInstanceOf(ctor)
    top = last as T
  })
  return top!
}

const buttons = (tab: SliderSuperTab) => [...tab.scrollable.container.querySelectorAll<HTMLButtonElement>('button')]
/** текст кнопки без глифа иконки (`span.tgico.button-icon`) */
const textOf = (b: HTMLElement) => b.querySelector('.i18n')?.textContent ?? b.textContent
const buttonByText = (tab: SliderSuperTab, text: string) => {
  const b = buttons(tab).find((el) => textOf(el) === text)
  if(!b) throw new Error('no button ' + text)
  return b
}
const passwordInput = (tab: SliderSuperTab) =>
  tab.scrollable.container.querySelector<HTMLInputElement>('.input-field-password input.input-field-input')!
const typeInto = (input: HTMLElement, value: string) => {
  if(input instanceof HTMLInputElement) input.value = value
  else input.textContent = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** подпись секции лежит ВНУТРИ карточки (`captionOld`), а не ребёнком `-container` */
function expectCaptionInsideCard(tab: SliderSuperTab, text: string) {
  const caption = tab.scrollable.container.querySelector<HTMLElement>('.sidebar-left-section-caption')!
  expect(caption.textContent).toBe(text)
  expect(caption.parentElement!.classList.contains('sidebar-left-section')).toBe(true)
  expect(caption.parentElement!.classList.contains('no-delimiter')).toBe(true)
}

describe('главная вкладка 2FA', () => {
  it('без пароля: заставка, одна кнопка «Set Password» в .input-wrapper, подпись SetPasswordHelp внутри карточки', async() => {
    const tab = await host.openTab(AppTwoStepVerificationTab, { state: OFF })

    expect(tab.container.classList.contains('two-step-verification')).toBe(true)
    expect(tab.container.classList.contains('two-step-verification-main')).toBe(true)
    expect(tab.title.textContent).toBe(lang.TwoStepVerificationTitle)
    expectCaptionInsideCard(tab, lang['TwoStepAuth.SetPasswordHelp'])

    const content = tab.scrollable.container.querySelector('.sidebar-left-section-content')!
    // стикера 🔐 в наборе нет — контейнер всё равно стоит на месте (tweb stickerEmoji.ts:14-16)
    expect(content.children[0].classList.contains('media-sticker-wrapper')).toBe(true)
    const all = buttons(tab)
    expect(all).toHaveLength(1)
    expect(all[0].className).toContain('btn-primary btn-color-primary')
    expect(all[0].parentElement!.classList.contains('input-wrapper')).toBe(true)
    expect(textOf(all[0])).toBe(lang.TwoStepVerificationSetPassword)
  })

  it('с паролем: три Button btn-primary btn-transparent (edit/passwordoff/email), подпись GenericHelp внутри карточки', async() => {
    const tab = await host.openTab(AppTwoStepVerificationTab, { state: ON, plainPassword: 'secret' })

    expectCaptionInsideCard(tab, lang['TwoStepAuth.GenericHelp'].replace('\n', ''))
    const all = buttons(tab)
    expect(all.map(textOf)).toEqual([
      lang['TwoStepAuth.ChangePassword'],
      lang['TwoStepAuth.RemovePassword'],
      lang['TwoStepAuth.ChangeEmail'],
    ])
    for(const b of all) {
      expect(b.classList.contains('btn-primary')).toBe(true)
      expect(b.classList.contains('btn-transparent')).toBe(true)
      expect(b.querySelector('.button-icon')).not.toBeNull()
    }
  })

  it('без почты восстановления третья кнопка — SetupEmail', async() => {
    const tab = await host.openTab(AppTwoStepVerificationTab, { state: { ...ON, email: '' }, plainPassword: 'secret' })
    expect(textOf(buttons(tab)[2])).toBe(lang['TwoStepAuth.SetupEmail'])
  })

  it('выключение: попап popup-disable-password → removePassword(текущий), вкладки мастера закрыты', async() => {
    const tab = await host.openTab(AppTwoStepVerificationTab, { state: ON, plainPassword: 'secret' })
    buttonByText(tab, lang['TwoStepAuth.RemovePassword']).click()

    const popup = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>('.popup.popup-peer.popup-disable-password')
      expect(el).not.toBeNull()
      return el!
    })
    expect(popup.querySelector('.popup-description')!.textContent).toBe(lang.TurnPasswordOffQuestion)
    const disable = [...popup.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === lang.Disable)!
    expect(disable.classList.contains('danger')).toBe(true)
    disable.click()

    await vi.waitFor(() => expect(auth.removePassword).toHaveBeenCalledWith('secret'))
    await vi.waitFor(() => expect(history(tab)).toHaveLength(0))
  })
})

describe('ввод текущего пароля', () => {
  it('заголовок PleaseEnterCurrentPassword, подсказка в подписи поля, обезьянка 157', async() => {
    const tab = await host.openTab(AppTwoStepVerificationEnterPasswordTab, { state: ON })

    expect(tab.title.textContent).toBe(lang.PleaseEnterCurrentPassword)
    expect(tab.container.classList.contains('two-step-verification-enter-password')).toBe(true)
    const field = tab.scrollable.container.querySelector('.input-field.input-field-password')!
    expect(field.querySelector('label')!.textContent).toBe('кот')
    // ловушки автозаполнения вокруг поля и «глазок» (tweb passwordInputField.ts:20-38)
    expect([...field.children].map((el) => el.classList[0] ?? el.tagName)).toEqual([
      'stealthy', 'input-field-input', 'stealthy', 'input-field-border', 'LABEL', 'toggle-visible',
    ])
    expect(field.children[1].getAttribute('type')).toBe('password')
    expect(loadAnimationAsAsset).toHaveBeenCalledWith(expect.objectContaining({ width: 157, height: 157 }), 'TwoFactorSetupMonkeyPeek')
  })

  it('неверный пароль: .error на поле и PASSWORD_HASH_INVALID в кнопке; верный — главная вкладка вместо шага ввода', async() => {
    const tab = await host.openTab(AppTwoStepVerificationEnterPasswordTab, { state: ON })
    const input = passwordInput(tab)
    const btn = buttonByText(tab, lang.Continue)

    typeInto(input, 'wrong')
    btn.click()
    await vi.waitFor(() => expect(textOf(btn)).toBe(lang.PASSWORD_HASH_INVALID))
    expect(input.classList.contains('error')).toBe(true)
    expect(auth.verifyPassword).toHaveBeenCalledWith('wrong')

    typeInto(input, 'secret')
    btn.click()
    const main = await waitTop(tab, AppTwoStepVerificationTab)
    expect(main.payload).toEqual({ state: ON, plainPassword: 'secret' })
    expect(history(tab)).not.toContain(tab)
  })

  it('пустой ввод — .error без запроса к серверу', async() => {
    const tab = await host.openTab(AppTwoStepVerificationEnterPasswordTab, { state: ON })
    buttonByText(tab, lang.Continue).click()
    expect(passwordInput(tab).classList.contains('error')).toBe(true)
    expect(auth.verifyPassword).not.toHaveBeenCalled()
  })

  it('закрытие вкладки гасит опрос состояния и снимает обезьянку (остров разобран)', async() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const tab = await host.openTab(AppTwoStepVerificationEnterPasswordTab, { state: ON })
      await vi.waitFor(() => expect(players).toHaveLength(1))
      const calls = auth.passwordState.mock.calls.length
      tab.close()
      await vi.advanceTimersByTimeAsync(400)
      expect(players[0].remove).toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(30e3)
      expect(auth.passwordState.mock.calls.length).toBe(calls)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('новый пароль — все шаги мастера', () => {
  it('пароль → повтор → подсказка → почта → финал: один setPassword со всем сразу, шаги срезаны', async() => {
    const main = await host.openTab(AppTwoStepVerificationTab, { state: OFF })
    buttonByText(main, lang.TwoStepVerificationSetPassword).click()

    const enter = await waitTop(main, AppTwoStepVerificationEnterPasswordTab)
    expect(enter.title.textContent).toBe(lang.PleaseEnterFirstPassword)
    typeInto(passwordInput(enter), 'n3w')
    buttonByText(enter, lang.Continue).click()

    const reEnter = await waitTop(main, AppTwoStepVerificationReEnterPasswordTab)
    expect(reEnter.container.classList.contains('two-step-verification-re-enter-password')).toBe(true)
    expect(loadAnimationAsAsset).toHaveBeenCalledWith(expect.anything(), 'TwoFactorSetupMonkeyTracking')
    typeInto(passwordInput(reEnter), 'other')
    buttonByText(reEnter, lang.Continue).click()
    expect(passwordInput(reEnter).classList.contains('error')).toBe(true)
    typeInto(passwordInput(reEnter), 'n3w')
    buttonByText(reEnter, lang.Continue).click()

    const hint = await waitTop(main, AppTwoStepVerificationHintTab)
    // у tweb поле подсказки — не plainText: contenteditable `div.input-field-input`
    const hintInput = hint.scrollable.container.querySelector<HTMLElement>('.input-field .input-field-input')!
    typeInto(hintInput, 'n3w')
    buttonByText(hint, lang.Continue).click()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'PasswordAsHintError' })
    typeInto(hintInput, 'подсказка')
    buttonByText(hint, lang.Continue).click()

    const email = await waitTop(main, AppTwoStepVerificationEmailTab)
    expect(email.payload).toMatchObject({ newPassword: 'n3w', hint: 'подсказка', justSetPasssword: true })
    const emailInput = email.scrollable.container.querySelector<HTMLInputElement>('input[name="recovery-email"]')!
    typeInto(emailInput, 'not-an-email')
    buttonByText(email, lang.Continue).click()
    expect(emailInput.classList.contains('error')).toBe(true)
    expect(auth.setPassword).not.toHaveBeenCalled()
    typeInto(emailInput, 'me@example.com')
    expect(emailInput.classList.contains('error')).toBe(false)
    buttonByText(email, lang.Continue).click()

    const set = await waitTop(main, AppTwoStepVerificationSetTab)
    expect(auth.setPassword).toHaveBeenCalledTimes(1)
    expect(auth.setPassword).toHaveBeenCalledWith({ hint: 'подсказка', currentPassword: undefined, newPassword: 'n3w', email: 'me@example.com' })
    expect(set.title.textContent).toBe(lang.TwoStepVerificationPasswordSet)
    expectCaptionInsideCard(set, lang.TwoStepVerificationPasswordSetInfo)
    // шаги мастера срезаны: «назад» с финала не ведёт обратно по ним
    expect(history(set)).toEqual([set])
  })

  it('«Skip» на почте: попап popup-skip-email → setPassword с пустой почтой, финал про пароль', async() => {
    const email = await host.openTab(AppTwoStepVerificationEmailTab, { state: OFF, newPassword: 'n3w', justSetPasssword: true })
    buttonByText(email, lang.YourEmailSkip).click()

    const popup = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>('.popup.popup-peer.popup-skip-email')
      expect(el).not.toBeNull()
      return el!
    })
    expect(popup.querySelector('.popup-title')!.textContent).toBe(lang.YourEmailSkipWarning)
    const skip = [...popup.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === lang.YourEmailSkip)!
    skip.click()

    const set = await waitTop(email, AppTwoStepVerificationSetTab)
    expect(auth.setPassword).toHaveBeenCalledWith({ hint: '', currentPassword: undefined, newPassword: 'n3w', email: '' })
    expect(set.payload).toEqual({ messageFor: 'password' })
  })

  it('смена почты с главной: пароль тот же, финал про почту', async() => {
    const main = await host.openTab(AppTwoStepVerificationTab, { state: ON, plainPassword: 'secret' })
    buttonByText(main, lang['TwoStepAuth.ChangeEmail']).click()

    const email = await waitTop(main, AppTwoStepVerificationEmailTab)
    typeInto(email.scrollable.container.querySelector<HTMLInputElement>('input[name="recovery-email"]')!, 'new@example.com')
    buttonByText(email, lang.Continue).click()

    const set = await waitTop(main, AppTwoStepVerificationSetTab)
    expect(auth.setPassword).toHaveBeenCalledWith({ hint: 'кот', currentPassword: 'secret', newPassword: 'secret', email: 'new@example.com' })
    expect(set.title.textContent).toBe(lang.TwoStepVerificationEmailSet)
    expectCaptionInsideCard(set, lang.TwoStepVerificationEmailSetInfo)
  })
})
