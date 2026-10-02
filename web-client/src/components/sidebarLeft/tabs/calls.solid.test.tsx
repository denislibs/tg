/** @jsxImportSource solid-js */
/**
 * Тесты вкладки «Звонки» (`calls.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/calls.tsx`, 812502980).
 *
 * Вкладка НАСТОЯЩАЯ — `AppCallsTab` из `solidJsTabs/tabs.ts`, открытая через
 * колоночный слайдер (`@/test/columnSlider` → `sidebarLeft/columnSlider.ts`).
 * Стабы — только границы: менеджеры воркера, движок звонков (до 5-5 он и есть
 * `appImManager.callUser`), открытие чата, попап удаления (до 2C-8) и
 * геометрия (happy-dom её не считает).
 *
 * Предмет: строка журнала с направлением по классам tweb (`out`/`missed`),
 * свёртка смежных звонков в одну строку со счётчиком, перезвон кнопкой справа
 * (и то, что он НЕ открывает чат), «Показать в чате» кликом по строке, пустое
 * состояние, листание страницами, живые добавление и удаление, `noSame`,
 * удаление из контекстного меню и уборка острова после закрытия.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { MyMessage } from '@core/models'
import rootScope from '@lib/rootScope'
import { useSettingsStore } from '@/settings'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import contextMenuController from '@helpers/contextMenuController'
import { NAVIGATION_TRANSITION_TIME } from '@components/transition'
import { AppCallsTab } from '@components/solidJsTabs/tabs'
import { mountTestColumnSlider, type TestColumnSlider } from '@/test/columnSlider'
import styles from './calls.module.scss'

// Среда — Firefox с WebRTC и getUserMedia, флаг звонков НАСТОЯЩИЙ
// (`environment/callSupport.ts`, Отступление В7-6): перезвон обязан быть и там,
// где tweb его прячет UA-гейтом. `vi.hoisted` — до импортов: флаг считается при
// загрузке модуля.
vi.hoisted(() => {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => {} } })
  ;(globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = class {}
})

const startOutgoing = vi.fn()
vi.mock('@core/calls/callEngine', () => ({ startOutgoing: (...args: unknown[]) => startOutgoing(...args) }))

const openPeer = vi.fn()
vi.mock('@core/navigation/openPeer', () => ({ openPeer: (...args: unknown[]) => openPeer(...args) }))

const requestMessageJump = vi.fn()
vi.mock('@core/messageLink', () => ({ requestMessageJump: (...args: unknown[]) => requestMessageJump(...args) }))

type DeleteDialogArgs = {
  peerId: PeerId
  count: number
  canRevoke: boolean
  onDeleteForEveryone: () => void
  onDeleteForMe: () => void
}
const openDeleteMessageDialog = vi.fn<(args: DeleteDialogArgs) => void>()
vi.mock('@components/messages/ChatDialogs', () => ({
  openDeleteMessageDialog: (args: DeleteDialogArgs) => openDeleteMessageDialog(args),
}))

// Вкладка «Динамики и камера» — заглушка: её пины — `speakersAndCamera.solid.test.tsx`.
vi.mock('./speakersAndCamera.solid', () => ({
  default: () => {
    const el = document.createElement('div')
    el.className = 'speakers-tab-stub'
    return el
  },
}))

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

const NOW = Math.floor(Date.now() / 1000)

let nextId = 1
/** Служебное сообщение звонка — ровно то, что отдаёт `GET /calls`. */
function call(peerId: PeerId, o: { out?: boolean; missed?: boolean; video?: boolean; duration?: number; date?: number; id?: number } = {}): MyMessage {
  return {
    _: 'messageService',
    id: o.id ?? nextId++,
    peerId,
    peer_id: { _: 'peerUser', user_id: peerId },
    date: o.date ?? NOW,
    pFlags: o.out ? { out: true } : {},
    action: {
      _: 'messageActionPhoneCall',
      pFlags: o.video ? { video: true } : {},
      reason: { _: o.missed ? 'phoneCallDiscardReasonMissed' : 'phoneCallDiscardReasonHangup' },
      ...(o.duration !== undefined ? { duration: o.duration } : {}),
    },
  } as unknown as MyMessage
}

let host: TestColumnSlider
let log: ReturnType<typeof vi.fn>
let deleteMessage: ReturnType<typeof vi.fn>
let pages: MyMessage[][]

beforeEach(() => {
  nextId = 1
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  resetPeerMirror()
  applyPeerOps([{
    op: 'upsert',
    peers: [
      { _: 'user', id: 2, first_name: 'Борис', pFlags: {} },
      { _: 'user', id: 3, first_name: 'Вера', pFlags: {} },
    ] as never,
  }])

  pages = []
  // Страницы отдаются по порядку запросов; смещение запроса проверяют тесты.
  let page = 0
  log = vi.fn(async() => ({ messages: pages[page++] ?? [], users: [] }))
  deleteMessage = vi.fn(async() => {})
  const managers = {
    calls: { log },
    messages: { deleteMessage },
    peers: { fillMirror: vi.fn(async() => {}) },
  } as unknown as Managers

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = mountTestColumnSlider(columnEl, managers)
})

afterEach(async() => {
  contextMenuController.close()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  startOutgoing.mockReset()
  openPeer.mockReset()
  requestMessageJump.mockReset()
  openDeleteMessageDialog.mockReset()
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: false } })
})

const open = async() => {
  const tab = await host.openTab(AppCallsTab)
  await settle()
  return tab
}

type Tab = InstanceType<typeof AppCallsTab>
const rows = (tab: Tab) => [...tab.content.querySelectorAll<HTMLElement>('.row')]
const arrow = (row: HTMLElement) => row.querySelector<HTMLElement>('.row-subtitle .tgico')!
const callButton = (row: HTMLElement) => row.querySelector<HTMLButtonElement>('.row-right button.btn-icon')

describe('вкладка «Звонки» — строка журнала', () => {
  it('open(): calls-container, заголовок «Calls», строка — аватар 42, имя, стрелка и время', async() => {
    pages = [[call(2, { out: true, duration: 30 })]]
    const tab = await open()

    expect(tab.container.classList.contains('calls-container')).toBe(true)
    expect(tab.title.textContent).toBe('Calls')
    expect(log).toHaveBeenCalledWith(0, 100)
    const [row] = rows(tab)
    expect(row.querySelector('.row-media.row-media-abitbigger.avatar-42')).not.toBeNull()
    expect(row.querySelector('.row-title.text-bold .peer-title')!.textContent).toBe('Борис')
    expect(row.querySelector(`.row-subtitle .${styles.status} .${styles.text}`)).not.toBeNull()
  })

  it('направление — классами tweb: исходящий `out`, пропущенный `missed`, входящий — без обоих', async() => {
    pages = [[
      call(2, { out: true, duration: 30 }),
      call(3, { missed: true }),
      call(2, { duration: 12 }),
    ]]
    const tab = await open()
    const [outRow, missedRow, inRow] = rows(tab)

    expect(arrow(outRow).classList.contains(styles.arrow)).toBe(true)
    expect(arrow(outRow).classList.contains(styles.out)).toBe(true)
    expect(arrow(outRow).classList.contains(styles.missed)).toBe(false)

    expect(arrow(missedRow).classList.contains(styles.missed)).toBe(true)
    expect(arrow(missedRow).classList.contains(styles.out)).toBe(false)

    expect(arrow(inRow).classList.contains(styles.out)).toBe(false)
    expect(arrow(inRow).classList.contains(styles.missed)).toBe(false)
  })

  it('исходящий без ответа — всё равно `out`, не `missed` (tdesktop проверяет out() первым)', async() => {
    pages = [[call(2, { out: true, missed: true })]]
    const tab = await open()
    expect(arrow(rows(tab)[0]).classList.contains(styles.out)).toBe(true)
    expect(arrow(rows(tab)[0]).classList.contains(styles.missed)).toBe(false)
  })

  it('смежные звонки того же пира, направления и дня — одна строка «(2) …»; A→B→A — три строки', async() => {
    pages = [[
      call(2, { out: true, duration: 1 }),
      call(2, { out: true, duration: 2 }),
      call(3, { out: true, duration: 3 }),
      call(2, { out: true, duration: 4 }),
    ]]
    const tab = await open()
    const list = rows(tab)
    expect(list).toHaveLength(3)
    expect(list[0].querySelector(`.${styles.text}`)!.textContent).toMatch(/^\(2\) /)
    expect(list[1].querySelector(`.${styles.text}`)!.textContent).not.toMatch(/^\(/)
  })
})

describe('вкладка «Звонки» — действия строки', () => {
  it('кнопка справа (есть и в Firefox — В7-6) перезванивает с тем же видом звонка и НЕ открывает чат', async() => {
    pages = [[call(2, { out: true, video: true, duration: 5 }), call(3, { duration: 5 })]]
    const tab = await open()
    const [videoRow, voiceRow] = rows(tab)

    expect(callButton(videoRow), 'перезвон в Firefox скрыт — вернулся UA-гейт tweb').not.toBeNull()
    expect(callButton(videoRow)!.classList.contains('videocamera')).toBe(true)
    expect(callButton(voiceRow)!.classList.contains('phone')).toBe(true)

    callButton(videoRow)!.click()
    expect(startOutgoing).toHaveBeenCalledTimes(1)
    const [peer, video, peerId] = startOutgoing.mock.calls[0]
    expect(peer).toMatchObject({ id: 2, name: 'Борис' })
    expect(video).toBe(true)
    expect(peerId).toBe(2)
    expect(openPeer).not.toHaveBeenCalled()

    callButton(voiceRow)!.click()
    expect(startOutgoing.mock.calls[1][1]).toBe(false)
  })

  it('клик по строке — «Показать в чате»: прыжок к новейшему звонку строки, затем открытие пира', async() => {
    const newest = call(2, { out: true, duration: 1, id: 41 })
    pages = [[newest, call(2, { out: true, duration: 2, id: 40 })]]
    const tab = await open()

    rows(tab)[0].click()
    expect(requestMessageJump).toHaveBeenCalledWith(2, 41)
    expect(openPeer).toHaveBeenCalledTimes(1)
    expect(openPeer.mock.calls[0][1]).toMatchObject({ id: 2, title: 'Борис' })
    expect(startOutgoing).not.toHaveBeenCalled()
  })

  it('контекстное меню: «Удалить» открывает попап на все звонки строки, «у всех» удаляет каждый с revoke', async() => {
    pages = [[call(2, { out: true, duration: 1, id: 41 }), call(2, { out: true, duration: 2, id: 40 })]]
    const tab = await open()

    rows(tab)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    await settle()
    const menu = document.querySelector<HTMLElement>('.btn-menu.contextmenu.active')!
    const items = [...menu.querySelectorAll<HTMLElement>('.btn-menu-item')]
    expect(items.map((item) => item.querySelector('.btn-menu-item-text')!.textContent)).toEqual(['Show in chat', 'Delete'])
    expect(items[1].classList.contains('danger')).toBe(true)

    items[1].click()
    await settle()
    expect(openDeleteMessageDialog).toHaveBeenCalledTimes(1)
    const args = openDeleteMessageDialog.mock.calls[0][0]
    expect(args).toMatchObject({ peerId: 2, count: 2, canRevoke: true })

    args.onDeleteForEveryone()
    expect(deleteMessage.mock.calls).toEqual([[2, 41, true], [2, 40, true]])
  })
})

describe('вкладка «Звонки» — меню «⋮» шапки', () => {
  it('один пункт «Динамики и камера» открывает AppSpeakersAndCameraTab тем же слайдером; «Удалить все звонки» нет (О-45)', async() => {
    const tab = await open()
    const toggle = tab.header.querySelector<HTMLElement>('.btn-menu-toggle')!
    expect(toggle).not.toBeNull()

    toggle.click()
    await settle()
    const menu = document.querySelector<HTMLElement>('.btn-menu.active')!
    const items = [...menu.querySelectorAll<HTMLElement>('.btn-menu-item')]
    expect(items.map((item) => item.querySelector('.btn-menu-item-text')!.textContent)).toEqual(['Speakers and Camera'])

    items[0].click()
    await vi.waitFor(() => expect(document.querySelector('.speakers-tab-stub')).not.toBeNull())
    expect(host.slider.getHistory().length).toBe(2)
  })
})

describe('вкладка «Звонки» — данные', () => {
  it('пустой журнал — «No recent calls» с подписью, секции списка нет', async() => {
    const tab = await open()
    expect(tab.content.querySelector(`.${styles.emptyTitle}`)!.textContent).toBe('No recent calls')
    expect(tab.content.querySelector(`.${styles.emptyDescription}`)!.textContent)
      .toBe('Your recent voice and video calls will appear here.')
    expect(tab.content.querySelector(`.${styles.list}`)).toBeNull()
  })

  it('полная страница (100) — следующая по смещению 100 на скролле; короткая — конец, листание снято', async() => {
    pages = [
      Array.from({ length: 100 }, (_, i) => call(i % 2 ? 2 : 3, { duration: 1, date: NOW - i })),
      // исходящий — чтобы не слиться со входящим последним звонком первой страницы
      [call(2, { out: true, duration: 1, date: NOW - 1000 })],
    ]
    const tab = await open()
    expect(log).toHaveBeenCalledTimes(1)
    expect(tab.scrollable.onScrolledBottom).toBeTypeOf('function')

    tab.scrollable.onScrolledBottom!()
    await settle()
    expect(log).toHaveBeenLastCalledWith(100, 100)
    expect(tab.scrollable.onScrolledBottom).toBeUndefined()
    expect(rows(tab)).toHaveLength(101)
  })

  it('первая страница пришла, пока вкладка за краем: по концу перехода (tab.shown) — повторный checkForTriggers', async() => {
    pages = [Array.from({ length: 100 }, (_, i) => call(2, { duration: 1, date: NOW - i }))]
    const tab = await open()
    const check = vi.spyOn(tab.scrollable, 'checkForTriggers')
    expect(check).not.toHaveBeenCalled()

    await pause(NAVIGATION_TRANSITION_TIME + 50)
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('упавшая страница не защёлкивает список: следующий скролл повторяет запрос', async() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    log.mockRejectedValueOnce(new Error('net'))
    const tab = await open()
    expect(tab.content.querySelector(`.${styles.empty}`)).toBeNull()
    expect(tab.scrollable.onScrolledBottom).toBeTypeOf('function')

    tab.scrollable.onScrolledBottom!()
    await settle()
    expect(log).toHaveBeenCalledTimes(2)
    expect(tab.content.querySelector(`.${styles.empty}`)).not.toBeNull()
  })

  it('живой звонок встаёт наверх (history_append), удалённый уходит (history_delete); прочие сообщения мимо', async() => {
    pages = [[call(2, { duration: 1, date: NOW - 60, id: 5 })]]
    const tab = await open()

    rootScope.dispatchEventSingle('history_append', { storageKey: '3', message: call(3, { out: true, duration: 1, id: 9 }) })
    rootScope.dispatchEventSingle('history_append', {
      storageKey: '3',
      message: { _: 'message', id: 10, peerId: 3, date: NOW, pFlags: {}, message: 'привет' } as unknown as MyMessage,
    })
    await settle()
    expect(rows(tab).map((row) => row.querySelector('.peer-title')!.textContent)).toEqual(['Вера', 'Борис'])

    rootScope.dispatchEventSingle('history_delete', { peerId: 2, msgs: new Set([5]) })
    await settle()
    expect(rows(tab).map((row) => row.querySelector('.peer-title')!.textContent)).toEqual(['Вера'])
  })
})

describe('вкладка «Звонки» — жизненный цикл', () => {
  it('noSame: повторный createTab при открытой вкладке отдаёт ту же, а не вторую', async() => {
    const tab = await open()
    const again = await host.openTab(AppCallsTab)
    expect(again).toBe(tab)
    expect(document.querySelectorAll('.calls-container')).toHaveLength(1)
  })

  it('после закрытия и перехода в DOM нет .calls-container и строк, листание снято (DoD 5)', async() => {
    pages = [[call(2, { duration: 1 })]]
    const tab = await open()
    const scrollable = tab.scrollable

    tab.close()
    await pause(NAVIGATION_TRANSITION_TIME + 100)

    expect(document.querySelector('.calls-container')).toBeNull()
    expect(tab.container.querySelector('.row')).toBeNull()
    expect(scrollable.onScrolledBottom).toBeUndefined()
  })
})
