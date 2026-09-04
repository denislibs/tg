/** @jsxImportSource solid-js */
/**
 * Пины `SignUpCard.solid.tsx` (Solid-порт нашей React `cards/SignUpCard.tsx`,
 * которая сама — порт tweb `pages/cards/SignUpCard.tsx`, 181 строка).
 *
 * Поведенческий пин по сути карточки: имя/фамилия → `managers.auth.signUp`,
 * живой предпросмотр ФИО в тайтле, аватар выбирается ДО сабмита, а грузится
 * УЖЕ ПОД СЕССИЕЙ (см. докблок карточки — «сборка данных отправки» описывает,
 * почему интерактивный кроппер вне периметра задачи 5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import SignUpCard from './SignUpCard.solid'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

function mount(auth: Partial<Managers['auth']> = {}, media: Partial<Managers['media']> = {}, profile: Partial<Managers['profile']> = {}) {
  const navigate = vi.fn()
  const toIm = vi.fn().mockResolvedValue(undefined)
  const managers = {
    auth: { signUp: vi.fn().mockResolvedValue({ user: {} }), ...auth },
    media: { upload: vi.fn().mockResolvedValue(999), ...media },
    profile: { addPhoto: vi.fn().mockResolvedValue({}), ...profile },
  } as unknown as Managers

  const ctx: AuthFlowContextValue = {
    managers,
    current: () => null,
    navigate,
    back: async () => {},
    toIm,
  }

  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    (() => (
      <AuthFlowContext.Provider value={ctx}>
        <SignUpCard spec={{ name: 'signUp', payload: { token: 'su-tok' } }} />
      </AuthFlowContext.Provider>
    )) as () => never,
    host,
  )

  const inputs = () => [...host!.querySelectorAll<HTMLDivElement>('.input-field-input')]
  const firstInput = () => inputs()[0]
  const lastInput = () => inputs()[1]
  const submitBtn = () => host!.querySelector('button') as HTMLButtonElement
  const setField = (el: HTMLDivElement, value: string) => {
    el.textContent = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const fileInput = () => host!.querySelector('input[type="file"]') as HTMLInputElement
  return { navigate, toIm, managers, firstInput, lastInput, submitBtn, setField, fileInput }
}

describe('SignUpCard.solid: живой предпросмотр ФИО', () => {
  it('пусто — заголовок «Your Name», ввод имени — заголовок = ФИО', () => {
    const { firstInput, lastInput, setField } = mount()
    expect(host!.querySelector('[class*="title"]')!.textContent).toBe('Your Name')

    setField(firstInput(), 'Ada')
    expect(host!.querySelector('[class*="title"]')!.textContent).toBe('Ada')

    setField(lastInput(), 'Lovelace')
    expect(host!.querySelector('[class*="title"]')!.textContent).toBe('Ada Lovelace')
  })
})

describe('SignUpCard.solid: сабмит', () => {
  it('пустое имя — ошибка в надпись кнопки, signUp НЕ зовётся', () => {
    const { managers, submitBtn } = mount()
    submitBtn().click()

    expect(submitBtn().textContent).toContain('Please enter your name')
    expect(managers.auth.signUp).not.toHaveBeenCalled()
  })

  it('успех БЕЗ аватара — signUp(token, first, last), upload НЕ зовётся, toIm()', async () => {
    const { toIm, managers, firstInput, lastInput, setField, submitBtn } = mount()
    setField(firstInput(), '  Ada  ')
    setField(lastInput(), ' Lovelace ')
    submitBtn().click()

    await vi.waitFor(() => expect(managers.auth.signUp).toHaveBeenCalled())
    expect(managers.auth.signUp).toHaveBeenCalledWith('su-tok', 'Ada', 'Lovelace', 'web', 'browser')
    expect(managers.media.upload).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
  })

  it('успех С аватаром — заливка идёт ПОСЛЕ signUp (уже под сессией), затем toIm()', async () => {
    const { toIm, managers, firstInput, setField, submitBtn, fileInput } = mount()
    setField(firstInput(), 'Ada')

    const file = new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' })
    Object.defineProperty(fileInput(), 'files', { value: [file], configurable: true })
    fileInput().dispatchEvent(new Event('change', { bubbles: true }))

    submitBtn().click()

    await vi.waitFor(() => expect(managers.auth.signUp).toHaveBeenCalled())
    await vi.waitFor(() => expect(managers.media.upload).toHaveBeenCalled())
    expect(managers.profile.addPhoto).toHaveBeenCalledWith(999)
    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
  })

  it('заливка аватара упала — это НЕ повод не пустить в мессенджер (toIm всё равно зовётся)', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('upload failed'))
    const { toIm, firstInput, setField, submitBtn, fileInput } = mount({}, { upload })
    setField(firstInput(), 'Ada')

    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
    Object.defineProperty(fileInput(), 'files', { value: [file], configurable: true })
    fileInput().dispatchEvent(new Event('change', { bubbles: true }))

    submitBtn().click()
    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
  })

  it('signup_token_expired / phone_number_occupied — назад на signIn (токена больше нет)', async () => {
    const signUp = vi.fn().mockResolvedValue({ error: 'signup_token_expired' })
    const { navigate, firstInput, setField, submitBtn } = mount({ signUp })
    setField(firstInput(), 'Ada')
    submitBtn().click()

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'signIn' }))
  })

  it('прочая ошибка сервера — текст в надпись кнопки, карточка остаётся', async () => {
    const signUp = vi.fn().mockResolvedValue({ error: 'too_many_requests' })
    const { navigate, firstInput, setField, submitBtn } = mount({ signUp })
    setField(firstInput(), 'Ada')
    submitBtn().click()

    await vi.waitFor(() => expect(submitBtn().textContent).toContain('Too many attempts'))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('слишком длинное имя — кнопка задизейблена клиентски, signUp не зовётся', () => {
    const { managers, firstInput, setField, submitBtn } = mount()
    setField(firstInput(), 'A'.repeat(71))

    expect(submitBtn().disabled).toBe(true)
    submitBtn().click()
    expect(managers.auth.signUp).not.toHaveBeenCalled()
  })
})
