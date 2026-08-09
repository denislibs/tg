// animationIntersector — единый «кто сейчас играет» (порт tweb
// components/animationIntersector.ts). IntersectionObserver в happy-dom нет,
// поэтому подменяем его заглушкой и дёргаем колбэк руками.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'

const observed = new Set<Element>()
let ioCallback: ((entries: IntersectionObserverEntry[]) => void) | undefined

class IntersectionObserverStub {
  constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
    ioCallback = cb
  }
  observe(el: Element) { observed.add(el) }
  unobserve(el: Element) { observed.delete(el) }
  disconnect() { observed.clear() }
}

vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

const { default: animationIntersector } = await import('./animationIntersector')
const { dispatchHeavyAnimationEvent, interruptHeavyAnimation } = await import('../core/dom/heavyAnimation')

type FakePlayer = {
  paused: boolean
  autoplay: boolean
  loop: boolean | number
  _autoplay?: boolean
  _loop?: boolean | number
  remove: Mock<() => void>
  pause: Mock<() => void>
  play: Mock<() => void>
  clearCacheWhenSafe: Mock<() => void>
  onPlaybackParamsMutated?: Mock<() => void>
}

function makePlayer(): FakePlayer {
  const player: FakePlayer = {
    paused: true,
    autoplay: true,
    loop: true,
    _autoplay: true,
    _loop: true,
    remove: vi.fn(),
    pause: vi.fn(() => { player.paused = true }),
    play: vi.fn(() => { player.paused = false }),
    clearCacheWhenSafe: vi.fn(),
    onPlaybackParamsMutated: vi.fn(),
  }
  return player
}

function makeElement() {
  const el = document.createElement('div')
  document.body.append(el)
  return el
}

function intersect(el: Element, isIntersecting: boolean) {
  ioCallback?.([{ target: el, isIntersecting } as IntersectionObserverEntry])
}

let players: FakePlayer[] = []

function register(group: 'chat' | 'emoticons-dropdown' = 'chat') {
  const el = makeElement()
  const animation = makePlayer()
  players.push(animation)
  animationIntersector.addAnimation({ animation, group, observeElement: el, type: 'lottie' })
  return { el, animation }
}

beforeEach(() => {
  players = []
  interruptHeavyAnimation()
})

afterEach(() => {
  players.forEach((p) => animationIntersector.removeAnimationByPlayer(p))
  document.body.innerHTML = ''
})

describe('animationIntersector', () => {
  it('регистрирует элемент в наблюдателе и играет его, только пока он виден', () => {
    const { el, animation } = register()
    expect(observed.has(el)).toBe(true)

    intersect(el, true)
    expect(animation.play).toHaveBeenCalledTimes(1)
    expect(animation.paused).toBe(false)
    expect(animationIntersector.isVisible(animation)).toBe(true)

    intersect(el, false)
    expect(animation.pause).toHaveBeenCalledTimes(1)
    expect(animationIntersector.isVisible(animation)).toBe(false)
    // lottie за кадром отдаёт кэш кадров (tweb animationIntersector.ts:96)
    expect(animation.clearCacheWhenSafe).toHaveBeenCalledTimes(1)
  })

  it('group "none" не регистрируется вовсе', () => {
    const el = makeElement()
    const animation = makePlayer()
    animationIntersector.addAnimation({ animation, group: 'none', observeElement: el, type: 'lottie' })
    expect(observed.has(el)).toBe(false)
    expect(animationIntersector.getAnimations(el)).toHaveLength(0)
  })

  it('без autoplay не играет даже в кадре', () => {
    const el = makeElement()
    const animation = makePlayer()
    animation.autoplay = false
    players.push(animation)
    animationIntersector.addAnimation({ animation, group: 'chat', observeElement: el, type: 'lottie' })
    intersect(el, true)
    expect(animation.play).not.toHaveBeenCalled()
  })

  it('onlyOnePlayableGroup глушит все группы, кроме выбранной', () => {
    const a = register('chat')
    const b = register('emoticons-dropdown')
    intersect(a.el, true)
    intersect(b.el, true)
    expect(a.animation.paused).toBe(false)
    expect(b.animation.paused).toBe(false)

    animationIntersector.setOnlyOnePlayableGroup('emoticons-dropdown')
    animationIntersector.checkAnimations2()
    expect(a.animation.paused).toBe(true)
    expect(b.animation.paused).toBe(false)

    animationIntersector.setOnlyOnePlayableGroup()
    animationIntersector.checkAnimations2(false)
    expect(a.animation.paused).toBe(false)
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('')
  })

  it('тяжёлая анимация ставит всё на паузу и отпускает по её концу', async () => {
    const { el, animation } = register()
    intersect(el, true)
    expect(animation.paused).toBe(false)

    let finish!: () => void
    const promise = dispatchHeavyAnimationEvent(new Promise<void>((r) => { finish = r }))
    expect(animation.paused).toBe(true)
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('lock')

    finish()
    await promise
    expect(animation.paused).toBe(false)
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('')
  })

  it('вкладка ушла в фон — пауза, вернулась — играем', () => {
    const { el, animation } = register()
    intersect(el, true)
    expect(animation.paused).toBe(false)

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(animation.paused).toBe(true)

    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(animation.paused).toBe(false)
    hidden.mockRestore()
  })

  it('элемент выпал из DOM — анимация снимается и уничтожается', () => {
    const { el, animation } = register()
    intersect(el, true)
    el.remove()

    animationIntersector.checkAnimations2()
    expect(animation.remove).toHaveBeenCalledTimes(1)
    expect(observed.has(el)).toBe(false)
    expect(animationIntersector.getAnimations(el)).toHaveLength(0)
  })

  it('заблокированная группа переживает выпадение из DOM (lock/unlock)', () => {
    const { el, animation } = register()
    intersect(el, true)
    animationIntersector.lockGroup('chat')
    el.remove()

    animationIntersector.checkAnimations2()
    expect(animation.remove).not.toHaveBeenCalled()

    animationIntersector.unlockGroup('chat')
    expect(animation.remove).toHaveBeenCalledTimes(1)
  })

  it('locked-элемент не трогается вовсе', () => {
    const el = makeElement()
    const animation = makePlayer()
    players.push(animation)
    animationIntersector.addAnimation({ animation, group: 'chat', observeElement: el, type: 'video', locked: true })
    intersect(el, true)
    expect(animation.play).not.toHaveBeenCalled()

    animationIntersector.toggleItemLock(animationIntersector.getAnimations(el)[0], false)
    animationIntersector.checkAnimations2(false)
    expect(animation.play).toHaveBeenCalledTimes(1)
  })

  it('setLoop переписывает loop у зарегистрированных плееров', () => {
    const { animation } = register()
    expect(animationIntersector.setLoop(false)).toBe(true)
    expect(animation.loop).toBe(false)
    expect(animation.onPlaybackParamsMutated).toHaveBeenCalled()
    // второй раз менять нечего
    expect(animationIntersector.setLoop(false)).toBe(false)
  })

  it('setAutoplay работает по ключу lite-mode', () => {
    const el = makeElement()
    const animation = makePlayer()
    players.push(animation)
    animationIntersector.addAnimation({
      animation, group: 'chat', observeElement: el, type: 'lottie', liteModeKey: 'stickers_chat',
    })

    expect(animationIntersector.setAutoplay(false, 'stickers_panel')).toBe(false)
    expect(animationIntersector.setAutoplay(false, 'stickers_chat')).toBe(true)
    expect(animation.autoplay).toBe(false)
  })

  it('video не уничтожается при снятии (его владелец — DOM/React)', () => {
    const el = makeElement()
    const animation = makePlayer()
    animationIntersector.addAnimation({ animation, group: 'chat', observeElement: el, type: 'video' })
    animationIntersector.removeAnimationByPlayer(animation)
    expect(animation.remove).not.toHaveBeenCalled()
    expect(observed.has(el)).toBe(false)
  })
})
