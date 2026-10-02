/**
 * Порт tweb `src/components/editPeer.ts:1-123` (812502980) — обвязка формы
 * «изменить пира»: угловая кнопка сохранения (`btn-corner`), аватар пира и
 * правило видимости кнопки — «обязательные поля валидны и хоть одно поле
 * изменено». Первый потребитель — вкладка «Изменить контакт»
 * (`sidebarRight/tabs/editContact.solid.tsx`, задача 0б-10 волны 7); у tweb её
 * же берут `editProfile.tsx` (2D-27) и `popups/createContact.tsx`.
 *
 * Расхождения с оригиналом:
 *  1. Опции `popupOptions` (`:33`, попап медиаредактора аватара) нет: наш
 *     `AvatarEdit` до МР-5 открывает выбор файла, а не редактор (шапка
 *     `components/avatarEdit.ts`), передавать ему нечего.
 *  2. `avatarNew` у нас просит `managers` (объявить пробел зеркала карточек,
 *     шапка `components/avatar.ts`), `AvatarEdit` — тоже (загрузка по
 *     `media_id`, расхождение 3 его шапки) — отсюда опция `managers`, у
 *     оригинала её нет.
 *  3. `ButtonCorner` без `ariaLabel: 'Save'` (`:41`) — шапка `components/buttonCorner.ts`.
 */
import type InputField from '@components/inputField'
import type ListenerSetter from '@helpers/listenerSetter'
import ButtonCorner from '@components/buttonCorner'
import safeAssign from '@helpers/object/safeAssign'
import { NULL_PEER_ID } from '@core/peers/peerId'
import type { Middleware } from '@helpers/middleware'
import { avatarNew, type AvatarManagers } from '@components/avatar'
import AvatarEdit, { type AvatarEditManagers, type AvatarEditPayload } from '@components/avatarEdit'

export default class EditPeer {
  public nextBtn!: HTMLButtonElement

  public uploadAvatar: AvatarEditPayload | undefined
  public avatarEdit!: AvatarEdit
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
    doNotEditAvatar?: boolean,
    withoutAvatar?: boolean,
    nextBtn?: HTMLButtonElement,
    avatarSize?: number,
    middleware: Middleware,
    // расхождение 2
    managers: AvatarManagers & AvatarEditManagers
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

      if(!options.doNotEditAvatar) {
        this.avatarEdit = new AvatarEdit((payload) => {
          this.uploadAvatar = payload
          this.handleChange()
          this.avatarElem.node.remove()
        }, { managers: options.managers }) // расхождение 1

        this.avatarEdit.container.append(this.avatarElem.node)
      }
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
    if(this.uploadAvatar) {
      return true
    }

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
