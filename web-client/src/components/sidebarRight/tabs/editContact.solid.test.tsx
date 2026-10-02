/** @jsxImportSource solid-js */
/**
 * Тесты вкладки «Изменить контакт» (`editContact.solid.tsx`, порт tweb
 * `sidebarRight/tabs/editContact.tsx`, 812502980; задача 0б-10 волны 7).
 *
 * Вкладка НАСТОЯЩАЯ — `AppEditContactTab` из `solidJsTabs/tabs.ts`, открытая
 * НАСТОЯЩИМ слайдером (`components/slider.ts`, навигация `'right'`, как у
 * `AppSidebarRight` tweb `sidebarRight/index.ts:20-28`) и настоящим
 * `appNavigationController` (Esc). Стабы — только границы: менеджеры воркера,
 * мосты выбора фото (ВРЕМЕННО до МР-5) и попапа даты рождения (ВРЕМЕННО до
 * 2C-14), тост и `startClient` попапа удаления.
 *
 * Предмет — форма оригинала: порядок узлов и классы, сеть только по угловой
 * кнопке (не на каждом вводе), видимость кнопки по `EditPeer.isChanged`, ветки
 * «контакт» / «новый контакт» / «номер скрыт правилом», удаление через
 * подтверждение, секция личного фото с перестройкой на месте, мьют, уборка
 * Solid-корня по закрытию.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { Birthday, UserFull, UserReal } from '@core/peers/peer'
import type { PrivacyRule } from '@core/managers/privacyManager'
import rootScope from '@lib/rootScope'
import appNavigationController from '@core/navigation/appNavigationController'
import { useChatsStore } from '@stores/chatsStore'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { formatUserPhone } from '@core/format/phone'
import SidebarSlider from '@components/slider'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import { AppEditContactTab } from '@components/solidJsTabs/tabs'

const toastNewSpy = vi.fn()
vi.mock('@components/toast', () => ({ toastNew: (o: unknown) => toastNewSpy(o) }))

const pickAvatarAndUploadSpy = vi.fn()
vi.mock('@components/pickAvatarAndUpload.bridge', () => ({
  pickAvatarAndUpload: (o: unknown) => pickAvatarAndUploadSpy(o),
}))

const showBirthdayPopupSpy = vi.fn()
const suggestUserBirthdaySpy = vi.fn(async(_userId: number, _date: Birthday) => true)
vi.mock('@components/popups/birthday.bridge', () => ({
  default: (o: unknown) => showBirthdayPopupSpy(o),
  suggestUserBirthday: (userId: number, date: Birthday) => suggestUserBirthdaySpy(userId, date),
}))

vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { peers: { fillMirror: async() => {} } } }),
}))

const ME = 1
const PEER = 2

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}
/** Переход закрытия (250) + снятие узла (`onCloseAfterTimeout`) + запас. */
const closed = () => pause(700)

const click = (el: Element) => el.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true, cancelable: true }))

let user: UserReal
let isContact: boolean
let rule: PrivacyRule
let personal: boolean
let note: string | undefined
let birthday: Birthday | undefined
let managers: ReturnType<typeof makeManagers>
let slider: SidebarSlider

function makeManagers() {
  return {
    contacts: {
      isContact: vi.fn(async() => isContact),
      add: vi.fn(async() => ({})),
      del: vi.fn(async() => {}),
      clearPhoto: vi.fn(async() => { personal = false }),
    },
    privacy: {
      rule: vi.fn(async() => rule),
      // полная карточка `GET /users/{id}`: заметка, личное фото, день рождения
      profile: vi.fn(async() => ({
        user,
        fullUser: {
          _: 'userFull',
          id: PEER,
          ...(note !== undefined ? { note: { _: 'textWithEntities', text: note, entities: [] } } : {}),
          ...(personal ? { personal_photo: { _: 'photo', id: 7, sizes: [] } } : {}),
          ...(birthday ? { birthday } : {}),
        } as UserFull,
        canMessage: true,
      })),
    },
    profile: {
      updateUserNote: vi.fn(async() => {}),
    },
    peers: {
      getUsers: vi.fn(async() => [user]),
      fillMirror: vi.fn(async() => {}),
    },
    groups: { setMute: vi.fn(async() => {}) },
  }
}

function createSidebarEl() {
  const sidebarEl = document.createElement('div')
  const sliderEl = document.createElement('div')
  sliderEl.classList.add('sidebar-slider', 'tabs-container')
  sidebarEl.append(sliderEl)
  document.body.append(sidebarEl)
  return sidebarEl
}

beforeEach(() => {
  rootScope.myId = ME
  user = { _: 'user', id: PEER, first_name: 'Two', last_name: 'Last', pFlags: { contact: true } } as UserReal
  isContact = true
  personal = false
  note = undefined
  birthday = undefined
  rule = { key: 'phone_number', value: 'everybody', allowUserIds: [], denyUserIds: [] }
  useChatsStore.setState({ dialogs: [] })
  // имя в `.peer-title` берётся из зеркала карточек (`chat/peerTitle.ts`)
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [user] }])
  managers = makeManagers()
  slider = new SidebarSlider({
    sidebarEl: createSidebarEl(),
    navigationType: 'right',
    managers: managers as unknown as Managers,
  })
})

afterEach(async() => {
  slider.destroy()
  await closed()
  appNavigationController.spliceItems(0, Infinity)
  document.body.replaceChildren()
  toastNewSpy.mockReset()
  pickAvatarAndUploadSpy.mockReset()
  showBirthdayPopupSpy.mockReset()
  suggestUserBirthdaySpy.mockClear()
})

async function open() {
  const tab = slider.createTab(AppEditContactTab)
  await tab.open(PEER)
  await settle()
  return tab
}

type Tab = Awaited<ReturnType<typeof open>>

/** Дети скроллера вкладки: первый — корень Solid-острова `scaffoldSolidJSTab`. */
const scrollChildren = (tab: Tab) => [...tab.scrollable.container.children].slice(1) as HTMLElement[]
const nextBtn = (tab: Tab) => tab.content.querySelector<HTMLButtonElement>(':scope > button.btn-corner')!
const field = (tab: Tab, name: string) => {
  const input = tab.container.querySelector<HTMLElement>('.input-wrapper')!
  return [...input.querySelectorAll<HTMLElement>('.input-field')].find((el) => el.querySelector('label')?.textContent === name)!
}
const typeInto = (tab: Tab, label: string, text: string) => {
  const input = field(tab, label).querySelector<HTMLElement>('.input-field-input')!
  input.textContent = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const buttons = (section: Element) => [...section.querySelectorAll<HTMLElement>('button.btn-primary')]
/** Подпись кнопки без глифа иконки (`tgico` — символ из Private Use Area). */
const label = (el: Element) => el.textContent!.replace(/[\uE000-\uF8FF]/g, '')

describe('«Изменить контакт» — разметка контакта', () => {
  it('заголовок «Edit», классы контейнера, порядок узлов скроллера и кнопка в .sidebar-content', async() => {
    const tab = await open()

    expect(tab.title.textContent).toBe('Edit')
    expect(tab.container.classList.contains('edit-peer-container')).toBe(true)
    expect(tab.container.classList.contains('edit-contact-container')).toBe(true)

    const [avatar, name, subtitle, fields, photo, del, ...rest] = scrollChildren(tab)
    expect(rest).toEqual([])
    expect(avatar.className).toBe('avatar-edit')
    expect(avatar.firstElementChild!.classList.contains('avatar-placeholder')).toBe(true)
    expect(name.className).toBe('profile-name')
    expect(name.querySelector('.peer-title')!.getAttribute('data-peer-id')).toBe('' + PEER)
    expect(subtitle.className).toBe('profile-subtitle')
    expect(subtitle.textContent).toBe('original name')
    expect(fields.querySelector(':scope > .sidebar-left-section')!.classList.contains('no-delimiter')).toBe(true)
    expect(photo.textContent).toContain('Set a photo for this contact that only you will see')
    expect(buttons(del).map(label)).toEqual(['Delete Contact'])
    expect(buttons(del)[0].classList.contains('danger')).toBe(true)

    // кнопка — в `.sidebar-content`, не в скроллере (editContact.tsx:204)
    expect(nextBtn(tab)).not.toBeNull()
  })

  // Кнопка видна сразу: у контакта без заметки исходного значения нет, а
  // `isChanged` сравнивает с `undefined` — ровно так же у оригинала
  // (`InputFieldEmoji.isChanged` — `deepEqual(richValue, undefined)` ложно,
  // `inputFieldEmoji.ts`; `setRichOriginalValue` зовётся только при `note`).
  it('поля: имя/фамилия — исходные значения, заметка пустая и без исходного — кнопка видна', async() => {
    const tab = await open()

    const labels = [...tab.container.querySelectorAll('.input-wrapper .input-field label')].map((l) => l.textContent)
    expect(labels).toEqual(['First name (required)', 'Last name (optional)', 'Notes'])
    expect(field(tab, 'First name (required)').querySelector('.input-field-input')!.textContent).toBe('Two')
    expect(field(tab, 'Last name (optional)').querySelector('.input-field-input')!.textContent).toBe('Last')
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(true)
  })

  it('заметка из userFull.note — исходное значение поля, кнопка скрыта', async() => {
    note = 'коллега'
    const tab = await open()
    expect(field(tab, 'Notes').querySelector('.input-field-input')!.textContent).toBe('коллега')
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(false)
  })

  it('строка уведомлений: переключатель и подпись; переключение зовёт мьют, зеркало двигает подпись', async() => {
    const tab = await open()
    const fields = scrollChildren(tab)[3]
    const row = fields.querySelector<HTMLElement>('.row')!
    expect(row.querySelector('.row-title')!.textContent).toBe('Notifications')
    expect(row.querySelector('.row-subtitle')!.textContent).toBe('Enabled')

    const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.checked).toBe(true)
    checkbox.click()
    await settle()
    expect(managers.groups.setMute).toHaveBeenCalledWith(PEER, true)

    // мьют объявлен зеркалом диалогов (другая вкладка / пуш) — подпись следует
    useChatsStore.setState({ dialogs: [{ peerId: PEER, notify_settings: { _: 'peerNotifySettings', silent: true } }] as never })
    await settle()
    expect(row.querySelector('.row-subtitle')!.textContent).toBe('Disabled')
  })
})

describe('«Изменить контакт» — сохранение только по кнопке', () => {
  it('ввод не ходит в сеть; клик — contacts.add один раз и закрытие', async() => {
    const tab = await open()

    typeInto(tab, 'First name (required)', 'Twoo')
    typeInto(tab, 'Notes', 'note')
    await settle()
    expect(managers.contacts.add).not.toHaveBeenCalled()
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(true)

    click(nextBtn(tab))
    await settle()
    expect(managers.contacts.add).toHaveBeenCalledTimes(1)
    // заметка — не в addContact, а отдельным updateUserNote (:348-358)
    expect(managers.contacts.add).toHaveBeenCalledWith({
      contactId: PEER,
      firstName: 'Twoo',
      lastName: 'Last',
      sharePhone: undefined,
    })
    expect(managers.profile.updateUserNote).toHaveBeenCalledWith(PEER, { _: 'textWithEntities', text: 'note', entities: [] })

    await closed()
    expect(slider.getHistory()).toEqual([])
    expect(tab.container.isConnected).toBe(false)
  })

  it('неизменённая заметка не пишется: правка имени — только contacts.add', async() => {
    note = 'коллега'
    const tab = await open()
    typeInto(tab, 'First name (required)', 'Twoo')
    click(nextBtn(tab))
    await settle()
    expect(managers.contacts.add).toHaveBeenCalledTimes(1)
    expect(managers.profile.updateUserNote).not.toHaveBeenCalled()
  })

  it('пустое обязательное имя прячет кнопку, даже если другое поле изменено', async() => {
    const tab = await open()
    typeInto(tab, 'Last name (optional)', 'Other')
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(true)
    typeInto(tab, 'First name (required)', '')
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(false)
  })

  it('ошибка сети — тост Error.AnError, вкладка остаётся', async() => {
    const tab = await open()
    managers.contacts.add.mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    typeInto(tab, 'First name (required)', 'X')
    click(nextBtn(tab))
    await settle()
    expect(toastNewSpy).toHaveBeenCalledWith({ langPackKey: 'Error.AnError' })
    expect(slider.getHistory()).toEqual([tab])
  })
})

describe('«Добавить контакт» — новый контакт', () => {
  beforeEach(() => { isContact = false })

  it('заголовок AddContactTitle, черновик из карточки — кнопка видна сразу; строка «номер скрыт»', async() => {
    const tab = await open()
    expect(tab.title.textContent).toBe('Add Contact')
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(true)

    const [, , , fields, ...rest] = scrollChildren(tab)
    // «всем» номер виден — секции «поделиться номером» нет, фото и удаления нет
    expect(rest).toEqual([])
    const row = fields.querySelector('.row')!
    expect(row.querySelector('.row-title')!.textContent).toBe('Mobile hidden')
    expect(row.querySelector('.row-subtitle')!.textContent).toBe('Phone number will be visible once Two Last adds you as a contact.')
  })

  it('с номером — номер и подпись «Phone»', async() => {
    user = { ...user, phone: '79261234567' }
    const tab = await open()
    const row = scrollChildren(tab)[3].querySelector('.row')!
    expect(row.querySelector('.row-title')!.textContent).toBe(formatUserPhone('79261234567'))
    expect(row.querySelector('.row-subtitle')!.textContent).toBe('Phone')
  })

  it.each(['nobody', 'contacts'] as const)('номер скрыт правилом (%s) — секция «Share My Phone Number», галочка уходит в contacts.add', async(value) => {
    rule = { ...rule, value }
    const tab = await open()
    const share = scrollChildren(tab)[4]
    expect(share.textContent).toContain('Share My Phone Number')
    expect(share.textContent).toContain('You can make your phone visible to Two Last.')
    const checkbox = share.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.checked).toBe(true)

    click(nextBtn(tab))
    await settle()
    expect(managers.contacts.add).toHaveBeenCalledWith(expect.objectContaining({ contactId: PEER, firstName: 'Two', sharePhone: true }))
  })

  it('исключение allowUsers с этим пиром — секции нет', async() => {
    rule = { ...rule, value: 'nobody', allowUserIds: [PEER] }
    const tab = await open()
    expect(scrollChildren(tab)).toHaveLength(4)
  })
})

describe('«Изменить контакт» — удаление', () => {
  it('подтверждение → contacts.del → вкладка закрыта', async() => {
    const tab = await open()
    click(buttons(scrollChildren(tab)[5])[0])
    await settle()
    const popup = document.querySelector<HTMLElement>('.popup-confirmation')!
    expect(popup.textContent).toContain('Are you sure you want to delete this contact?')
    click(popup.querySelector<HTMLElement>('.popup-button.danger')!)
    await settle()
    expect(managers.contacts.del).toHaveBeenCalledWith(PEER)
    await closed()
    expect(tab.container.isConnected).toBe(false)
  })

  it('отмена — сети нет, вкладка на месте', async() => {
    const tab = await open()
    click(buttons(scrollChildren(tab)[5])[0])
    await settle()
    const popup = document.querySelector<HTMLElement>('.popup-confirmation')!
    click([...popup.querySelectorAll<HTMLElement>('.popup-button')].find((b) => !b.classList.contains('danger'))!)
    await closed()
    expect(managers.contacts.del).not.toHaveBeenCalled()
    expect(slider.getHistory()).toEqual([tab])
  })
})

describe('«Изменить контакт» — личное фото', () => {
  it('без личного фото: «Set Photo for» + «Suggest Photo for», сброса нет; выбор — мост с режимом контакта', async() => {
    const tab = await open()
    const photo = scrollChildren(tab)[4]
    expect(buttons(photo).map(label)).toEqual(['Set Photo for Two', 'Suggest Photo for Two'])

    click(buttons(photo)[0])
    expect(pickAvatarAndUploadSpy).toHaveBeenCalledWith(expect.objectContaining({ mode: { userId: PEER } }))
    click(buttons(photo)[1])
    expect(pickAvatarAndUploadSpy).toHaveBeenLastCalledWith(expect.objectContaining({ mode: { userId: PEER, suggest: true } }))
  })

  it('загрузка личного фото: тост и перестройка секции на месте («Change Photo for» + сброс)', async() => {
    const tab = await open()
    const photo = scrollChildren(tab)[4]
    click(buttons(photo)[0])
    personal = true
    pickAvatarAndUploadSpy.mock.calls[0][0].onUploaded()
    await settle()

    expect(toastNewSpy).toHaveBeenCalledWith({ langPackKey: 'UserInfo.PhotoSetToast', langPackArguments: ['Two'] })
    expect(photo.isConnected).toBe(false)
    const fresh = scrollChildren(tab)[4]
    expect(buttons(fresh).map(label)).toEqual(['Change Photo for Two', 'Suggest Photo for Two', 'Reset to Original Photo'])
  })

  it('сброс личного фото: подтверждение → contacts.clearPhoto → тост → секция без сброса', async() => {
    personal = true
    const tab = await open()
    const reset = buttons(scrollChildren(tab)[4])[2]
    click(reset)
    await settle()
    const popup = [...document.querySelectorAll<HTMLElement>('.popup-confirmation')].pop()!
    expect(popup.textContent).toContain('The custom photo for this contact will be removed')
    click(popup.querySelector<HTMLElement>('.popup-button.danger')!)
    await settle()

    expect(managers.contacts.clearPhoto).toHaveBeenCalledWith(PEER)
    expect(toastNewSpy).toHaveBeenCalledWith({ langPackKey: 'UserInfo.PhotoResetToast' })
    expect(buttons(scrollChildren(tab)[4]).map(label)).toEqual(['Set Photo for Two', 'Suggest Photo for Two'])
  })
})

describe('«Изменить контакт» — предложить дату рождения', () => {
  // tweb `editContact.tsx:194`, `:254-266`: строка есть, пока у пира нет даты
  it('без даты рождения — строка «Suggest Date of Birth»; клик — попап с suggestForPeer, сохранение — suggestUserBirthday', async() => {
    const tab = await open()
    const rows = [...scrollChildren(tab)[3].querySelectorAll<HTMLElement>('.row')]
    expect(rows.map((row) => row.querySelector('.row-title')!.textContent)).toEqual(['Notifications', 'Suggest Date of Birth'])

    click(rows[1])
    expect(showBirthdayPopupSpy).toHaveBeenCalledWith(expect.objectContaining({ suggestForPeer: PEER }))
    const date: Birthday = { _: 'birthday', day: 8, month: 3 }
    await expect(showBirthdayPopupSpy.mock.calls[0][0].onSave(date)).resolves.toBe(true)
    expect(suggestUserBirthdaySpy).toHaveBeenCalledWith(PEER, date)
  })

  it('дата рождения уже есть — строки нет', async() => {
    birthday = { _: 'birthday', day: 1, month: 5 }
    const tab = await open()
    const rows = [...scrollChildren(tab)[3].querySelectorAll<HTMLElement>('.row')]
    expect(rows.map((row) => row.querySelector('.row-title')!.textContent)).toEqual(['Notifications'])
  })
})

describe('«Изменить контакт» — закрытие', () => {
  it('Esc закрывает вкладку через контроллер навигации и снимает Solid-корни (через 250 мс узлов нет)', async() => {
    const tab = await open()
    const rows = scrollChildren(tab)[3].querySelector('.row')!.parentElement!
    expect(rows.childElementCount).toBe(2)

    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(esc)
    expect(esc.defaultPrevented).toBe(true)
    await closed()

    expect(slider.getHistory()).toEqual([])
    expect(tab.container.isConnected).toBe(false)
    // `renderComponent` снят `onDestroy` миддлвари вкладки — его корень пуст
    expect(rows.childElementCount).toBe(0)
  })
})
