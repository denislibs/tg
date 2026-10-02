/** @jsxImportSource solid-js */
/**
 * Тесты флоу «Новая группа» — `createNewGroupTab.ts` → `AppAddMembersTab` →
 * `AppNewGroupTab` (`newGroup.solid.tsx`), порт tweb 812502980
 * `sidebarLeft/tabs/{createNewGroupTab.ts,newGroup.tsx}`.
 *
 * Слайдер НАСТОЯЩИЙ (`components/slider.ts`), вкладки — настоящие объявления
 * `solidJsTabs/tabs.ts`, селектор участников — настоящий `AppSelectPeers`.
 * Стабы — границы: менеджеры воркера, открытие чата (шпион
 * `appImManager.setInnerPeer`) и кнопка-аватар (`AvatarEdit` — порт задачи
 * 0а-3, общий с «Новым каналом»; здесь нужен только её `onChange`).
 *
 * Поведение сверено с оригиналом, а не с React-экраном `NewGroupFlow.tsx`:
 * «Далее» вынимает выбор участников из истории слайдера (`attachToPromise` →
 * `close()` не верхней вкладки → `removeTabFromHistory`), поэтому в истории
 * остаётся ОДНА вкладка, а «Назад» с неё уводит из флоу, а не на выбор.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import appImManager from '@lib/appImManager'
import type { Managers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import { useChatsStore } from '@stores/chatsStore'
import { useSettingsStore } from '@/settings'
import type { User } from '@core/peers/peer'
import appNavigationController from '@core/navigation/appNavigationController'
import SidebarSlider from '@components/slider'
import type SliderSuperTab from '@components/sliderTab'
import { AppAddMembersTab, AppNewGroupTab } from '@components/solidJsTabs/tabs'
import createNewGroupTab from './createNewGroupTab'

const avatarEdit = vi.hoisted(() => ({
  onChange: undefined as undefined | ((payload: { file: () => Promise<number> }) => void),
  clear: vi.fn(),
}))
vi.mock('@components/avatarEdit', () => ({
  default: class {
    public container = document.createElement('button')
    constructor(onChange: (payload: { file: () => Promise<number> }) => void) {
      this.container.className = 'avatar-edit'
      avatarEdit.onChange = onChange
    }
    public clear() {
      avatarEdit.clear()
    }
  },
}))

const openPeerMock = vi.fn()

const ME = 1
const USERS = new Map<PeerId, User>([
  [ME, { _: 'user', id: ME, first_name: 'Me', pFlags: { self: true } } as User],
  [2, { _: 'user', id: 2, first_name: 'Two', pFlags: {}, status: { _: 'userStatusRecently' } } as User],
  [3, { _: 'user', id: 3, first_name: 'Three', pFlags: {} } as User],
])

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}
/** Вкладка въезжает после ленивого `import()` модуля — ждём её в истории. */
const waitForTop = async(ctor: abstract new (...args: never[]) => SliderSuperTab) => {
  for(let i = 0; i < 100 && !(top() instanceof ctor); ++i) await pause(10)
  await settle()
  return top()
}

// Модули содержимого вкладок грузятся ленивым `import()` (`solidJsTabs/tabs.ts`);
// первый холодный импорт с трансформом дольше любого разумного ожидания в тесте.
beforeAll(async() => {
  await import('./addMembers.solid')
  await import('./newGroup.solid')
})

let slider: SidebarSlider
let sidebarEl: HTMLElement
let createChat: ReturnType<typeof vi.fn>
const usersOf = async(ids: PeerId[]) => ids.map((id) => USERS.get(id)).filter((user): user is User => !!user)
let getUsers: ReturnType<typeof vi.fn<typeof usersOf>>
let setPhoto: ReturnType<typeof vi.fn>

beforeEach(() => {
  rootScope.myId = ME
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  useChatsStore.setState({ dialogIndexById: {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  openPeerMock.mockClear()
  vi.spyOn(appImManager, 'setInnerPeer').mockImplementation(async(options) => { openPeerMock(options) })
  avatarEdit.onChange = undefined
  avatarEdit.clear.mockClear()

  createChat = vi.fn(async() => ({ chatId: 50, missingInvitees: [] }))
  setPhoto = vi.fn(async() => {})
  getUsers = vi.fn(usersOf)
  const managers = {
    groups: { createChat, setPhoto },
    contacts: { getContactsPeerIds: vi.fn(async() => [2, 3]), testSelfSearch: vi.fn(async() => false) },
    dialogs: { getDialogs: vi.fn(async() => ({ dialogs: [], count: 0, isEnd: true })) },
    channels: { search: vi.fn() },
    peers: {
      getPeers: vi.fn(async(ids: PeerId[]) => ids.map((id) => USERS.get(id)).filter(Boolean)),
      getUsers,
      fillMirror: vi.fn(async() => {}),
    },
  } as unknown as Managers

  sidebarEl = document.createElement('div')
  const sliderEl = document.createElement('div')
  sliderEl.classList.add('sidebar-slider', 'tabs-container')
  const mainEl = document.createElement('div')
  mainEl.classList.add('tabs-tab')
  sliderEl.append(mainEl)
  sidebarEl.append(sliderEl)
  document.body.append(sidebarEl)
  slider = new SidebarSlider({ sidebarEl, navigationType: 'left', managers })
})

afterEach(async() => {
  slider.destroy()
  await pause(400)
  // Контроллер навигации — модульный синглтон (как в `slider.test.ts`).
  appNavigationController.spliceItems(0, Infinity)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: false } })
})

const history = () => slider.getHistory() as SliderSuperTab[]
const top = () => history()[history().length - 1]
const nextBtn = (tab: SliderSuperTab) =>
  tab.content.querySelector<HTMLButtonElement>(':scope > button.btn-corner')!
const row = (tab: SliderSuperTab, peerId: PeerId) =>
  tab.content.querySelector<HTMLElement>(`ul.chatlist > a.row[data-peer-id="${peerId}"]`)!

/** Флоу до второй вкладки: выбрать `peerIds` на первой и нажать «Далее». */
async function openNewGroup(peerIds: PeerId[]) {
  createNewGroupTab(slider)
  const addMembers = await waitForTop(AppAddMembersTab)
  for(const peerId of peerIds) row(addMembers, peerId).click()
  await settle()
  nextBtn(addMembers).click()
  const newGroup = await waitForTop(AppNewGroupTab) as InstanceType<typeof AppNewGroupTab>
  return { addMembers, newGroup }
}

const nameInput = (tab: SliderSuperTab) =>
  tab.content.querySelector<HTMLElement>('.input-wrapper > .input-field:not(.hide) > .input-field-input')!

const typeName = (tab: SliderSuperTab, value: string) => {
  const input = nameInput(tab)
  input.textContent = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('флоу «Новая группа» — шаги', () => {
  it('первый шаг — выбор участников: «Add Members», квадратные чекбоксы слева, «Далее» видна сразу (skippable)', async() => {
    createNewGroupTab(slider)
    const tab = await waitForTop(AppAddMembersTab)
    expect(tab).toBeInstanceOf(AppAddMembersTab)
    expect(tab.title.textContent).toBe('Add Members')
    expect(tab.container.classList.contains('add-members-container')).toBe(true)
    expect(tab.content.querySelector('.selector')!.className).toBe('selector selector-square selector-left')
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(true)
  })

  it('«Далее» открывает «New Group» с выбранными и вынимает выбор из истории (tweb attachToPromise)', async() => {
    const { addMembers, newGroup } = await openNewGroup([2])

    expect(newGroup).toBeInstanceOf(AppNewGroupTab)
    expect(newGroup.payload.peerIds).toEqual([2])
    expect(newGroup.title.textContent).toBe('New Group')
    expect(history()).toEqual([newGroup])

    await pause(400)
    expect(addMembers.container.isConnected).toBe(false)
  })

  it('пока «New Group» грузится, выбор участников в истории с прелоадером на «Далее»; въехала — выбор вынут', async() => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    getUsers.mockImplementation(async(ids) => {
      await gate
      return usersOf(ids)
    })

    createNewGroupTab(slider)
    const addMembers = await waitForTop(AppAddMembersTab)
    row(addMembers, 2).click()
    await settle()
    nextBtn(addMembers).click()
    await settle()

    expect(history()).toEqual([addMembers])
    expect(nextBtn(addMembers).disabled).toBe(true)
    expect(nextBtn(addMembers).querySelector('.tgico')).toBeNull()

    release()
    const newGroup = await waitForTop(AppNewGroupTab)
    expect(history()).toEqual([newGroup])
  })

  it('«Назад» со второй вкладки уводит из флоу, а не на выбор участников', async() => {
    const { newGroup } = await openNewGroup([2])

    newGroup.closeBtn.click()
    await pause(400)

    expect(history()).toEqual([])
    expect(sidebarEl.querySelector('.add-members-container')).toBeNull()
    expect(sidebarEl.querySelector('.new-group-container')).toBeNull()
  })

  it('повторный «Далее» по открытой «New Group» второй вкладки не создаёт (noSame)', async() => {
    const { newGroup } = await openNewGroup([2])
    expect(slider.createTab(AppNewGroupTab)).toBe(newGroup)
  })
})

describe('вкладка «New Group» — разметка', () => {
  it('секция аватара и имени, скрытое поле места, секция участников с chatlist-new и статусами', async() => {
    const { newGroup } = await openNewGroup([2, 3])

    expect(newGroup.container.classList.contains('new-group-container')).toBe(true)
    const [main, members] = [...newGroup.scrollable.container.querySelectorAll<HTMLElement>(':scope > .sidebar-left-section-container')]
    const content = main.querySelector('.sidebar-left-section-content')!
    expect([...content.children].map((el) => el.className)).toEqual(['avatar-edit', 'input-wrapper'])
    const fields = content.querySelectorAll('.input-wrapper > .input-field')
    expect(fields).toHaveLength(2)
    expect(fields[0].querySelector('label')!.textContent).toBe('Group Name')
    expect(fields[1].classList.contains('hide')).toBe(true)
    expect(fields[1].querySelector('label')!.textContent).toBe('Location')

    expect(members.classList.contains('hide')).toBe(false)
    expect(members.querySelector('.sidebar-left-section-name')!.textContent).toBe('2 members')
    const list = members.querySelector('ul')!
    expect(list.className).toBe('chatlist chatlist-new')
    const rows = [...list.querySelectorAll<HTMLElement>(':scope > a.row')]
    expect(rows.map((el) => +el.dataset.peerId!)).toEqual([2, 3])
    expect(rows[0].classList.contains('chatlist-chat-abitbigger')).toBe(true)
    expect(rows[0].querySelector('.row-subtitle')!.textContent).toBe('last seen recently')

    expect(nextBtn(newGroup).querySelector('.tgico')).not.toBeNull()
  })

  it('без участников: секция участников скрыта, имени-черновика нет, кнопка создания спрятана', async() => {
    const { newGroup } = await openNewGroup([])

    const members = newGroup.scrollable.container.querySelectorAll<HTMLElement>(':scope > .sidebar-left-section-container')[1]
    expect(members.classList.contains('hide')).toBe(true)
    expect(nameInput(newGroup).textContent).toBe('')
    expect(nextBtn(newGroup).classList.contains('is-visible')).toBe(false)
  })

  it('1–4 участника: имя-черновик «Я & первый, …» (tweb :242-249), кнопка создания видна', async() => {
    const { newGroup } = await openNewGroup([2, 3])

    expect(nameInput(newGroup).textContent).toBe('Me & Two, Three')
    expect(nextBtn(newGroup).classList.contains('is-visible')).toBe(true)
  })

  it('пустое имя прячет кнопку создания, непустое — показывает', async() => {
    const { newGroup } = await openNewGroup([2])

    typeName(newGroup, '')
    expect(nextBtn(newGroup).classList.contains('is-visible')).toBe(false)
    typeName(newGroup, 'Team')
    expect(nextBtn(newGroup).classList.contains('is-visible')).toBe(true)
  })
})

describe('вкладка «New Group» — создание', () => {
  it('зовёт createChat один раз с названием и участниками, закрывает вкладку и открывает чат', async() => {
    const { newGroup } = await openNewGroup([2, 3])
    typeName(newGroup, 'Team')

    nextBtn(newGroup).click()
    expect(nextBtn(newGroup).hasAttribute('disabled')).toBe(true)
    await settle()

    expect(createChat).toHaveBeenCalledTimes(1)
    expect(createChat).toHaveBeenCalledWith('Team', [2, 3])
    expect(history()).toEqual([])
    expect(openPeerMock).toHaveBeenCalledTimes(1)
    expect(openPeerMock).toHaveBeenCalledWith({ peerId: -50 })
    expect(setPhoto).not.toHaveBeenCalled()

    await pause(400)
    expect(sidebarEl.querySelector('.new-group-container')).toBeNull()
  })

  it('выбранный аватар заливается после создания и ставится чату (tweb editPhoto)', async() => {
    const { newGroup } = await openNewGroup([2])
    const file = vi.fn(async() => 77)
    avatarEdit.onChange!({ file })

    nextBtn(newGroup).click()
    await settle()

    expect(file).toHaveBeenCalledTimes(1)
    expect(setPhoto).toHaveBeenCalledWith(-50, 77)
  })

  it('отказ сервера возвращает кнопку и оставляет вкладку', async() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    createChat.mockRejectedValueOnce(new Error('boom'))
    const { newGroup } = await openNewGroup([2])

    nextBtn(newGroup).click()
    await settle()

    expect(nextBtn(newGroup).hasAttribute('disabled')).toBe(false)
    expect(history()).toEqual([newGroup])
    expect(openPeerMock).not.toHaveBeenCalled()
  })

  it('после закрытия аватар очищен, узлов вкладки в DOM нет (DoD 5)', async() => {
    const { newGroup } = await openNewGroup([2])
    const container = newGroup.container

    newGroup.close()
    await pause(400)

    expect(avatarEdit.clear).toHaveBeenCalledTimes(1)
    expect(container.isConnected).toBe(false)
  })
})
