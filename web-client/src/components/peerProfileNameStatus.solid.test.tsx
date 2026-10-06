/** @jsxImportSource solid-js */
/**
 * Тесты задачи 3 (`peerProfile.solid.tsx`, план
 * `docs/superpowers/plans/2026-09-05-profile-card-solid.md`, «Задача 3»):
 * имя и статус пира ВНУТРИ переданного `avatarsInfo` (узел `PeerProfileAvatars
 * .info`), а не в `.profile-content`.
 *
 * Отдельный файл от `peerProfile.solid.test.tsx` (Task 2, каркас) — у этого
 * набора СВОЙ, более богатый мок `stores/chatsStore` (нужны `subscribe` +
 * управляемые `presence`/`typing`, которых у мока Task 2 нет), и свой мок
 * `core/presence` (счётчик вызовов `getUserStatusString` — так проверяется
 * периодический пересчёт без реального изменения presence, tweb `:401`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'

const peerSignal = createSignal<unknown>(undefined)
const fullPeerSignal = createSignal<unknown>(undefined)
vi.mock('../stores/peers.solid', () => ({ usePeer: () => peerSignal[0] }))
vi.mock('../stores/fullPeers.solid', () => ({ useFullPeer: () => fullPeerSignal[0] }))

let meId: number | null = 1
let storeState: { presence: Record<number, unknown>; typing: Record<number, Record<number, unknown>>; dialogs: unknown[] } = {
  presence: {},
  typing: {},
  // Task 4 (`MainSection.Notifications`, теперь ребёнок `.profile-content`)
  // читает `dialogs` у ЛЮБОГО монтажа этого компонента — пустой массив
  // достаточен для теста ЭТОГО файла (предмет — имя/статус, не Notifications).
  dialogs: [],
}
const subs = new Set<() => void>()
function setStoreState(patch: Partial<typeof storeState>) {
  storeState = { ...storeState, ...patch }
  subs.forEach((f) => f())
}
vi.mock('../stores/chatsStore', () => ({
  useChatsStore: {
    getState: () => ({ meId, ...storeState }),
    subscribe: (cb: () => void) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
  },
}))

const getUserStatusStringSpy = vi.fn((_user: unknown, status: unknown) => {
  const span = document.createElement('span')
  span.textContent = status ? 'ONLINE_LABEL' : 'OFFLINE_LABEL'
  return span
})
vi.mock('../core/presence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/presence')>()),
  getUserStatusString: (u: unknown, s: unknown) => getUserStatusStringSpy(u, s),
}))

// Подпись группы/канала — `appImManager.setPeerStatus` (tweb :376-410): статус
// чата считает блок L (`lib/appImManager.ts`), здесь — только проводка вызова.
const setPeerStatus = vi.fn(async(options: { peerId: number, element: HTMLElement, needClear: boolean }) => {
  return () => { options.element.textContent = 'STATUS:' + options.peerId + (options.needClear ? ':clear' : '') }
})
vi.mock('@lib/appImManager', () => ({ default: { setPeerStatus: (o: never) => setPeerStatus(o) } }))
const managers = { groups: {} }
vi.mock('../client/bootstrap', () => ({ startClient: () => ({ managers }) }))

const { default: PeerProfile } = await import('./peerProfile.solid')

let dispose: (() => void) | undefined

function mount(props: Record<string, unknown>) {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <PeerProfile {...(props as Parameters<typeof PeerProfile>[0])} />, host)
  return host
}

const el = () => document.createElement('div')

afterEach(() => {
  dispose?.()
  dispose = undefined
  meId = 1
  storeState = { presence: {}, typing: {}, dialogs: [] }
  subs.clear()
  peerSignal[1](undefined)
  fullPeerSignal[1](undefined)
  getUserStatusStringSpy.mockClear()
  vi.useRealTimers()
})

describe('Name/Subtitle: узел — avatarsInfo, не .profile-content', () => {
  it('имя и статус рисуются ВНУТРИ переданного avatarsInfo', () => {
    peerSignal[1]({ _: 'user', id: 7, first_name: 'Alice' })
    const info = document.createElement('div')
    const host = mount({ peerId: 7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })

    expect(info.querySelector('.profile-name')).not.toBeNull()
    expect(info.querySelector('.profile-subtitle')).not.toBeNull()
    expect(info.textContent).toContain('Alice')
    // Узел НЕ в .profile-content — правило владения (info принадлежит классу
    // шапки, .profile-content — этому Solid-корню, это два разных узла).
    expect(host.querySelector('.profile-content .profile-name')).toBeNull()
  })

  it('без avatarsInfo (остров шапки ещё не смонтирован) — тихо ничего не рисует, не падает', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    expect(() => mount({ peerId: 7, scrollable: el(), setCollapsedOn: el() })).not.toThrow()
  })

  it('смена пира: узлы прежнего пира не остаются, приезжают узлы нового', () => {
    const info = document.createElement('div')
    peerSignal[1]({ _: 'user', id: 7, first_name: 'Alice' })
    mount({ peerId: 7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })
    expect(info.textContent).toContain('Alice')

    dispose!()
    dispose = undefined
    expect(info.children.length).toBe(0) // старые узлы сняты ДО прихода новых

    peerSignal[1]({ _: 'user', id: 8, first_name: 'Bob' })
    mount({ peerId: 8, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })
    expect(info.textContent).toContain('Bob')
    expect(info.textContent).not.toContain('Alice')
  })
})

describe('Subtitle: подписки/таймер снимаются на unmount', () => {
  it('подписки на chatsStore.subscribe и 60с-таймер отписываются/чистятся при dispose', () => {
    vi.useFakeTimers()
    peerSignal[1]({ _: 'user', id: 7 })
    const info = document.createElement('div')
    mount({ peerId: 7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })

    expect(subs.size).toBeGreaterThan(0)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    dispose!()
    dispose = undefined

    expect(subs.size).toBe(0) // МУТАЦИЯ: убери onCleanup у подписки — упадёт здесь
    expect(vi.getTimerCount()).toBe(0) // МУТАЦИЯ: убери clearInterval — упадёт здесь
  })

  it('событие после cleanup ничего не меняет (слушатель реально снят)', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    const info = document.createElement('div')
    mount({ peerId: 7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })
    dispose!()
    dispose = undefined
    expect(info.children.length).toBe(0)

    // Тот же путь, которым в проде приходят rt:presence/rt:typing — вызов
    // подписчиков после отписки не должен ни бросить, ни что-либо вставить.
    expect(() => setStoreState({ presence: { 7: { _: 'userStatusOnline', expires: 9999999999 } } })).not.toThrow()
    expect(info.children.length).toBe(0)
  })
})

describe('Subtitle: пересчёт по typing/presence/таймеру', () => {
  it('typing-событие (sendMessageTypingAction) переключает на индикатор печати', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    const info = document.createElement('div')
    mount({ peerId: 7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })
    expect(info.querySelector('.peer-typing-container')).toBeNull()

    setStoreState({ typing: { 7: { 7: { action: { _: 'sendMessageTypingAction' }, at: Date.now() } } } })

    const typing = info.querySelector('.peer-typing-container')
    expect(typing).not.toBeNull()
    // Три точки — прямые дети span-обёртки дотов (TypingDots), а не любые
    // вложенные span (i18n-узел статуса рядом тоже span, но не эти дети).
    const dots = typing!.querySelector('span')!
    expect(dots.querySelectorAll(':scope > span')).toHaveLength(3)
  })

  it('typing с непортированным action (нет ключа словаря) — падает на обычный статус, не на индикатор', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    const info = document.createElement('div')
    mount({ peerId: 7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })

    setStoreState({ typing: { 7: { 7: { action: { _: 'sendMessageUploadPhotoAction' }, at: Date.now() } } } })

    expect(info.querySelector('.peer-typing-container')).toBeNull()
  })

  it('обновление presence (аналог tweb user_update) пересчитывает статус', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    const info = document.createElement('div')
    mount({ peerId: 7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })
    expect(info.textContent).toContain('OFFLINE_LABEL')

    setStoreState({ presence: { 7: { _: 'userStatusOnline', expires: 9999999999 } } })

    expect(info.textContent).toContain('ONLINE_LABEL')
    expect(info.textContent).not.toContain('OFFLINE_LABEL')
  })

  it('периодический пересчёт раз в 60с — даже без нового presence-события (tweb :401)', () => {
    vi.useFakeTimers()
    peerSignal[1]({ _: 'user', id: 7 })
    const info = document.createElement('div')
    mount({ peerId: 7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })

    const callsBefore = getUserStatusStringSpy.mock.calls.length
    vi.advanceTimersByTime(60_000)
    expect(getUserStatusStringSpy.mock.calls.length).toBeGreaterThan(callsBefore) // МУТАЦИЯ: убери таймер — не подрастёт
  })
})

describe('Subtitle: needStatus (tweb :335-339)', () => {
  it('свой диалог (Избранное, peerId===meId && isDialog) — статус не рисуется вовсе', () => {
    meId = 42
    peerSignal[1]({ _: 'user', id: 42 })
    const info = document.createElement('div')
    mount({ peerId: 42, isDialog: true, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })
    expect(info.querySelector('.profile-subtitle-text')!.textContent).toBe('')
  })

  it('чужой пир — статус рисуется', () => {
    meId = 42
    peerSignal[1]({ _: 'user', id: 7 })
    const info = document.createElement('div')
    mount({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })
    expect(info.querySelector('.profile-subtitle-text')!.textContent).not.toBe('')
  })
})

describe('Name: бейджи (verified/premium/emoji-status)', () => {
  it('показываются по pFlags/полю пользователя', () => {
    peerSignal[1]({ _: 'user', id: 7, pFlags: { verified: true, premium: true }, emoji_status_emoticon: '🔥' })
    const info = document.createElement('div')
    mount({ peerId: 7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })

    expect(info.querySelector('svg[aria-label="verified"]')).not.toBeNull()
    expect(info.querySelector('.tgico')).not.toBeNull()
    expect(info.textContent).toContain('🔥')
  })

  it('без флагов — ни одного бейджа', () => {
    peerSignal[1]({ _: 'user', id: 7 })
    const info = document.createElement('div')
    mount({ peerId: 7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })

    expect(info.querySelector('svg[aria-label="verified"]')).toBeNull()
    expect(info.querySelector('.tgico')).toBeNull()
  })
})

describe('Subtitle: группа/канал — `appImManager.setPeerStatus` («N участников, M онлайн»)', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('первый вызов — с очисткой, статус ложится в span подписи', async() => {
    setPeerStatus.mockClear()
    peerSignal[1]({ _: 'channel', id: 7, pFlags: { megagroup: true }, participants_count: 42 })
    const info = document.createElement('div')
    mount({ peerId: -7, isDialog: true, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })
    await flush()
    expect(setPeerStatus).toHaveBeenCalledTimes(1)
    expect(setPeerStatus.mock.calls[0][0]).toMatchObject({ peerId: -7, needClear: true, ignoreSelf: false, managers })
    expect(info.querySelector('.profile-subtitle-text')!.textContent).toBe('STATUS:-7:clear')
  })

  it('набор в чате (`peer_typings`) и таймер 60 с перезапрашивают статус без очистки', async() => {
    vi.useFakeTimers()
    setPeerStatus.mockClear()
    peerSignal[1]({ _: 'channel', id: 7, pFlags: { megagroup: true }, participants_count: 42 })
    const info = document.createElement('div')
    mount({ peerId: -7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })
    await vi.advanceTimersByTimeAsync(0)
    expect(setPeerStatus).toHaveBeenCalledTimes(1)

    setStoreState({ typing: { [-7]: { 5: { action: { _: 'sendMessageTypingAction' }, at: Date.now() } } } })
    await vi.advanceTimersByTimeAsync(0)
    expect(setPeerStatus).toHaveBeenCalledTimes(2)
    expect(setPeerStatus.mock.calls[1][0].needClear).toBe(false)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(setPeerStatus).toHaveBeenCalledTimes(3)
  })
})

// Служебный «Telegram» (777000) и боты — не люди: подпись решает КАРТОЧКА
// (`getUserStatusString` получает пира, а не только присутствие), typing им не
// показывают (tweb appImManager.getUserStatus :3725 `!bot && !support`).
describe('Subtitle: служебный аккаунт и бот', () => {
  it('подпись получает карточку пира — ветки по id/pFlags решаются по ней', () => {
    const tg = { _: 'user', id: 777000, first_name: 'Telegram', pFlags: { verified: true, support: true } }
    peerSignal[1](tg)
    mount({ peerId: 777000, scrollable: el(), setCollapsedOn: el(), avatarsInfo: el() })
    expect(getUserStatusStringSpy).toHaveBeenCalledWith(tg, undefined)
  })

  it.each([
    ['support', { support: true }],
    ['bot', { bot: true }],
  ])('typing у «%s» не показывается', (_name, pFlags) => {
    peerSignal[1]({ _: 'user', id: 7, pFlags })
    const info = document.createElement('div')
    mount({ peerId: 7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: info })
    setStoreState({ typing: { 7: { 7: { action: { _: 'sendMessageTypingAction' }, at: Date.now() } } } })
    expect(info.querySelector('.peer-typing-container')).toBeNull()
  })
})

// `PeerProfile.BotVerification` (tweb :1250-1289), ветка официальной
// верификации — строка под секцией: «This bot is verified as official…» у
// ЛЮБОГО пользователя с `pFlags.verified` (так у оригинала выглядит 777000),
// «This channel/group was verified…» у чатов.
describe('BotVerification: строка официальной верификации', () => {
  const row = (host: HTMLElement) => host.querySelector('.profile-content > .profile-bot-verification')

  it('пользователь с verified — Verified.Bot со значком из спрайта', () => {
    peerSignal[1]({ _: 'user', id: 777000, first_name: 'Telegram', pFlags: { verified: true, support: true } })
    const host = mount({ peerId: 777000, scrollable: el(), setCollapsedOn: el(), avatarsInfo: el() })
    const r = row(host)
    expect(r).not.toBeNull()
    expect(r!.querySelector('.verified-icon > svg.verified-icon-svg use[href="#verified-icon-background"]')).not.toBeNull()
    expect(r!.querySelector('.profile-bot-verification-content')!.textContent).toBe('This bot is verified as official by the representatives of Telegram.')
  })

  it('канал с verified — Verified.Channel, группа — Verified.Group', () => {
    peerSignal[1]({ _: 'channel', id: 5, title: 'C', pFlags: { verified: true, broadcast: true } })
    let host = mount({ peerId: -5, scrollable: el(), setCollapsedOn: el(), avatarsInfo: el() })
    expect(row(host)!.textContent).toBe('This channel was verified by Telegram.')
    dispose!(); dispose = undefined

    peerSignal[1]({ _: 'channel', id: 6, title: 'G', pFlags: { verified: true, megagroup: true } })
    host = mount({ peerId: -6, scrollable: el(), setCollapsedOn: el(), avatarsInfo: el() })
    expect(row(host)!.textContent).toBe('This group was verified by Telegram.')
  })

  it('без verified строки нет', () => {
    peerSignal[1]({ _: 'user', id: 7, first_name: 'Alice' })
    const host = mount({ peerId: 7, scrollable: el(), setCollapsedOn: el(), avatarsInfo: el() })
    expect(row(host)).toBeNull()
  })
})
