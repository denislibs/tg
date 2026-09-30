/**
 * Тесты порта `editPeer.ts` (tweb `components/editPeer.ts`, 812502980):
 * правило видимости угловой кнопки — «все обязательные поля валидны и хоть одно
 * поле изменено» (`isChanged`, :95-118), пересчёт на вводе в любое поле (:67-69),
 * `disabled` гасит поля (:78-82), аватар-заглушка (:48-54), своя кнопка без
 * `btn-corner` управляется атрибутом `disabled` (:42-46).
 */
import { afterEach, describe, expect, it } from 'vitest'
import InputField from '@components/inputField'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware } from '@helpers/middleware'
import EditPeer from './editPeer'

const managers = { peers: { fillMirror: async() => {} } }
const listenerSetter = new ListenerSetter()
const middlewareHelper = getMiddleware()

afterEach(() => {
  listenerSetter.removeAll()
  middlewareHelper.clean()
})

function make(nextBtn?: HTMLButtonElement) {
  const name = new InputField({ label: 'FirstName', required: true })
  const last = new InputField({ label: 'LastName' })
  name.setOriginalValue('Anna')
  last.setOriginalValue('B')
  const editPeer = new EditPeer({
    peerId: 2,
    inputFields: [name, last],
    listenerSetter,
    doNotEditAvatar: true,
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
})
