/** @jsxImportSource solid-js */
/**
 * Тесты вкладки выбора участников (`addMembers.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/addMembers.tsx`, 812502980).
 *
 * Вкладка НАСТОЯЩАЯ — `AppAddMembersTab` из `solidJsTabs/tabs.ts`, открытая
 * через колоночный слайдер (`sidebarLeft/index.ts`); селектор — настоящий
 * `AppSelectPeers`. Стабы — только границы: менеджеры воркера, зеркало индексов
 * диалогов и геометрия (happy-dom её не считает).
 *
 * Предмет — форма оригинала для исключений приватности (`type: 'privacy'`,
 * `privacySection.tsx:189-210`): заголовок из нагрузки, селектор прямо в
 * `.sidebar-content` (скроллер вкладки снят), круглые чекбоксы справа, отбор
 * групп и пользователей без себя, угловая «Далее» и её видимость, `takeOut` с
 * выбранными и закрытие, загрузчик на промисе, уборка острова.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import rootScope from '@lib/rootScope'
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import { useChatsStore } from '@stores/chatsStore'
import { useSettingsStore } from '@/settings'
import type { Chat, User } from '@core/peers/peer'
import { AppAddMembersTab } from '@components/solidJsTabs/tabs'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'

const ME = 1
const PEERS = new Map<PeerId, User | Chat>([
  [ME, { _: 'user', id: ME, first_name: 'Me', pFlags: { self: true } }],
  [2, { _: 'user', id: 2, first_name: 'Two', pFlags: {} }],
  [-10, { _: 'chat', id: 10, title: 'Group', participants_count: 3, date: 0 } as unknown as Chat],
  [-20, { _: 'channel', id: 20, title: 'Channel', participants_count: 9, date: 0, pFlags: { broadcast: true } } as unknown as Chat],
])

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

let host: InstalledSidebarLeft
let getDialogs: ReturnType<typeof vi.fn>

beforeEach(() => {
  rootScope.myId = ME
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  useChatsStore.setState({ dialogIndexById: { 2: 900, [-10]: 800, [-20]: 700 } })
  // заглушка пустой выдачи (книга контактов в «не privacy» пуста) — без сети
  vi.spyOn(lottieLoader, 'loadAnimationAsAsset').mockResolvedValue({} as LottiePlayer)
  vi.spyOn(lottieLoader, 'waitForFirstFrame').mockResolvedValue(undefined as never)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)

  getDialogs = vi.fn(async({ filterId }: { filterId: number }) => ({
    dialogs: (filterId === 0 ? [2, -10, -20] : []).map((peerId) => ({ peerId })),
    count: 3,
    isEnd: true,
  }))
  const managers = {
    dialogs: { getDialogs },
    contacts: { getContactsPeerIds: vi.fn(async() => []), testSelfSearch: vi.fn(async() => false) },
    channels: { search: vi.fn() },
    peers: {
      getPeers: vi.fn(async(ids: PeerId[]) => ids.map((id) => PEERS.get(id)).filter(Boolean)),
      fillMirror: vi.fn(async() => {}),
    },
  } as unknown as Managers

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = installSidebarLeft(managers, columnEl)
})

afterEach(async() => {
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: false } })
})

type Payload = Parameters<InstanceType<typeof AppAddMembersTab>['init']>[0]

const open = (payload: Partial<Payload> = {}) => host.openTab(AppAddMembersTab, {
  type: 'privacy',
  skippable: true,
  title: 'FilterChats',
  placeholder: 'PrivacyModal.Search.Placeholder',
  ...payload,
})

const nextBtn = (tab: InstanceType<typeof AppAddMembersTab>) =>
  tab.content.querySelector<HTMLButtonElement>(':scope > button.btn-corner')!
const rowIds = (tab: InstanceType<typeof AppAddMembersTab>) =>
  [...tab.content.querySelectorAll<HTMLElement>('ul.chatlist > a.row')].map((row) => +row.dataset.peerId!)
const row = (tab: InstanceType<typeof AppAddMembersTab>, peerId: PeerId) =>
  tab.content.querySelector<HTMLElement>(`ul.chatlist > a.row[data-peer-id="${peerId}"]`)!

describe('вкладка выбора участников — разметка', () => {
  it('заголовок из нагрузки, add-members-container, селектор прямо в .sidebar-content без скроллера вкладки', async() => {
    const tab = await open()
    await settle()

    expect(tab.title.textContent).toBe('Chats')
    expect(tab.container.classList.contains('add-members-container')).toBe(true)
    expect([...tab.content.children].map((el) => el.className)).toEqual([
      'btn-circle btn-corner z-depth-1 rp is-visible',
      'selector selector-round selector-right',
    ])
    expect(nextBtn(tab).querySelector('.tgico')).not.toBeNull()
  })

  it('privacy: группы и пользователи без себя, канал отсеян, чекбоксы круглые справа', async() => {
    const tab = await open()
    await settle()

    expect(getDialogs.mock.calls[0][0]).toMatchObject({ filterId: 0, query: '' })
    expect(rowIds(tab)).toEqual([2, -10])
    expect(row(tab, 2).lastElementChild!.classList.contains('checkbox-field-round')).toBe(true)
  })

  it('не privacy: квадратные чекбоксы слева, книга контактов', async() => {
    const tab = await open({ type: 'chat' })
    await settle()
    expect(tab.content.querySelector('.selector')!.className).toBe('selector selector-square selector-left')
    expect(getDialogs).not.toHaveBeenCalled()
  })

  it('selectedPeerIds: уже выбранные — чипы и галочки', async() => {
    const tab = await open({ selectedPeerIds: [-10] })
    await settle()
    expect([...tab.content.querySelectorAll<HTMLElement>('.selector-user')].map((chip) => chip.dataset.key)).toEqual(['-10'])
    expect(row(tab, -10).querySelector<HTMLInputElement>('input')!.checked).toBe(true)
  })
})

describe('вкладка выбора участников — «Далее»', () => {
  it('skippable: кнопка видна сразу; клик — takeOut с выбранными ровно один раз и закрытие', async() => {
    const takeOut = vi.fn()
    const tab = await open({ takeOut, selectedPeerIds: [2] })
    await settle()
    row(tab, -10).click()
    await settle()

    expect(nextBtn(tab).classList.contains('is-visible')).toBe(true)
    const close = vi.spyOn(tab, 'close')
    nextBtn(tab).click()

    expect(takeOut).toHaveBeenCalledTimes(1)
    expect(takeOut).toHaveBeenCalledWith([2, -10])
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('не skippable: кнопка появляется с выбором и прячется без него', async() => {
    const tab = await open({ skippable: false })
    await settle()
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(false)

    row(tab, 2).click()
    await settle()
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(true)

    row(tab, 2).click()
    await settle()
    expect(nextBtn(tab).classList.contains('is-visible')).toBe(false)
  })

  it('takeOut отдаёт промис: кнопка выключена с прелоадером, false — вернули как было, иначе — закрытие', async() => {
    let resolve!: (value: unknown) => void
    const takeOut = vi.fn(() => new Promise((r) => { resolve = r }))
    const tab = await open({ skippable: false, takeOut })
    await settle()
    row(tab, 2).click()
    await settle()
    const close = vi.spyOn(tab, 'close')

    nextBtn(tab).click()
    expect(nextBtn(tab).disabled).toBe(true)
    expect(nextBtn(tab).querySelector('.tgico')).toBeNull()

    resolve(false)
    await settle()
    expect(nextBtn(tab).disabled).toBe(false)
    expect(nextBtn(tab).querySelector('.tgico')).not.toBeNull()
    expect(close).not.toHaveBeenCalled()

    nextBtn(tab).click()
    resolve(true)
    await settle()
    expect(close).toHaveBeenCalledTimes(1)
  })
})

it('после закрытия Solid-остров и селектор сняты (DoD 5)', async() => {
  const tab = await open()
  await settle()
  const container = tab.container
  expect(container.querySelector('.selector')).not.toBeNull()

  tab.close()
  await pause(400)
  expect(container.isConnected).toBe(false)
  // ввод в поле снятого селектора больше не ищет
  getDialogs.mockClear()
  const input = container.querySelector<HTMLInputElement>('.selector-search-input')!
  input.value = 'x'
  input.dispatchEvent(new Event('input'))
  await pause(250)
  expect(getDialogs).not.toHaveBeenCalled()
})
