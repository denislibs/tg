/** @jsxImportSource solid-js */
/**
 * Вкладка статистики `AppStatisticsTab` (`statistics.solid.tsx`, порт tweb
 * `sidebarRight/tabs/statistics.tsx`, 812502980), задача 0б-9 (П-1).
 *
 * Вкладка настоящая, в настоящей правой колонке (`test/sidebarRight.ts`).
 * Стабы — только границы: пакет графиков `lib/tchart` (канвас, его предмет —
 * апстрим tweb; здесь проверяется, ЧТО вкладка ему отдаёт), лотти-заглушка
 * загрузки и менеджеры воркера.
 *
 * Предмет: открытие в трёх режимах (канал, группа, пост) с нужной ручкой и
 * заголовком; графики рисуются по данным ответа (цвета без префикса палитры,
 * `statsGraphError` выброшен); обзор без нулевых значений; недавний пост —
 * строка, клик по которой открывает статистику поста.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatsBroadcastStats, StatsGraph, StatsMegagroupStats, StatsMessageStats } from '@layer'
import type { Managers } from '@/client/bootstrap'
import type { Channel } from '@core/peers/peer'
import type { MyMessage } from '@core/models'
import { NAVIGATION_TRANSITION_TIME } from '@components/transition'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { installSidebarRight } from '@/test/sidebarRight'
import { useSettingsStore } from '@/settings'
import AppStatisticsTab from './statistics.solid'

const charts = vi.hoisted(() => ({ rendered: [] as { container: HTMLElement, data: Record<string, unknown>, settings: Record<string, unknown> }[] }))
vi.mock('@lib/tchart/chart', () => ({
  default: {
    render: (opts: { container: HTMLElement, data: Record<string, unknown>, settings: Record<string, unknown> }) => {
      charts.rendered.push(opts)
      const $wrapper = document.createElement('div')
      $wrapper.className = 'tchart--wrapper'
      opts.container.append($wrapper)
      return { $wrapper, setDarkMode: () => {} }
    },
  },
}))

vi.mock('@components/emptyPlaceholder.solid', () => ({
  default: async() => {
    const element = document.createElement('div')
    element.className = 'selector-empty-placeholder'
    return element
  },
}))

const CHANNEL: PeerId = -200
const GROUP: PeerId = -100
const POST = 5

const channel = (id: number, pFlags: Channel['pFlags']): Channel => ({
  _: 'channel', id, title: 'C' + id, photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags,
  default_banned_rights: { _: 'chatBannedRights', pFlags: {}, until_date: 0 },
} as Channel)

const graph = (name: string): StatsGraph.statsGraph => ({
  _: 'statsGraph',
  json: {
    _: 'dataJSON',
    data: JSON.stringify({
      columns: [['x', 1756684800000, 1756771200000], ['y0', 1, 4]],
      types: { x: 'x', y0: 'line' },
      names: { y0: name },
      colors: { y0: 'BLUE#3497ED' },
      hidden: [],
    }),
  },
})
const graphError: StatsGraph.statsGraphError = { _: 'statsGraphError', error: 'NOT_ENOUGH_DATA' }
const abs = (current: number) => ({ _: 'statsAbsValueAndPrev' as const, current, previous: 0 })

const broadcastStats = (): StatsBroadcastStats => ({
  _: 'stats.broadcastStats',
  period: { _: 'statsDateRangeDays', min_date: 1756684800, max_date: 1756771200 },
  followers: abs(4),
  views_per_post: abs(10),
  shares_per_post: abs(0),
  reactions_per_post: abs(0),
  views_per_story: abs(0),
  shares_per_story: abs(0),
  reactions_per_story: abs(0),
  enabled_notifications: { _: 'statsPercentValue', part: 3, total: 4 },
  growth_graph: graph('Total followers'),
  followers_graph: graphError,
  mute_graph: graphError,
  top_hours_graph: graphError,
  interactions_graph: graph('Views'),
  iv_interactions_graph: graphError,
  views_by_source_graph: graphError,
  new_followers_by_source_graph: graphError,
  languages_graph: graphError,
  reactions_by_emotion_graph: graphError,
  story_interactions_graph: graphError,
  story_reactions_by_emotion_graph: graphError,
  recent_posts_interactions: [{ _: 'postInteractionCountersMessage', msg_id: POST, views: 10, forwards: 2, reactions: 1 }],
})

const post = (): MyMessage => ({
  _: 'message',
  id: POST,
  pFlags: {},
  peerId: CHANNEL,
  peer_id: { _: 'peerChannel', channel_id: 200 },
  date: 1756771200,
  message: 'Пост',
  views: 10,
  forwards: 2,
  reactions: { _: 'messageReactions', pFlags: {}, results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '❤️' }, count: 3 }] },
} as unknown as MyMessage)

function fakeManagers() {
  const getBroadcastStats = vi.fn(async() => ({ stats: broadcastStats() }))
  const getMegagroupStats = vi.fn(async() => ({ stats: {
    _: 'stats.megagroupStats',
    period: { _: 'statsDateRangeDays', min_date: 1756684800, max_date: 1756771200 },
    members: abs(7), messages: abs(12), viewers: abs(0), posters: abs(0),
    growth_graph: graph('Total members'), members_graph: graph('Joined'),
    new_members_by_source_graph: graphError, languages_graph: graphError, messages_graph: graph('Messages'),
    actions_graph: graphError, top_hours_graph: graphError, weekdays_graph: graphError,
    top_posters: [], top_admins: [], top_inviters: [], users: [],
  } as StatsMegagroupStats }))
  const getMessageStats = vi.fn(async() => ({ stats: {
    _: 'stats.messageStats', views_graph: graph('Views'), reactions_by_emotion_graph: graphError,
  } as StatsMessageStats }))
  const reloadMessage = vi.fn(async() => post())
  const managers = {
    stats: { getBroadcastStats, getMegagroupStats, getMessageStats },
    messages: { reloadMessage },
    peers: { fillMirror: async() => {} },
  } as unknown as Managers
  return { managers, getBroadcastStats, getMegagroupStats, getMessageStats, reloadMessage }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let sidebar: ReturnType<typeof installSidebarRight>
let fake: ReturnType<typeof fakeManagers>

/** Открытие как у пункта меню: `createTab(AppStatisticsTab).open(...)`, затем выезд вкладки. */
async function openStats(peerId: PeerId, mid?: number) {
  const tab = sidebar.sidebar.createTab(AppStatisticsTab)
  await tab.open(peerId, mid)
  // `onOpenAfterTimeout` (конец перехода) отпускает отрисовку содержимого
  await pause(NAVIGATION_TRANSITION_TIME + 100)
  return tab
}

const titles = (tab: AppStatisticsTab) => [...tab.container.querySelectorAll('.statistics-title-text')].map((el) => el.textContent)
const overviewNames = (tab: AppStatisticsTab) => [...tab.container.querySelectorAll('.statistics-overview-item-name')].map((el) => el.textContent)

beforeEach(() => {
  charts.rendered.length = 0
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [channel(200, { broadcast: true }), channel(100, { megagroup: true })] }])
  // без анимации проявления (`liteMode.isAvailable('animations')`)
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  fake = fakeManagers()
  sidebar = installSidebarRight(fake.managers)
})

afterEach(async() => {
  sidebar.dispose()
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: false } })
  await pause(0)
})

describe('AppStatisticsTab — канал (stats.broadcastStats)', () => {
  it('открывается: заголовок «Statistics», класс вкладки, ручка канала', async() => {
    const tab = await openStats(CHANNEL)
    expect(fake.getBroadcastStats).toHaveBeenCalledWith({ peerId: CHANNEL })
    expect(tab.container.classList.contains('statistics-container')).toBe(true)
    expect(tab.title.textContent).toBe('Statistics')
    expect(tab.container.isConnected).toBe(true)
  })

  it('графики рисуются по данным ответа; statsGraphError выброшен', async() => {
    const tab = await openStats(CHANNEL)
    expect(titles(tab)).toEqual(['Growth', 'Interactions'])
    expect(charts.rendered).toHaveLength(2)

    const [growth] = charts.rendered
    expect(growth.data.columns).toEqual([['x', 1756684800000, 1756771200000], ['y0', 1, 4]])
    expect(growth.data.names).toEqual({ y0: 'Total followers' })
    // цвет палитры — без префикса `BLUE` (`extractColor`, tweb :130-132)
    expect(growth.data.colors).toEqual({ y0: '#3497ED' })
    expect(growth.settings.darkMode).toBe(false)
    expect(growth.container.closest('.statistics-chart')).not.toBeNull()
    expect(tab.container.querySelectorAll('.statistics-chart .tchart--wrapper')).toHaveLength(2)
  })

  it('обзор: нулевые значения не показываются, доля уведомлений — в процентах', async() => {
    const tab = await openStats(CHANNEL)
    expect(overviewNames(tab)).toEqual(['Followers', 'Enabled Notifications', 'Views Per Post'])
    expect(tab.container.querySelector('.statistics-overview-item-value')!.textContent).toBe('4')
    expect([...tab.container.querySelectorAll('.statistics-overview-item-value')][1].textContent).toBe('75.00%')
  })

  it('недавний пост — строка; клик открывает статистику этого поста', async() => {
    const tab = await openStats(CHANNEL)
    expect(fake.reloadMessage).toHaveBeenCalledWith(CHANNEL, POST)
    const rows = tab.container.querySelectorAll<HTMLElement>('.statistics-post')
    expect(rows).toHaveLength(1)

    const createTab = vi.spyOn(sidebar.sidebar, 'createTab')
    rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(createTab).toHaveBeenCalledWith(AppStatisticsTab)
    await pause(NAVIGATION_TRANSITION_TIME + 100)
    expect(fake.getMessageStats).toHaveBeenCalledWith({ peerId: CHANNEL, mid: POST })
  })
})

describe('AppStatisticsTab — группа и пост', () => {
  it('группа: stats.megagroupStats, заголовок «Group Statistics», три графика', async() => {
    const tab = await openStats(GROUP)
    expect(fake.getMegagroupStats).toHaveBeenCalledWith({ peerId: GROUP })
    expect(fake.getBroadcastStats).not.toHaveBeenCalled()
    expect(tab.title.textContent).toBe('Group Statistics')
    expect(titles(tab)).toEqual(['Growth', 'Group members', 'Messages'])
    expect(overviewNames(tab)).toEqual(['Members', 'Messages'])
  })

  it('пост: обзор из самого сообщения, пересылки — приблизительно, график просмотров', async() => {
    const tab = await openStats(CHANNEL, POST)
    expect(fake.getMessageStats).toHaveBeenCalledWith({ peerId: CHANNEL, mid: POST })
    expect(tab.title.textContent).toBe('Post Statistics')
    expect(titles(tab)).toEqual(['Views and Shares'])
    expect(overviewNames(tab)).toEqual(['Views', 'Reactions', 'Private Shares'])
    const values = [...tab.container.querySelectorAll('.statistics-overview-item-value')].map((el) => el.textContent)
    expect(values).toEqual(['10', '3', '≈2'])
    // текущий пост — строкой без счётчиков над обзором
    expect(tab.container.querySelectorAll('.statistics-post')).toHaveLength(1)
  })
})
