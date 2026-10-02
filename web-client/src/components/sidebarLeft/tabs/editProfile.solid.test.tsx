/** @jsxImportSource solid-js */
/**
 * «Редактировать профиль» `AppEditProfileTab` (порт tweb
 * `sidebarLeft/tabs/editProfile.tsx`, задача 27 плана 2D) — настоящая вкладка
 * на колоночном слайдере (`@/test/sidebarLeft`), открытая тем же путём, что
 * ⋮ → «Edit Profile» корня: `createTab(AppEditProfileTab).open(getEditProfileInitArgs())`.
 *
 * Пины на результат:
 *  • разметка — дамп `14-left-25-settings-edit-profile` (HEAD): кнопка
 *    `avatar-edit` с заглушкой аватара первой, три поля в `.input-wrapper`
 *    (лимиты 70/64/bio), подпись `Bio.Description` ВНЕ карточки, строка «Add
 *    Birthday» только без даты, секция имени пользователя (`plainText`), угловая
 *    кнопка `btn-corner` в `tab.content`; секций личного канала и бизнес-бота нет;
 *  • угловая кнопка видна, только пока форма изменена (`EditPeer.isChanged`),
 *    в т.ч. выбранным аватаром;
 *  • поле имени: форма — `isUsernameValid`, свободно ли — запросом через 150 мс,
 *    отказ сервера `USERNAME_INVALID` — `invalidText`;
 *  • сохранение: ровно один `profile.update` полями формы, `setUsername` —
 *    только изменённого валидного имени, фото — `media.upload` →
 *    `profile.addPhoto`; вкладка закрывается после ответа `update`;
 *  • день рождения — мост попапа 2C-14 → `PATCH /me {birthday}`, строка
 *    пропадает только при успехе;
 *  • остров снят на закрытии (DoD 5).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import lang from '@/lang'
import { HttpError } from '@core/net/restClient'
import type { Birthday } from '@core/peers/peer'
import { useChatsStore } from '@stores/chatsStore'
import type SliderSuperTab from '@components/sliderTab'
import { AppEditProfileTab, getEditProfileInitArgs } from '@components/solidJsTabs/tabs'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'

type BirthdayPopupProps = { initialDate?: Birthday, onSave: (date: Birthday | null) => Promise<boolean> | boolean }
const popups = vi.hoisted(() => ({ showBirthdayPopup: vi.fn((_props: unknown) => {}) }))
vi.mock('@components/sidebarLeft/settingsPopups', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@components/sidebarLeft/settingsPopups')>()),
  showBirthdayPopup: popups.showBirthdayPopup,
}))

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@components/toast')>()),
  toastNew,
}))

// Выбор файла `AvatarEdit` (медиаредактора нет — шапка `avatarEdit.ts`) и
// подготовка картинки: DOM-декодера в happy-dom нет.
const picked = vi.hoisted(() => ({ file: null as File | null }))
vi.mock('@helpers/files/requestFile', () => ({
  default: vi.fn(async() => picked.file!),
}))
vi.mock('@core/media/scaleImageForSend', () => ({
  scaleImageForSend: vi.fn(async(file: File) => ({ file, width: 640, height: 480 })),
}))

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const flush = async() => {
  for(let i = 0; i < 10; ++i) await pause(0)
}
/** Переход (250) + разрушение вкладки (280) + запас. */
const settle = () => pause(400)

const ME = 7

let host: InstalledSidebarLeft
let profile: {
  update: ReturnType<typeof vi.fn>
  checkUsername: ReturnType<typeof vi.fn>
  setUsername: ReturnType<typeof vi.fn>
  addPhoto: ReturnType<typeof vi.fn>
}
let media: { upload: ReturnType<typeof vi.fn> }

function setMe(fullUser: Record<string, unknown> = {}) {
  useChatsStore.setState({
    me: {
      user: { _: 'user', id: ME, first_name: 'Anna', last_name: 'Bell', username: 'anna_bell', pFlags: { self: true } },
      fullUser: { _: 'userFull', id: ME, about: 'Designer', ...fullUser },
      canMessage: true,
    } as never,
    meId: ME,
  })
}

// Модуль вкладки грузится `import()` на первом открытии (`getComponentModule`) —
// его трансформ под vitest занимает секунды и съедал бы бюджет первого теста.
beforeAll(async() => {
  await import('./editProfile.solid')
}, 30_000)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  popups.showBirthdayPopup.mockClear()
  toastNew.mockClear()
  picked.file = new File([new Uint8Array([1, 2, 3])], 'me.jpg', { type: 'image/jpeg' })
  if(!URL.createObjectURL) {
    URL.createObjectURL = () => 'blob:test'
    URL.revokeObjectURL = () => {}
  }
  setMe()

  profile = {
    update: vi.fn(async() => ({})),
    checkUsername: vi.fn(async() => true),
    setUsername: vi.fn(async() => ({ user: {} })),
    addPhoto: vi.fn(async() => ({ id: 42, mediaId: 42, createdAt: '' })),
  }
  media = { upload: vi.fn(async() => 42) }
  const managers = {
    profile,
    media,
    peers: { fillMirror: vi.fn(async() => {}) },
  } as unknown as Managers

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = installSidebarLeft(managers, columnEl)
})

afterEach(async() => {
  host.destroy()
  await settle()
  document.body.replaceChildren()
  useChatsStore.setState({ me: null, meId: null })
  vi.restoreAllMocks()
})

const open = async() => {
  const tab = await host.openTab(AppEditProfileTab, getEditProfileInitArgs())
  await flush()
  return tab
}

const content = (tab: SliderSuperTab) => tab.scrollable.container.firstElementChild as HTMLElement
const nextBtn = (tab: SliderSuperTab) => tab.content.querySelector<HTMLButtonElement>(':scope > button.btn-corner')!
const fields = (tab: SliderSuperTab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('.input-field-input')]
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

function typeInto(input: HTMLElement, value: string) {
  if(input instanceof HTMLInputElement) input.value = value
  else input.textContent = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('разметка — tweb editProfile.tsx', () => {
  it('аватар первым, затем секция полей с подписью вне карточки и секция имени пользователя', async() => {
    const tab = await open()
    expect(tab.container.classList.contains('edit-profile-container')).toBe(true)

    const [avatar, fieldsSection, usernameSection, ...rest] = [...content(tab).children] as HTMLElement[]
    expect(rest).toEqual([]) // О-62, О-25, ChatAutomation — секций нет
    expect(avatar.matches('button.avatar-edit')).toBe(true)
    expect([...avatar.children].map((el) => el.classList[0])).toEqual(['avatar-edit-canvas', 'tgico', 'avatar'])
    expect(avatar.lastElementChild!.classList.contains('avatar-placeholder')).toBe(true)
    expect(avatar.lastElementChild!.classList.contains('avatar-120')).toBe(true)

    // поля — в `.input-wrapper` внутри карточки, подписи — ключи tweb
    const wrapper = fieldsSection.querySelector('.sidebar-left-section-content > .input-wrapper')!
    expect([...wrapper.querySelectorAll('.input-field label')].map((l) => l.textContent)).toEqual([
      lang['EditProfile.FirstNameLabel'],
      lang['Login.Register.LastName.Placeholder'],
      lang['EditProfile.BioLabel'],
    ])
    // подпись — ребёнок `-container`, не карточки (`section.tsx:112`)
    const caption = fieldsSection.querySelector(':scope > .sidebar-left-section-caption')!
    expect(caption.textContent).toBe(lang['Bio.Description'].replace('\n', ''))

    expect(usernameSection.querySelector('.sidebar-left-section-name')!.textContent).toBe(lang['EditAccount.Username'])
    const usernameInput = usernameSection.querySelector('.input-wrapper input.input-field-input')!
    expect(usernameInput.getAttribute('type')).toBe('text')
    expect(usernameSection.querySelector(':scope > .sidebar-left-section-caption b')!.textContent).toBe('Telegram')

    // угловая кнопка — в `.sidebar-content`, не в скроллере (tweb :84)
    expect(nextBtn(tab).parentElement).toBe(tab.content)
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(false)
  })

  it('поля предзаполнены из `me`; лимиты 70 / 64 / bio', async() => {
    const tab = await open()
    const [first, last, bio, username] = fields(tab)
    expect([first.textContent, last.textContent, bio.textContent, (username as HTMLInputElement).value])
      .toEqual(['Anna', 'Bell', 'Designer', 'anna_bell'])

    // счётчик остатка появляется у последних `showLengthOn` символов (`inputField.ts:173-189`)
    typeInto(first, 'x'.repeat(65))
    expect(first.parentElement!.querySelector('label')!.textContent).toContain('(5)')
    typeInto(last, 'x'.repeat(60))
    expect(last.parentElement!.querySelector('label')!.textContent).toContain('(4)')
    typeInto(bio, 'x'.repeat(69))
    expect(bio.parentElement!.querySelector('label')!.textContent).toContain('(1)')
  })

  it('строка «Add Birthday» — только без даты рождения', async() => {
    const tab = await open()
    const row = fieldsSectionRow(tab)
    expect(row?.querySelector('.row-title')!.textContent).toBe(lang['EditProfile.AddBirthdayRow'])
    host.slider.onCloseBtnClick()
    await settle()

    setMe({ birthday: { _: 'birthday', day: 1, month: 2 } })
    const tab2 = await open()
    expect(fieldsSectionRow(tab2)).toBeNull()
  })
})

function fieldsSectionRow(tab: SliderSuperTab) {
  return content(tab).children[1].querySelector<HTMLElement>('.row')
}

describe('угловая кнопка — EditPeer.isChanged', () => {
  it('видна, пока поле изменено; возврат к исходному прячет', async() => {
    const tab = await open()
    const [first] = fields(tab)
    typeInto(first, 'Anne')
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(true)
    typeInto(first, 'Anna')
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(false)
  })

  it('выбранный аватар — изменение: кнопка видна, заглушка снята (`editPeer.ts:56-64`)', async() => {
    const tab = await open()
    const avatar = content(tab).firstElementChild!
    click(avatar)
    await flush()
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(true)
    expect(avatar.querySelector('.avatar-placeholder')).toBeNull()
  })
})

describe('поле имени пользователя — UsernameInputField', () => {
  const usernameInput = (tab: SliderSuperTab) => fields(tab)[3] as HTMLInputElement

  it('негодная форма — сразу `invalidText`, без запроса', async() => {
    const tab = await open()
    typeInto(usernameInput(tab), '1abc')
    await pause(200)
    expect(usernameInput(tab).classList.contains('error')).toBe(true)
    expect(usernameInput(tab).parentElement!.querySelector('.input-field-error-label')!.textContent)
      .toBe(lang['EditProfile.Username.Invalid'])
    expect(profile.checkUsername).not.toHaveBeenCalled()
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(false)
  })

  it('свободное имя — запрос через 150 мс, `valid` + `availableText`', async() => {
    const tab = await open()
    typeInto(usernameInput(tab), 'anna_new')
    expect(profile.checkUsername).not.toHaveBeenCalled()
    await pause(200)
    expect(profile.checkUsername).toHaveBeenCalledTimes(1)
    expect(profile.checkUsername).toHaveBeenCalledWith('anna_new')
    expect(usernameInput(tab).classList.contains('valid')).toBe(true)
    expect(usernameInput(tab).parentElement!.querySelector('label')!.textContent).toBe(lang['EditProfile.Username.Available'])
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(true)
  })

  it('занятое — `takenText`; отказ `USERNAME_INVALID` — `invalidText`', async() => {
    const tab = await open()
    profile.checkUsername.mockResolvedValueOnce(false)
    typeInto(usernameInput(tab), 'taken_one')
    await pause(200)
    expect(usernameInput(tab).parentElement!.querySelector('.input-field-error-label')!.textContent)
      .toBe(lang['EditProfile.Username.Taken'])

    profile.checkUsername.mockRejectedValueOnce(new HttpError(400, 'USERNAME_INVALID', 'USERNAME_INVALID'))
    typeInto(usernameInput(tab), 'abcd')
    await pause(200)
    expect(usernameInput(tab).parentElement!.querySelector('.input-field-error-label')!.textContent)
      .toBe(lang['EditProfile.Username.Invalid'])
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(false)
  })
})

describe('сохранение', () => {
  it('один `profile.update` полями формы; имя — только изменённое валидное; закрытие после ответа', async() => {
    const tab = await open()
    const [first, , bio] = fields(tab)
    typeInto(first, 'Anne')
    typeInto(bio, 'Painter')
    let resolveUpdate!: () => void
    profile.update.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveUpdate = resolve }))

    click(nextBtn(tab))
    expect(profile.update).toHaveBeenCalledTimes(1)
    expect(profile.update).toHaveBeenCalledWith({ firstName: 'Anne', lastName: 'Bell', bio: 'Painter' })
    expect(profile.setUsername).not.toHaveBeenCalled()
    expect(nextBtn(tab).disabled).toBe(true)
    expect(tab.container.isConnected).toBe(true)

    resolveUpdate()
    await flush()
    expect(nextBtn(tab).hasAttribute('disabled')).toBe(false)
    await settle()
    expect(tab.container.isConnected).toBe(false)
  })

  it('изменённое свободное имя уходит `setUsername`', async() => {
    const tab = await open()
    typeInto(fields(tab)[3], 'anna_new')
    await pause(200)
    click(nextBtn(tab))
    expect(profile.setUsername).toHaveBeenCalledWith('anna_new')
  })

  it('фото: `media.upload` выбранного файла → `profile.addPhoto(mediaId)`', async() => {
    const tab = await open()
    click(content(tab).firstElementChild!)
    await flush()
    click(nextBtn(tab))
    await flush()
    expect(media.upload).toHaveBeenCalledTimes(1)
    expect(media.upload.mock.calls[0][0]).toMatchObject({ mime: 'image/jpeg', size: 3, width: 640, height: 480 })
    expect(profile.addPhoto).toHaveBeenCalledWith(42)
  })
})

describe('день рождения — мост попапа 2C-14', () => {
  it('успех: `profile.update({birthday})`, строка пропадает', async() => {
    const tab = await open()
    click(fieldsSectionRow(tab)!)
    expect(popups.showBirthdayPopup).toHaveBeenCalledTimes(1)
    const { onSave } = popups.showBirthdayPopup.mock.calls[0][0] as BirthdayPopupProps
    const date: Birthday = { _: 'birthday', day: 3, month: 4 }
    await expect(onSave(date)).resolves.toBe(true)
    expect(profile.update).toHaveBeenCalledWith({ birthday: date })
    await flush()
    expect(fieldsSectionRow(tab)).toBeNull()
  })

  it('отказ: тост `Error.AnError`, строка остаётся', async() => {
    const tab = await open()
    click(fieldsSectionRow(tab)!)
    const { onSave } = popups.showBirthdayPopup.mock.calls[0][0] as BirthdayPopupProps
    profile.update.mockRejectedValueOnce(new Error('network'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(onSave({ _: 'birthday', day: 3, month: 4 })).resolves.toBe(false)
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Error.AnError' })
    await flush()
    expect(fieldsSectionRow(tab)).not.toBeNull()
  })
})

describe('вкладка', () => {
  it('шапка `EditAccount.Title`; повторное открытие не плодит вторую (`noSame`); остров снят на закрытии', async() => {
    const tab = await open()
    expect(tab.title.textContent).toBe(lang['EditAccount.Title'])
    expect((AppEditProfileTab as unknown as { noSame?: boolean }).noSame).toBe(true)

    const scroller = tab.scrollable.container
    host.slider.onCloseBtnClick()
    await settle()
    expect(scroller.querySelector('.input-wrapper')).toBeNull()
  })
})
