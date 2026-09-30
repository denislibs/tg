/**
 * `UsernameInputField` — порт tweb `components/usernameInputField.ts` (812502980).
 * Предмет: голова `t.me/` не отрезается от поля и не входит в значение; формат
 * проверяется на вводе без сети; занятость — одним запросом за debounce 150 мс;
 * ответ «занято» — ошибка поля; имя ЧАТА — без сети (ВРЕМЕННО, О-14 волна 7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import ListenerSetter from '@helpers/listenerSetter'
import lang from '@/lang'
import { UsernameInputField } from './usernameInputField'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let listenerSetter: ListenerSetter
let checkUsername: ReturnType<typeof vi.fn>
let onChange: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
  listenerSetter = new ListenerSetter()
  checkUsername = vi.fn(async(username: string) => username !== 'takenname')
  onChange = vi.fn<() => void>()
})

afterEach(() => {
  listenerSetter.removeAll()
  document.body.replaceChildren()
})

const create = (peerId?: PeerId) => {
  const field = new UsernameInputField({
    label: 'SetUrlPlaceholder',
    plainText: true,
    listenerSetter,
    availableText: 'Link.Available',
    invalidText: 'Link.Invalid',
    takenText: 'Link.Taken',
    onChange,
    peerId,
    head: 't.me/',
  }, { profile: { checkUsername } } as unknown as Managers)
  document.body.append(field.container)
  field.setOriginalValue('t.me/', true)
  return field
}

const type = (field: UsernameInputField, value: string) => {
  (field.input as HTMLInputElement).value = value
  field.input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('UsernameInputField', () => {
  it('голову нельзя стереть: значение без неё, поле с ней', () => {
    const field = create()
    type(field, 't.me')
    expect(field.getValue()).toBe('')
    expect((field.input as HTMLInputElement).value).toBe('t.me/')
  })

  it('быстрый ввод — один запрос за debounce; свободно → valid и подпись «Link.Available»', async() => {
    const field = create()
    type(field, 't.me/free')
    type(field, 't.me/freenam')
    type(field, 't.me/freename')
    expect(checkUsername).not.toHaveBeenCalled()

    await pause(200)
    expect(checkUsername).toHaveBeenCalledTimes(1)
    expect(checkUsername).toHaveBeenCalledWith('freename')
    expect(field.input.classList.contains('valid')).toBe(true)
    expect(field.label.textContent).toBe(lang['Link.Available'])
    expect(onChange).toHaveBeenCalled()
  })

  it('занято → ошибка «Link.Taken»', async() => {
    const field = create()
    type(field, 't.me/takenname')
    await pause(200)
    expect(field.input.classList.contains('error')).toBe(true)
    expect(field.errorLabel?.textContent).toBe(lang['Link.Taken'])
  })

  it('негодный формат → «Link.Invalid» сразу, без сети', async() => {
    const field = create()
    type(field, 't.me/9abc')
    await pause(200)
    expect(field.errorLabel?.textContent).toBe(lang['Link.Invalid'])
    expect(checkUsername).not.toHaveBeenCalled()
  })

  it('имя чата: сеть не спрашивается, годное имя — valid (ВРЕМЕННО до О-14 волна 7)', async() => {
    const field = create(-30)
    type(field, 't.me/chatname')
    await pause(200)
    expect(checkUsername).not.toHaveBeenCalled()
    expect(field.input.classList.contains('valid')).toBe(true)
  })
})
