/** @jsxImportSource solid-js */
/**
 * Вкладка «Реакции» — порт tweb `sidebarRight/tabs/chatReactions.tsx` (812502980),
 * задача 0б-4 пачки П-1 (Б-39).
 *
 * Вкладка НАСТОЯЩАЯ — `AppChatReactionsTab` из `solidJsTabs/tabs.ts`, открытая
 * настоящим `SidebarSlider` (навигация `'right'`). Стабы — только менеджеры воркера.
 *
 * Предмет:
 *  - разметка по виду чата: группа — три радио в секции «Доступные реакции» с
 *    подписью по режиму, канал — тумблер «Включить реакции»; список реакций
 *    скрыт, кроме «Некоторых» и канала (`:148-204`);
 *  - момент сети оригинала: изменение откладывает запись на 3 с
 *    (`debounce(…, 3000, false, true)`, `:60`), закрытие вкладки сбрасывает
 *    отложенное сразу (`destroy`, `:116-120`); без изменений сети нет;
 *  - пустой «Некоторые» уходит как «Без реакций» (`:51-54`).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { Channel, ChannelFull, ChatReactions } from '@core/peers/peer'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import lang from '@/lang'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import appNavigationController from '@core/navigation/appNavigationController'
import SidebarSlider from '@components/slider'
import { AppChatReactionsTab } from '@components/solidJsTabs/tabs'
import { toReactionsPolicy } from './chatReactions.solid'

const GROUP_ID = 30
const CHANNEL_ID = 20

const group = (): Channel => ({
  _: 'channel', id: GROUP_ID, title: 'Group', photo: { _: 'chatPhotoEmpty' }, date: 0,
  pFlags: { megagroup: true, creator: true },
} as Channel)
const channel = (): Channel => ({
  _: 'channel', id: CHANNEL_ID, title: 'Channel', photo: { _: 'chatPhotoEmpty' }, date: 0,
  pFlags: { broadcast: true, creator: true },
} as Channel)
const fullOf = (id: number, available_reactions?: ChatReactions): ChannelFull => ({
  _: 'channelFull', id, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null,
  ...(available_reactions ? { available_reactions } : {}),
})
const reaction = (emoji: string, title: string, inactive = false): AvailableReaction => ({
  emoji, title, position: 0, premium: false, inactive,
})
const CATALOG = [reaction('👍', 'Thumbs Up'), reaction('👎', 'Thumbs Down'), reaction('❤', 'Red Heart'), reaction('🥱', 'Yawn', true)]

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

beforeAll(async() => {
  await import('./chatReactions.solid')
})

let slider: SidebarSlider
let groups: Record<string, ReturnType<typeof vi.fn>>
let cards: Map<number, { chat: Channel, fullChat: ChannelFull }>

beforeEach(() => {
  resetPeerMirror()
  cards = new Map()
  groups = {
    card: vi.fn(async(peerId: number) => {
      const card = cards.get(peerId)
      return card ? { peerId, ...card } : null
    }),
    setReactions: vi.fn(async() => {}),
  }
  const managers = {
    groups,
    reactions: { list: vi.fn(async() => CATALOG) },
    media: {},
    peers: { fillMirror: vi.fn(async() => {}) },
  } as unknown as Managers

  const sidebarEl = document.createElement('div')
  sidebarEl.id = 'column-right'
  const sliderEl = document.createElement('div')
  sliderEl.classList.add('sidebar-content', 'sidebar-slider', 'tabs-container')
  sidebarEl.append(sliderEl)
  document.body.append(sidebarEl)
  slider = new SidebarSlider({ sidebarEl, navigationType: 'right', managers, canHideFirst: true })
})

afterEach(async() => {
  vi.useRealTimers()
  slider.closeAllTabs()
  await pause(400)
  appNavigationController.spliceItems(0, Infinity)
  document.body.replaceChildren()
  resetPeerMirror()
  vi.restoreAllMocks()
})

const open = async(chat: Channel, policy?: ChatReactions) => {
  cards.set(-chat.id, { chat, fullChat: fullOf(chat.id, policy) })
  applyPeerOps([{ op: 'upsert', peers: [chat] }])
  const tab = slider.createTab(AppChatReactionsTab)
  await tab.open({ chatId: chat.id })
  await settle()
  return tab
}

type Tab = Awaited<ReturnType<typeof open>>

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/[-]/g, '').trim()
const sections = (tab: Tab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
const rowTitles = (el: Element) => [...el.querySelectorAll('.row')].map((row) => text(row.querySelector('.row-title')))
const caption = (el: Element) => text(el.querySelector('.sidebar-left-section-caption'))
const radios = (tab: Tab) => [...sections(tab)[0].querySelectorAll<HTMLInputElement>('input[type="radio"]')]
const toggles = (el: Element) => [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
const check = (input: HTMLInputElement, value = true) => {
  input.checked = value
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('вкладка «Реакции» — разметка как у оригинала', () => {
  it('группа: «Доступные реакции», три радио, подпись по режиму; список скрыт вне «Некоторых»', async() => {
    const tab = await open(group(), { _: 'chatReactionsAll' })

    expect(text(tab.title)).toBe(lang.Reactions)
    const [modes, list] = sections(tab)
    expect(text(modes.querySelector('.sidebar-left-section-name'))).toBe(lang.AvailableReactions)
    expect(rowTitles(modes)).toEqual([lang.AllReactions, lang.SomeReactions, lang.NoReactions])
    expect(radios(tab).map((radio) => radio.checked)).toEqual([true, false, false])
    expect(caption(modes)).toBe(lang.EnableAllReactionsInfo)
    // неактивная реакция каталога не показывается (`getActiveAvailableReactions`)
    expect(rowTitles(list)).toEqual(['Thumbs Up', 'Thumbs Down', 'Red Heart'])
    expect(list.classList.contains('hide')).toBe(true)
  })

  it('группа «Некоторые»: отмечены реакции политики, список виден', async() => {
    const tab = await open(group(), { _: 'chatReactionsSome', reactions: [{ _: 'reactionEmoji', emoticon: '❤' }] })
    const [modes, list] = sections(tab)

    expect(radios(tab).map((radio) => radio.checked)).toEqual([false, true, false])
    expect(caption(modes)).toBe(lang.EnableSomeReactionsInfo)
    expect(list.classList.contains('hide')).toBe(false)
    expect(toggles(list).map((input) => input.checked)).toEqual([false, false, true])
  })

  it('канал: тумблер «Включить реакции» без имени секции, подпись канала, список виден', async() => {
    const tab = await open(channel())
    const [modes, list] = sections(tab)

    expect(modes.querySelector('.sidebar-left-section-name')).toBeNull()
    expect(rowTitles(modes)).toEqual([lang.EnableReactions])
    expect(toggles(modes)[0].checked).toBe(false)
    expect(caption(modes)).toBe(lang.EnableReactionsChannelInfo)
    expect(list.classList.contains('hide')).toBe(false)
  })
})

describe('вкладка «Реакции» — сеть в момент оригинала', () => {
  it('смена режима не пишет сразу; закрытие вкладки сбрасывает отложенную запись одним вызовом', async() => {
    const tab = await open(group(), { _: 'chatReactionsAll' })

    check(radios(tab)[1])
    await settle()
    expect(groups.setReactions).not.toHaveBeenCalled()
    // «Некоторые» по умолчанию — 👍 и 👎 (`:73`), список раскрылся
    expect(sections(tab)[1].classList.contains('hide')).toBe(false)
    expect(caption(sections(tab)[0])).toBe(lang.EnableSomeReactionsInfo)

    slider.onCloseBtnClick()
    await pause(400)

    expect(groups.setReactions).toHaveBeenCalledTimes(1)
    expect(groups.setReactions).toHaveBeenCalledWith(-GROUP_ID, 'some', ['👍', '👎'])
    // Solid-корень снят
    expect(tab.container.isConnected).toBe(false)
    expect(tab.scrollable.container.querySelector('.sidebar-left-section-container')).toBeNull()
  })

  it('без изменений закрытие сети не трогает', async() => {
    await open(group(), { _: 'chatReactionsAll' })

    slider.onCloseBtnClick()
    await pause(400)

    expect(groups.setReactions).not.toHaveBeenCalled()
  })

  it('отложенная запись уходит через 3 с после последнего изменения, одна на серию', async() => {
    const tab = await open(group(), { _: 'chatReactionsAll' })
    vi.useFakeTimers()

    check(radios(tab)[2])
    await vi.advanceTimersByTimeAsync(2000)
    check(radios(tab)[0])
    await vi.advanceTimersByTimeAsync(2999)
    expect(groups.setReactions).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(groups.setReactions).toHaveBeenCalledTimes(1)
    expect(groups.setReactions).toHaveBeenCalledWith(-GROUP_ID, 'all', [])
    vi.useRealTimers()

    // записанное не пишется повторно на закрытии
    slider.onCloseBtnClick()
    await pause(400)
    expect(groups.setReactions).toHaveBeenCalledTimes(1)
  })

  it('сняты все реакции «Некоторых» — уходит «Без реакций», подпись и радио следом', async() => {
    const tab = await open(group(), { _: 'chatReactionsSome', reactions: [{ _: 'reactionEmoji', emoticon: '❤' }] })

    check(toggles(sections(tab)[1])[2], false)
    await settle()
    expect(radios(tab).map((radio) => radio.checked)).toEqual([false, false, true])
    expect(caption(sections(tab)[0])).toBe(lang.DisableReactionsInfo)

    slider.onCloseBtnClick()
    await pause(400)
    expect(groups.setReactions).toHaveBeenCalledWith(-GROUP_ID, 'none', [])
  })

  it('канал: включение отмечает весь каталог и пишет на закрытии', async() => {
    const tab = await open(channel())

    check(toggles(sections(tab)[0])[0])
    await settle()
    expect(toggles(sections(tab)[1]).map((input) => input.checked)).toEqual([true, true, true])

    slider.onCloseBtnClick()
    await pause(400)
    expect(groups.setReactions).toHaveBeenCalledWith(-CHANNEL_ID, 'some', ['👍', '👎', '❤'])
  })
})

describe('toReactionsPolicy — перевод ChatReactions в ручку бэкенда', () => {
  it('Some — режим и эмодзи, All/None — без эмодзи', () => {
    expect(toReactionsPolicy({ _: 'chatReactionsSome', reactions: [{ _: 'reactionEmoji', emoticon: '👍' }] }))
      .toEqual({ mode: 'some', emojis: ['👍'] })
    expect(toReactionsPolicy({ _: 'chatReactionsAll', pFlags: { allow_custom: true } })).toEqual({ mode: 'all', emojis: [] })
    expect(toReactionsPolicy({ _: 'chatReactionsNone' })).toEqual({ mode: 'none', emojis: [] })
  })
})
