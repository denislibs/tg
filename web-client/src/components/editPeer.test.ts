/**
 * Тесты порта `editPeer.ts` (tweb `components/editPeer.ts`, 812502980):
 * правило видимости угловой кнопки — «все обязательные поля валидны и хоть одно
 * поле изменено» (`isChanged`, :95-118), пересчёт на вводе в любое поле (:67-69),
 * `disabled` гасит поля (:78-82), аватар-заглушка (:48-54), своя кнопка без
 * `btn-corner` управляется атрибутом `disabled` (:42-46), ветка `AvatarEdit`
 * (:56-64) и её доля в `isChanged` (:96-98).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import InputField from '@components/inputField'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware } from '@helpers/middleware'
import EditPeer from './editPeer'

vi.mock('@helpers/files/requestFile', () => ({
  default: vi.fn(async() => new File(['x'], 'a.png', { type: 'image/png' })),
}))
vi.mock('@core/media/scaleImageForSend', () => ({
  scaleImageForSend: vi.fn(async(file: File) => ({ file, width: 640, height: 480 })),
}))

const managers = { peers: { fillMirror: async() => {} }, media: { upload: vi.fn(async() => 77) } } as never
const listenerSetter = new ListenerSetter()
const middlewareHelper = getMiddleware()

afterEach(() => {
  listenerSetter.removeAll()
  middlewareHelper.clean()
})

function make(nextBtn?: HTMLButtonElement, doNotEditAvatar = true) {
  const name = new InputField({ label: 'FirstName', required: true })
  const last = new InputField({ label: 'LastName' })
  name.setOriginalValue('Anna')
  last.setOriginalValue('B')
  const editPeer = new EditPeer({
    peerId: 2,
    inputFields: [name, last],
    listenerSetter,
    doNotEditAvatar,
    middleware: middlewareHelper.get(),
    managers,
    nextBtn,
  })
  return { name, last, editPeer }
}

const type = (field: InputField, text: string) => {
  field.input.textContent = text
  field.input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('EditPeer', () => {
  it('угловая кнопка btn-corner скрыта, пока ничего не изменено; ввод в любое поле показывает её', () => {
    const { last, editPeer } = make()
    expect(editPeer.nextBtn.className).toContain('btn-circle btn-corner')
    expect(editPeer.nextBtn.classList.contains('is-visible')).toBe(false)

    type(last, 'C')
    expect(editPeer.nextBtn.classList.contains('is-visible')).toBe(true)

    type(last, 'B')
    expect(editPeer.nextBtn.classList.contains('is-visible')).toBe(false)
  })

  it('пустое обязательное поле прячет кнопку при любых других изменениях', () => {
    const { name, last, editPeer } = make()
    type(last, 'C')
    type(name, '')
    expect(editPeer.isChanged()).toBe(false)
    expect(editPeer.nextBtn.classList.contains('is-visible')).toBe(false)
  })

  it('аватар пира — заглушка avatar-placeholder размера 120', () => {
    const { editPeer } = make()
    expect(editPeer.avatarElem.node.classList.contains('avatar-placeholder')).toBe(true)
    expect(editPeer.avatarElem.node.classList.contains('avatar-120')).toBe(true)
  })

  it('disabled гасит поля; своя кнопка без btn-corner — атрибутом disabled', () => {
    const own = document.createElement('button')
    const { last, editPeer } = make(own)
    expect(own.hasAttribute('disabled')).toBe(true)
    type(last, 'C')
    expect(own.hasAttribute('disabled')).toBe(false)

    editPeer.disabled = true
    expect(last.input.hasAttribute('disabled')).toBe(true)
    expect(own.hasAttribute('disabled')).toBe(true)
  })

  it('без doNotEditAvatar: заглушка внутри кнопки AvatarEdit; выбор фото — uploadAvatar, кнопка видна, заглушка снята', async() => {
    const { editPeer } = make(undefined, false)
    const container = editPeer.avatarEdit.container
    expect(container.matches('button.avatar-edit')).toBe(true)
    expect(editPeer.avatarElem.node.parentElement).toBe(container)
    expect(editPeer.nextBtn.classList.contains('is-visible')).toBe(false)

    container.click()
    await vi.waitFor(() => expect(editPeer.uploadAvatar).toBeDefined())
    expect(editPeer.isChanged()).toBe(true)
    expect(editPeer.nextBtn.classList.contains('is-visible')).toBe(true)
    expect(editPeer.avatarElem.node.isConnected).toBe(false)
    expect(await editPeer.uploadAvatar!.file()).toBe(77)
  })

  it('doNotEditAvatar: кнопки AvatarEdit нет, только заглушка', () => {
    const { editPeer } = make()
    expect(editPeer.avatarEdit).toBeUndefined()
    expect(editPeer.avatarElem.node.classList.contains('avatar-placeholder')).toBe(true)
  })
})
