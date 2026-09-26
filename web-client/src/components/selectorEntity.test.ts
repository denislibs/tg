// Чип `.selector-user` — ванильный `renderEntity` (порт tweb
// `components/selectorSearch.ts:321-404`), строительный блок чипов пира и даты
// глобального поиска.
//
// Пины — на узлы:
//   (1) пир: `div.selector-user.selector-user-primary[data-key]`, дети в
//       порядке оригинала — контейнер аватара (аватар 30 + крестик), затем
//       заголовок с именем из зеркала карточек;
//   (2) дата: ключ `date_<min>_<max>` пиром не считается — вместо инициалов
//       иконка `calendarfilter`, зеркало не спрашивается, заголовок — строкой;
//   (3) «Избранное»: свой пир с `meAsSaved` (по умолчанию) — иконка `saved` и
//       «Saved Messages», без него — имя;
//   (4) middleware: погашенный вызывающим scope больше не перерисовывает ни
//       аватар, ни имя (у оригинала — `helperMiddlewareHelper.clean()` на
//       каждый новый запрос, sidebarLeft/index.ts:1349);
//   (5) `promises` ждут готовности аватара пира; у даты ждать нечего.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import rootScope from '@lib/rootScope'

import { renderEntity } from './selectorEntity'

vi.mock('@core/media/ensureMediaUrl', () => ({ ensureMediaUrl: vi.fn(() => new Promise(() => {})) }))

const ALICE = 5
const GHOST = 6
const DATE_KEY = 'date_1758834000000_1758920399999'

let helper: MiddlewareHelper
let fillMirror: ReturnType<typeof vi.fn<(ids: number[]) => Promise<void>>>

beforeEach(() => {
  resetPeerMirror()
  helper = getMiddleware()
  fillMirror = vi.fn(async () => {})
  rootScope.myId = 0
})

afterEach(() => {
  helper.destroy()
  rootScope.myId = 0
})

const render = (key: PeerId | string, extra: { title?: string, primary?: boolean, meAsSaved?: boolean } = {}) =>
  renderEntity({
    key,
    middleware: helper.get(),
    managers: { peers: { fillMirror } },
    avatarSize: 30,
    fallbackIcon: 'calendarfilter',
    primary: true,
    ...extra,
  })

const upsertUser = (id: number, first_name: string) =>
  applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id, first_name, pFlags: {} }] }])

describe('renderEntity — чип пира', () => {
  it('разметка оригинала: чип, контейнер аватара с крестиком, заголовок с именем', () => {
    upsertUser(ALICE, 'Alice')
    const { element } = render(ALICE)

    expect(element.matches('div.selector-user.selector-user-primary')).toBe(true)
    expect(element.dataset.key).toBe('5')
    expect(Array.from(element.children).map((c) => c.className)).toEqual([
      'selector-user-avatar-container',
      'selector-user-title',
    ])

    const container = element.firstElementChild!
    const avatar = container.children[0] as HTMLElement
    expect(avatar.classList.contains('selector-user-avatar')).toBe(true)
    expect(avatar.classList.contains('avatar-30')).toBe(true)
    expect(avatar.dataset.peerId).toBe('5')
    expect(avatar.textContent).toBe('A')
    expect(container.children[1]!.className).toBe('selector-user-avatar-close')
    expect(container.children[1]!.querySelector('.tgico')).not.toBeNull()

    const title = element.querySelector('.selector-user-title > .peer-title')!
    expect(title.textContent).toBe('Alice')
    expect(element.querySelector('.avatar-icon-calendarfilter')).toBeNull()
  })

  it('ключ пира строкой — тоже пир', () => {
    upsertUser(ALICE, 'Alice')
    const { element } = render('5')

    expect(element.querySelector<HTMLElement>('.selector-user-avatar')!.dataset.peerId).toBe('5')
    expect(element.querySelector('.peer-title')!.textContent).toBe('Alice')
  })

  it('без `primary` — без `selector-user-primary`', () => {
    upsertUser(ALICE, 'Alice')
    expect(render(ALICE, { primary: false }).element.classList.contains('selector-user-primary')).toBe(false)
  })

  it('свой пир — «Избранное» (иконка `saved`), с `meAsSaved: false` — имя', () => {
    upsertUser(ALICE, 'Alice')
    rootScope.myId = ALICE

    const saved = render(ALICE).element
    expect(saved.querySelector('.selector-user-avatar .avatar-icon-saved')).not.toBeNull()
    expect(saved.querySelector('.peer-title')!.textContent).toBe('Saved Messages')

    const plain = render(ALICE, { meAsSaved: false }).element
    expect(plain.querySelector('.avatar-icon-saved')).toBeNull()
    expect(plain.querySelector('.peer-title')!.textContent).toBe('Alice')
  })

  it('`promises` ждут готовности аватара', () => {
    upsertUser(ALICE, 'Alice')
    const { promises, avatar } = render(ALICE)
    expect(promises).toEqual([avatar.readyThumbPromise])
  })
})

describe('renderEntity — чип даты', () => {
  it('иконка `calendarfilter` вместо аватара пира, заголовок строкой, зеркало не спрошено', () => {
    const { element, promises } = render(DATE_KEY, { title: 'Today' })

    expect(element.matches('div.selector-user.selector-user-primary')).toBe(true)
    expect(element.dataset.key).toBe(DATE_KEY)
    const avatar = element.querySelector<HTMLElement>('.selector-user-avatar')!
    expect(avatar.dataset.peerId).toBeUndefined()
    expect(avatar.querySelector('.avatar-icon.avatar-icon-calendarfilter')).not.toBeNull()
    expect(element.querySelector('.selector-user-title')!.textContent).toBe('Today')
    expect(element.querySelector('.peer-title')).toBeNull()
    expect(fillMirror).not.toHaveBeenCalled()
    expect(promises).toEqual([])
  })
})

describe('renderEntity — middleware', () => {
  it('живой scope: карточка приехала — чип перерисован', () => {
    const { element } = render(GHOST)
    expect(fillMirror).toHaveBeenCalledWith([GHOST])

    upsertUser(GHOST, 'Гость')

    expect(element.querySelector('.peer-title')!.textContent).toBe('Гость')
    expect(element.querySelector('.selector-user-avatar')!.textContent).toBe('Г')
  })

  it('погашенный scope: чип больше не перерисовывается', () => {
    const { element } = render(GHOST)
    const before = {
      title: element.querySelector('.peer-title')!.textContent,
      avatar: element.querySelector('.selector-user-avatar')!.textContent,
    }

    helper.clean()
    upsertUser(GHOST, 'Гость')

    expect(element.querySelector('.peer-title')!.textContent).toBe(before.title)
    expect(element.querySelector('.selector-user-avatar')!.textContent).toBe(before.avatar)
  })

  // Владелец поиска снимает чип `target.middlewareHelper.destroy()`
  // (sidebarLeft/index.ts:1276): гаснуть обязаны И имя, И аватар.
  it('чип несёт свой `middlewareHelper` — его destroy гасит имя и аватар', () => {
    const { element } = render(GHOST)
    expect(element.middlewareHelper).toBeDefined()

    element.middlewareHelper!.destroy()
    upsertUser(GHOST, 'Гость')

    expect(element.querySelector('.peer-title')!.textContent).not.toBe('Гость')
    expect(element.querySelector('.selector-user-avatar')!.textContent).not.toBe('Г')
  })
})
