/**
 * Порт tweb `src/components/editPeer.ts:1-123` (812502980) — обвязка формы
 * «изменить пира»: угловая кнопка сохранения (`btn-corner`), аватар пира и
 * правило видимости кнопки — «обязательные поля валидны и хоть одно поле
 * изменено». Первый потребитель — вкладка «Изменить контакт»
 * (`sidebarRight/tabs/editContact.solid.tsx`, задача 0б-10 волны 7); у tweb её
 * же берут `editProfile.tsx` (2D-27) и `popups/createContact.tsx`.
 *
 * Расхождения с оригиналом:
 *  1. Редактирования аватара нет (`AvatarEdit`, `:56-64`, поле `uploadAvatar`,
 *     ветка `if(this.uploadAvatar)` в `isChanged`, опция `popupOptions`): класс
 *     `AvatarEdit` портирует задача 27 плана 2D. До неё опция `doNotEditAvatar`
 *     объявлена литералом `true` — единственный потребитель передаёт ровно его
 *     (`editContact.tsx:201`), а вызов с редактированием не соберётся, вместо
 *     того чтобы молча показать аватар без редактора.
 *  2. `avatarNew` у нас просит `managers` (объявить пробел зеркала карточек,
 *     шапка `components/avatar.ts`) — отсюда опция `managers`, у оригинала её нет.
 *  3. `ButtonCorner` без `ariaLabel: 'Save'` (`:41`) — шапка `components/buttonCorner.ts`.
 */
import type InputField from '@components/inputField'
import type ListenerSetter from '@helpers/listenerSetter'
import ButtonCorner from '@components/buttonCorner'
import safeAssign from '@helpers/object/safeAssign'
import { NULL_PEER_ID } from '@core/peers/peerId'
import type { Middleware } from '@helpers/middleware'
import { avatarNew, type AvatarManagers } from '@components/avatar'

export default class EditPeer {
  public nextBtn!: HTMLButtonElement

  public avatarElem!: ReturnType<typeof avatarNew>

  private inputFields!: InputField[]
  private listenerSetter!: ListenerSetter

  private peerId!: PeerId

  private _disabled = false
  private avatarSize = 120

  constructor(options: {
    peerId?: EditPeer['peerId'],
    inputFields: EditPeer['inputFields'],
    listenerSetter: ListenerSetter,
    // расхождение 1
    doNotEditAvatar: true,
    withoutAvatar?: boolean,
    nextBtn?: HTMLButtonElement,
    avatarSize?: number,
    middleware: Middleware,
    // расхождение 2
    managers: AvatarManagers
  }) {
    safeAssign(this, options)

    this.peerId ||= NULL_PEER_ID

    if(!this.nextBtn) {
      this.nextBtn = ButtonCorner({ icon: 'check' })
    } else if(!this.nextBtn.classList.contains('btn-corner')) {
      this.handleChange = () => {
        this.nextBtn.toggleAttribute('disabled', !this.isChanged() || this.disabled)
      }
    }

    if(!options.withoutAvatar) {
      this.avatarElem = avatarNew({
        middleware: options.middleware,
        size: this.avatarSize,
        peerId: this.peerId,
        managers: options.managers,
      })
      this.avatarElem.node.classList.add('avatar-placeholder')
    }

    this.inputFields.forEach((inputField) => {
      this.listenerSetter.add(inputField.input)('input', this.handleChange)
    })

    this.handleChange()
  }

  public get disabled() {
    return this._disabled
  }

  public set disabled(value) {
    this._disabled = value
    this.inputFields.forEach((inputField) => inputField.input.toggleAttribute('disabled', value))
    this.handleChange()
  }

  public lockWithPromise(promise: Promise<unknown>, unlockOnSuccess = false) {
    this.disabled = true
    promise.then(() => {
      if(unlockOnSuccess) {
        this.disabled = false
      }
    }, () => {
      this.disabled = false
    })
  }

  public isChanged = () => {
    let changedLength = 0, requiredLength = 0, requiredValidLength = 0
    this.inputFields.forEach((inputField) => {
      if(inputField.isValid()) {
        if(inputField.isChanged()) {
          ++changedLength
        }

        if(inputField.required) {
          ++requiredValidLength
        }
      }

      if(inputField.required) {
        ++requiredLength
      }
    })

    return requiredLength === requiredValidLength && changedLength > 0
  }

  public handleChange = () => {
    this.nextBtn.classList.toggle('is-visible', this.isChanged())
  }
}
