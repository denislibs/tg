/** @jsxImportSource solid-js */
/**
 * Тесты вкладки «Новый канал» (`newChannel.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/newChannel.tsx`, 812502980) и её продолжения —
 * `addChatUsers` (выбор подписчиков после создания).
 *
 * Вкладка НАСТОЯЩАЯ — `AppNewChannelTab` из `solidJsTabs/tabs.ts`, открытая
 * НАСТОЯЩИМ колоночным слайдером (`components/slider.ts`, навигация `'left'` —
 * как у `appSidebarLeft`); поля — настоящие `InputField`, выбор подписчиков —
 * настоящие `AppAddMembersTab` + `AppSelectPeers`, подтверждение — настоящий
 * `PopupPeer`. Стабы — только границы: менеджеры воркера, открытие чата
 * (`appImManager.setInnerPeer`), выбор файла и его ужатие (DOM-диалог и
 * `createImageBitmap` у happy-dom не работают) и геометрия.
 *
 * Предмет — сценарии tweb (задача 0а-3 плана волны 7): (а) название
 * обязательно; (б) описание уходит в запрос; (в) после создания канал
 * открыт, вкладка убрана из истории, открыт выбор подписчиков — «пропустить»
 * закрывает его, выбор — приглашает; (г) владелец снимает остров.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import appImManager from '@lib/appImManager'
import type { Managers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import { useSettingsStore } from '@/settings'
import type { Chat, User } from '@core/peers/peer'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import SidebarSlider from '@components/slider'
import AvatarEdit from '@components/avatarEdit'
import { AppAddMembersTab, AppNewChannelTab } from '@components/solidJsTabs/tabs'

const openPeer = vi.fn()

const pickedFile = vi.hoisted(() => ({ current: null as File | null }))
vi.mock('@helpers/files/requestFile', () => ({
  default: () => pickedFile.current ? Promise.resolve(pickedFile.current) : Promise.reject('NO_FILE_SELECTED'),
}))
vi.mock('@core/media/scaleImageForSend', () => ({
  scaleImageForSend: async(file: File) => ({ file, width: 640, height: 640 }),
}))

const ME = 1
const CHANNEL = -100
const CARDS: (User | Chat)[] = [
  { _: 'user', id: ME, first_name: 'Me', pFlags: { self: true } },
  { _: 'user', id: 2, first_name: 'Two', pFlags: { contact: true } },
  { _: 'channel', id: 100, title: 'Chan', participants_count: 1, date: 0, pFlags: { broadcast: true, creator: true } } as unknown as Chat,
]

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

let slider: SidebarSlider
let createChannel: ReturnType<typeof vi.fn>
let setPhoto: ReturnType<typeof vi.fn>
let addMember: ReturnType<typeof vi.fn>
let upload: ReturnType<typeof vi.fn>
let refresh: ReturnType<typeof vi.fn>

beforeEach(() => {
  rootScope.myId = ME
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  vi.spyOn(lottieLoader, 'loadAnimationAsAsset').mockResolvedValue({} as LottiePlayer)
  vi.spyOn(lottieLoader, 'waitForFirstFrame').mockResolvedValue(undefined as never)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  // карточка канала уже в зеркале — её туда кладёт ответ `createChannel`
  // (`saveApiPeers`), а `addChatUsers` читает `isBroadcast` синхронно
  applyPeerOps([{ op: 'upsert', peers: CARDS }])
  openPeer.mockClear()
  vi.spyOn(appImManager, 'setInnerPeer').mockImplementation(async(options) => { openPeer(options) })
  pickedFile.current = null

  createChannel = vi.fn(async() => CHANNEL)
  setPhoto = vi.fn(async() => {})
  addMember = vi.fn(async() => {})
  upload = vi.fn(async() => 77)
  refresh = vi.fn(async() => {})
  const managers = {
    channels: { createChannel, search: vi.fn() },
    groups: { setPhoto, addMember },
    media: { upload },
    dialogs: { getDialogs: vi.fn(async() => ({ dialogs: [], count: 0, isEnd: true })), refresh },
    contacts: { getContactsPeerIds: vi.fn(async() => [2]), testSelfSearch: vi.fn(async() => false) },
    peers: {
      getPeers: vi.fn(async(ids: PeerId[]) => ids.map((id) => CARDS.find((c) => (c._ === 'user' ? c.id : -c.id) === id)).filter(Boolean)),
      fillMirror: vi.fn(async() => {}),
    },
    presence: { get: vi.fn(async() => []) },
  } as unknown as Managers

  const sidebarEl = document.createElement('div')
  sidebarEl.id = 'column-left'
  const sliderEl = document.createElement('div')
  sliderEl.classList.add('sidebar-slider', 'tabs-container')
  sidebarEl.append(sliderEl)
  document.body.append(sidebarEl)
  slider = new SidebarSlider({ sidebarEl, navigationType: 'left', managers })
})

afterEach(async() => {
  slider.destroy()
  await pause(400)
  document.body.replaceChildren()
  resetPeerMirror()
  vi.restoreAllMocks()
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: false } })
})

type NewChannelTab = InstanceType<typeof AppNewChannelTab>

const open = async() => {
  const tab = slider.createTab(AppNewChannelTab)
  await tab.open()
  await settle()
  return tab
}

const nextBtn = (tab: NewChannelTab) =>
  tab.content.querySelector<HTMLButtonElement>(':scope > button.btn-corner')!
const fields = (tab: NewChannelTab) =>
  [...tab.content.querySelectorAll<HTMLElement>('.input-wrapper .input-field-input')]
const type = (input: HTMLElement, text: string) => {
  input.textContent = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const isVisible = (tab: NewChannelTab) => nextBtn(tab).classList.contains('is-visible')

describe('вкладка «Новый канал» — разметка', () => {
  it('new-channel-container, заголовок, аватар, два поля и подпись секции, угловая кнопка скрыта', async() => {
    const tab = await open()

    expect(tab.container.classList.contains('new-channel-container')).toBe(true)
    expect(tab.title.textContent).toBe('New Channel')

    const avatar = tab.content.querySelector('.sidebar-left-section .avatar-edit')!
    expect(avatar.tagName).toBe('BUTTON')
    expect([...avatar.children].map((el) => el.className)).toEqual(['avatar-edit-canvas', 'tgico avatar-edit-icon'])

    expect([...tab.content.querySelectorAll('.input-wrapper .input-field label')].map((el) => el.textContent))
      .toEqual(['Channel name', 'Description (optional)'])
    expect(fields(tab)[0].dataset.noLinebreaks).toBe('1')
    expect(fields(tab)[1].dataset.noLinebreaks).toBeUndefined()
    expect(tab.content.querySelector('.sidebar-left-section-caption')!.textContent)
      .toBe('You can provide an optional description for your channel.')

    expect(nextBtn(tab)).not.toBeNull()
    expect(isVisible(tab)).toBe(false)
  })

  it('noSame: вторая createTab при открытой вкладке отдаёт ту же', async() => {
    const tab = await open()
    expect(slider.createTab(AppNewChannelTab)).toBe(tab)
  })
})

describe('(а) название обязательно', () => {
  it('кнопка видна только с непустым названием и без переполнения обоих полей', async() => {
    const tab = await open()
    const [name, desc] = fields(tab)

    type(desc, 'about')
    expect(isVisible(tab)).toBe(false)

    type(name, 'Chan')
    expect(isVisible(tab)).toBe(true)

    type(name, 'x'.repeat(129))
    expect(isVisible(tab)).toBe(false)

    type(name, 'Chan')
    type(desc, 'x'.repeat(256))
    expect(isVisible(tab)).toBe(false)

    type(desc, '')
    type(name, '')
    expect(isVisible(tab)).toBe(false)
  })
})

describe('(б) запрос создания', () => {
  it('название и описание уходят в createChannel один раз; кнопка заперта на время запроса', async() => {
    let resolve!: (peerId: PeerId) => void
    createChannel.mockImplementation(() => new Promise((r) => { resolve = r }))
    const tab = await open()
    const [name, desc] = fields(tab)
    type(name, 'Chan')
    type(desc, 'About it')

    nextBtn(tab).click()

    expect(createChannel).toHaveBeenCalledTimes(1)
    expect(createChannel).toHaveBeenCalledWith({ title: 'Chan', about: 'About it' })
    expect(nextBtn(tab).hasAttribute('disabled')).toBe(true)

    resolve(CHANNEL)
    await settle()
  })

  it('отказ — кнопка снова доступна, канал не открывается', async() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    createChannel.mockRejectedValue(new Error('boom'))
    const tab = await open()
    type(fields(tab)[0], 'Chan')

    nextBtn(tab).click()
    await settle()

    expect(nextBtn(tab).hasAttribute('disabled')).toBe(false)
    expect(openPeer).not.toHaveBeenCalled()
    expect(slider.getHistory()).toEqual([tab])
    expect(refresh).not.toHaveBeenCalled()
  })

  it('выбранный аватар загружается и ставится фото созданного канала', async() => {
    pickedFile.current = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' })
    const tab = await open()
    tab.content.querySelector<HTMLElement>('.avatar-edit')!.click()
    await settle()

    type(fields(tab)[0], 'Chan')
    nextBtn(tab).click()
    await settle()

    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toMatchObject({ mime: 'image/jpeg', size: 3, width: 640, height: 640 })
    expect(setPhoto).toHaveBeenCalledWith(CHANNEL, 77)
  })

  it('без аватара фото не ставится', async() => {
    const tab = await open()
    type(fields(tab)[0], 'Chan')
    nextBtn(tab).click()
    await settle()
    expect(upload).not.toHaveBeenCalled()
    expect(setPhoto).not.toHaveBeenCalled()
  })
})

describe('(в) после создания — канал и выбор подписчиков', () => {
  const create = async() => {
    const tab = await open()
    type(fields(tab)[0], 'Chan')
    nextBtn(tab).click()
    await settle()
    const members = slider.getHistory()[0] as InstanceType<typeof AppAddMembersTab>
    return { tab, members }
  }
  const membersNext = (members: InstanceType<typeof AppAddMembersTab>) =>
    members.content.querySelector<HTMLButtonElement>(':scope > button.btn-corner')!

  it('канал открыт, вкладка канала убрана из истории, наверху — «Add Subscribers» с видимой «Далее»', async() => {
    const { tab, members } = await create()

    expect(openPeer).toHaveBeenCalledTimes(1)
    expect(openPeer).toHaveBeenCalledWith({ peerId: CHANNEL })
    // диалог канала перезапрошен (О-44: ответ создания диалога не несёт)
    expect(refresh).toHaveBeenCalledTimes(1)

    expect(slider.getHistory()).toHaveLength(1)
    expect(members).toBeInstanceOf(AppAddMembersTab)
    expect(members).not.toBe(tab)
    expect(members.title.textContent).toBe('Add Subscribers')
    expect(membersNext(members).classList.contains('is-visible')).toBe(true)
    expect(members.content.querySelector('.selector')!.className).toBe('selector selector-square selector-left')

    // вкладка канала разбирается своим таймером закрытия
    await pause(400)
    expect(tab.container.isConnected).toBe(false)
  })

  it('«пропустить» (Далее без выбора) закрывает выбор, никого не приглашая', async() => {
    const { members } = await create()
    membersNext(members).click()
    await settle()

    expect(slider.getHistory()).toEqual([])
    expect(addMember).not.toHaveBeenCalled()
    // 1:1 с оригиналом: `takeOut` зовёт `showConfirmation` и с пустым выбором
    // (tweb `addChatUsers.ts:224-232`, `addMembers.tsx:48-50`) — попап с пустым
    // именем встаёт поверх закрытой вкладки; «Add» в нём приглашает пустой список.
    expect(document.querySelector('.popup-add-members')).not.toBeNull()
  })

  it('выбор → подтверждение «Add member» с именами → «Add» приглашает и закрывает выбор', async() => {
    const { members } = await create()
    members.content.querySelector<HTMLElement>('ul.chatlist > a.row[data-peer-id="2"]')!.click()
    await settle()

    membersNext(members).click()
    await settle()

    const popup = document.querySelector<HTMLElement>('.popup-peer.popup-add-members')!
    expect(popup).not.toBeNull()
    expect(popup.querySelector('.popup-title')!.textContent).toBe('Add member')
    expect(popup.querySelector('.popup-description')!.textContent).toBe('Are you sure you want to add Two to Chan?')
    expect(addMember).not.toHaveBeenCalled()

    const add = [...popup.querySelectorAll<HTMLButtonElement>('.popup-button')].find((b) => b.textContent === 'Add')!
    add.click()
    await settle()

    expect(addMember).toHaveBeenCalledTimes(1)
    expect(addMember).toHaveBeenCalledWith(CHANNEL, 2)
    expect(slider.getHistory()).toEqual([])
  })
})

it('(г) после закрытия остров снят: узла нет, onCleanup отработал, поля мертвы', async() => {
  const clear = vi.spyOn(AvatarEdit.prototype, 'clear')
  const tab = await open()
  const container = tab.container
  const [name] = fields(tab)
  const btn = nextBtn(tab)

  tab.close()
  await pause(400)

  expect(container.isConnected).toBe(false)
  expect(document.querySelector('.new-channel-container')).toBeNull()
  expect(clear).toHaveBeenCalledTimes(1)

  // клик по кнопке снятой вкладки ничего не создаёт (слушатель снят `listenerSetter`)
  type(name, 'Chan')
  btn.click()
  await settle()
  expect(createChannel).not.toHaveBeenCalled()
})
