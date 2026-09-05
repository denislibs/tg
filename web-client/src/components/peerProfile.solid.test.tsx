/** @jsxImportSource solid-js */
/**
 * Тесты каркаса `peerProfile.solid.tsx` (Task 2, план
 * `docs/superpowers/plans/2026-09-05-profile-card-solid.md`).
 *
 * `stores/peers.solid`/`stores/fullPeers.solid` замоканы: у них уже есть свои
 * тесты (Task 1) — здесь предмет ДРУГОЙ (контекст + корень + шов), поэтому
 * мокаем store-слой и проверяем, что компонент читает/прокидывает то, что
 * store вернул, а не пересчитывает его сам.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { createSignal, createRoot } from 'solid-js'

const peerSignal = createSignal<unknown>(undefined)
const fullPeerSignal = createSignal<unknown>(undefined)
const usePeerSpy = vi.fn((idOrGetter: unknown) => {
  // Ветка createMemoOrReturn: аксессор → Accessor. Компонент зовёт usePeer
  // только аксессором (см. докблок файла — «peer/fullPeer — Accessor»),
  // поэтому мок просто возвращает читающий сигнал аксессор целиком.
  void idOrGetter
  return peerSignal[0]
})
const useFullPeerSpy = vi.fn((_peerId: unknown) => fullPeerSignal[0])

vi.mock('../stores/peers.solid', () => ({ usePeer: (id: unknown) => usePeerSpy(id) }))
vi.mock('../stores/fullPeers.solid', () => ({ useFullPeer: (id: unknown) => useFullPeerSpy(id) }))

let meId: number | null = 100
vi.mock('../stores/chatsStore', () => ({
  useChatsStore: { getState: () => ({ meId }) },
}))

const { default: PeerProfile, createPeerProfileContextValue, usePeerProfileContext } = await import('./peerProfile.solid')

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function mount(component: () => unknown) {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(component as () => never, host)
  return host
}

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
  meId = 100
  peerSignal[1](undefined)
  fullPeerSignal[1](undefined)
  usePeerSpy.mockClear()
  useFullPeerSpy.mockClear()
})

const el = () => document.createElement('div')

describe('PeerProfile: корень .profile-content', () => {
  it('создаёт .profile-content с delimiter\'ом и searchSuperContainer ПОСЛЕДНИМ ребёнком', () => {
    const searchSuperContainer = document.createElement('div')
    searchSuperContainer.className = 'search-super'

    const h = mount(() => (
      <PeerProfile peerId={7} scrollable={el()} setCollapsedOn={el()} searchSuperContainer={searchSuperContainer} />
    ))

    const root = h.querySelector('.profile-content')
    expect(root).not.toBeNull()
    expect(root!.children).toHaveLength(2)
    expect(root!.children[0].className).toBe('profile-content-delimiter')
    expect(root!.lastElementChild).toBe(searchSuperContainer)
  })

  it('без searchSuperContainer рисует только delimiter — узел не выдуман', () => {
    const h = mount(() => <PeerProfile peerId={7} scrollable={el()} setCollapsedOn={el()} />)
    const root = h.querySelector('.profile-content')!
    expect(root.children).toHaveLength(1)
  })

  it('is-me: пир — сам зритель (peerId === meId)', () => {
    meId = 42
    const h = mount(() => <PeerProfile peerId={42} scrollable={el()} setCollapsedOn={el()} />)
    expect(h.querySelector('.profile-content')!.classList.contains('is-me')).toBe(true)
  })

  it('чужой пир — без is-me', () => {
    meId = 42
    const h = mount(() => <PeerProfile peerId={7} scrollable={el()} setCollapsedOn={el()} />)
    expect(h.querySelector('.profile-content')!.classList.contains('is-me')).toBe(false)
  })

  it('после dispose узлов Solid не остаётся', () => {
    const h = mount(() => <PeerProfile peerId={7} scrollable={el()} setCollapsedOn={el()} />)
    expect(h.childNodes.length).toBeGreaterThan(0)
    dispose!()
    expect(h.innerHTML).toBe('')
    dispose = undefined
  })
})

describe('createPeerProfileContextValue: поля контекста', () => {
  function build(props: Parameters<typeof PeerProfile>[0]) {
    let captured!: ReturnType<typeof createPeerProfileContextValue>
    let disposeRoot!: () => void
    createRoot((d) => {
      disposeRoot = d
      captured = createPeerProfileContextValue(props)
    })
    return { ctx: captured, disposeRoot }
  }

  it('peer/fullPeer читают ТЕКУЩЕЕ значение стора (живые геттеры, не снимок)', () => {
    const { ctx, disposeRoot } = build({ peerId: 7, scrollable: el(), setCollapsedOn: el() })
    expect(ctx.peer).toBeUndefined()
    peerSignal[1]({ _: 'user', id: 7 })
    expect(ctx.peer).toEqual({ _: 'user', id: 7 })

    expect(ctx.fullPeer).toBeUndefined()
    fullPeerSignal[1]({ _: 'userFull', id: 7 })
    expect(ctx.fullPeer).toEqual({ _: 'userFull', id: 7 })
    disposeRoot()
  })

  it('usePeer вызван АКСЕССОРОМ (не голым peerId) — иначе peer навсегда застыл бы снимком', () => {
    const { disposeRoot } = build({ peerId: 7, scrollable: el(), setCollapsedOn: el() })
    expect(usePeerSpy).toHaveBeenCalledTimes(1)
    expect(typeof usePeerSpy.mock.calls[0][0]).toBe('function')
    expect((usePeerSpy.mock.calls[0][0] as () => unknown)()).toBe(7)
    disposeRoot()
  })

  it('canBeDetailed: false для своего диалога (peerId === meId && isDialog), иначе true', () => {
    meId = 42
    const own = build({ peerId: 42, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(own.ctx.canBeDetailed()).toBe(false)
    own.disposeRoot()

    const other = build({ peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() })
    expect(other.ctx.canBeDetailed()).toBe(true)
    other.disposeRoot()

    const ownNotDialog = build({ peerId: 42, isDialog: false, scrollable: el(), setCollapsedOn: el() })
    expect(ownNotDialog.ctx.canBeDetailed()).toBe(true)
    ownNotDialog.disposeRoot()
  })

  it('isSavedDialog: свой peerId + threadId — истина; без threadId или чужой peerId — ложь', () => {
    meId = 42
    expect(build({ peerId: 42, threadId: 5, scrollable: el(), setCollapsedOn: el() }).ctx.isSavedDialog).toBe(true)
    expect(build({ peerId: 42, scrollable: el(), setCollapsedOn: el() }).ctx.isSavedDialog).toBe(false)
    expect(build({ peerId: 7, threadId: 5, scrollable: el(), setCollapsedOn: el() }).ctx.isSavedDialog).toBe(false)
  })

  it('isTopic: threadId + Chat.channel.pFlags.forum — истина', () => {
    const { ctx, disposeRoot } = build({ peerId: -7, threadId: 3, scrollable: el(), setCollapsedOn: el() })
    expect(ctx.isTopic).toBe(false)
    peerSignal[1]({ _: 'channel', id: 7, pFlags: { forum: true } })
    expect(ctx.isTopic).toBe(true)
    disposeRoot()
  })

  it('isTopic: без threadId — ложь даже у форум-канала', () => {
    const { ctx, disposeRoot } = build({ peerId: -7, scrollable: el(), setCollapsedOn: el() })
    peerSignal[1]({ _: 'channel', id: 7, pFlags: { forum: true } })
    expect(ctx.isTopic).toBe(false)
    disposeRoot()
  })

  it('scrollable/setCollapsedOn/peerId/threadId/isDialog прокинуты как есть', () => {
    const scrollable = el()
    const setCollapsedOn = el()
    const { ctx, disposeRoot } = build({ peerId: 9, threadId: 3, isDialog: true, scrollable, setCollapsedOn })
    expect(ctx.peerId).toBe(9)
    expect(ctx.threadId).toBe(3)
    expect(ctx.isDialog).toBe(true)
    expect(ctx.scrollable).toBe(scrollable)
    expect(ctx.setCollapsedOn).toBe(setCollapsedOn)
    disposeRoot()
  })
})

describe('usePeerProfileContext: гвард без провайдера', () => {
  it('бросает, а не тихо отдаёт undefined — секции задач 3-5 не должны молча увидеть пустой контекст', () => {
    expect(() =>
      mount(() => {
        usePeerProfileContext()
        return null
      }),
    ).toThrow(/PeerProfileContext.Provider/)
  })
})
