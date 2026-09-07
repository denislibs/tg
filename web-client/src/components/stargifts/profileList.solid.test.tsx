/** @jsxImportSource solid-js */
// Пины витрины подарков профиля — Solid `profileList.solid.tsx`, порт
// tweb `src/components/stargifts/profileList.tsx` (`StarGiftsProfileTab`) +
// `profileStore.ts` + `stargiftsGrid.tsx` (задача 12 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`).
//
// Предмет — РЕЗУЛЬТАТ в DOM и наружные колбэки, не форма вызова менеджера:
// сетка плиток, метка скрытого подарка, бейдж ограниченного, отправитель
// (аватар / аноним), пустое состояние, прелоадер до ответа, счётчик наружу и
// стор/действия, которые класс `AppSearchSuper` читает через `ref`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSolid } from '@shared/solid/mountSolid.solid'
import type { SavedStarGift } from '@core/managers/starsManager'
import gridStyles from './stargiftsGrid.module.scss'
import listStyles from './profileList.module.scss'
import { StarGiftsProfileTab, type StarGiftsProfileTabProps, type StarGiftsProfileTabRef } from './profileList.solid'

// `avatarNew` даёт пробел зеркала через переданные `managers`, а сам
// `client/bootstrap` в графе теста тянул бы воркер (`Worker` в happy-dom нет).
vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { peers: { fillMirror: async () => {} } } }),
}))

const PEER: PeerId = 1
type TabManagers = StarGiftsProfileTabProps['managers']

function gift(i: number, extra: Partial<SavedStarGift> = {}, giftExtra: Partial<SavedStarGift['gift']> = {}): SavedStarGift {
  return {
    _: 'savedStarGift',
    date: 1786968000 + i,
    saved_id: i + 1,
    from_id: { _: 'peerUser', user_id: 100 + i },
    gift: { _: 'starGift', id: 10 + i, emoji: '🎁', stars: 50, convert_stars: 25, ...giftExtra },
    ...extra,
  }
}

const gifts = (n: number) => Array.from({ length: n }, (_, i) => gift(i))

function fakeManagers(list: SavedStarGift[] | Promise<SavedStarGift[]>) {
  let calls = 0
  const managers = {
    stars: { profileGifts: async () => { calls++; return list } },
    peers: { fillMirror: async () => {} },
  } as unknown as TabManagers
  return { managers, calls: () => calls }
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

function render(props: Partial<StarGiftsProfileTabProps> & { managers: TabManagers }) {
  const r = mountSolid(host, StarGiftsProfileTab, { peerId: PEER, ...props })
  dispose = r.dispose
  return r
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const items = () => Array.from(host.querySelectorAll<HTMLElement>(`.${gridStyles.gridItem}`))

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

describe('StarGiftsProfileTab — витрина подарков', () => {
  it('рисует сетку плиток в контейнере вкладки: по плитке на подарок', async () => {
    render(fakeManagers(gifts(5)))
    await settle()

    expect(host.querySelector(`.${listStyles.tab}`)).not.toBe(null)
    const grid = host.querySelector(`.${gridStyles.grid}`)!
    expect(grid.classList.contains(listStyles.grid)).toBe(true)
    expect(items()).toHaveLength(5)
    // вид `profile` — класс на ПЛИТКЕ (`stargiftsGrid.tsx:186-195`), не на сетке
    expect(items().every((el) => el.classList.contains(gridStyles.viewProfile))).toBe(true)
  })

  it('внешность подарка — его символ в слоте стикера (стикера-документа в модели нет)', async () => {
    render(fakeManagers([gift(0, {}, { emoji: '🧸' })]))
    await settle()

    expect(items()[0].querySelector(`.${gridStyles.itemSticker}`)?.textContent).toBe('🧸')
  })

  it('скрытый подарок (unsaved) помечен иконкой itemUnsaved, видимый — нет', async () => {
    render(fakeManagers([gift(0, { pFlags: { unsaved: true } }), gift(1)]))
    await settle()

    const [hidden, shown] = items()
    expect(hidden.querySelector(`.${gridStyles.itemUnsaved}`)).not.toBe(null)
    expect(shown.querySelector(`.${gridStyles.itemUnsaved}`)).toBe(null)
  })

  it('ограниченный подарок несёт бейдж «1 of N», безлимитный — без бейджа', async () => {
    render(fakeManagers([gift(0, {}, { availability_total: 5000, availability_remains: 3, pFlags: { limited: true } }), gift(1)]))
    await settle()

    const [limited, unlimited] = items()
    // `formatNumber(5000, 1)` → «5K» (`tweb stargiftsGrid.tsx:336`).
    expect(limited.textContent).toContain('1 of 5K')
    expect(unlimited.textContent).not.toContain(' of ')
  })

  it('отправитель: аватар дарителя по from_id, аноним (name_hidden / без from_id) — кружок без лица', async () => {
    render(fakeManagers([
      gift(0),
      gift(1, { pFlags: { name_hidden: true } }),
      gift(2, { from_id: undefined }),
    ]))
    await settle()

    const [named, hiddenName, noFrom] = items()
    expect(named.querySelector(`.${gridStyles.itemFrom} .avatar`)?.getAttribute('data-peer-id')).toBe('100')
    expect(named.querySelector(`.${gridStyles.itemFromAnonymous}`)).toBe(null)
    expect(hiddenName.querySelector(`.${gridStyles.itemFromAnonymous}`)).not.toBe(null)
    expect(noFrom.querySelector(`.${gridStyles.itemFromAnonymous}`)).not.toBe(null)
  })

  it('пустое состояние: подпись «No matching gifts.» вместо сетки', async () => {
    render(fakeManagers([]))
    await settle()

    expect(host.querySelector(`.${gridStyles.grid}`)).toBe(null)
    const empty = host.querySelector(`.${listStyles.empty}`)!
    expect(empty.querySelector(`.${listStyles.emptySubtitle}`)?.textContent).toBe('No matching gifts.')
  })

  it('до ответа — прелоадер, после — сетка', async () => {
    let resolve!: (g: SavedStarGift[]) => void
    render(fakeManagers(new Promise<SavedStarGift[]>((r) => { resolve = r })))

    expect(host.querySelector('.preloader')).not.toBe(null)
    expect(items()).toHaveLength(0)

    resolve(gifts(2))
    await settle()

    expect(host.querySelector('.preloader')).toBe(null)
    expect(items()).toHaveLength(2)
  })

  it('счётчик уходит наружу размером набора; повторный loadNext после loaded в сеть не идёт', async () => {
    const onCountChange = vi.fn()
    let api!: StarGiftsProfileTabRef
    const fake = fakeManagers(gifts(4))
    render({ ...fake, onCountChange, ref: (r) => { api = r } })
    await settle()

    expect(onCountChange).toHaveBeenCalledWith(4)
    expect(api.store.loaded).toBe(true)
    expect(api.store.loading).toBe(false)
    expect(api.store.items).toHaveLength(4)

    await api.actions.loadNext()
    expect(fake.calls()).toBe(1)
  })

  it('dispose снимает витрину целиком', async () => {
    render(fakeManagers(gifts(3)))
    await settle()
    expect(items()).toHaveLength(3)

    dispose!()
    dispose = undefined

    expect(host.innerHTML).toBe('')
  })
})
