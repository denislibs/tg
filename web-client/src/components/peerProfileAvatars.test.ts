// Каркас `PeerProfileAvatars` (`components/peerProfileAvatars.ts`, порт tweb
// `components/peerProfileAvatars.ts`) — задача 1 из шести
// (`docs/superpowers/plans/2026-09-05-profile-avatars-class.md`).
//
// Пины этого файла — только каркас, норма проводки из брифа задачи 1:
//   (1) DOM конструктора — контейнер и порядок детей 1:1 с оригиналом (tweb
//       :81-109);
//   (2) `addTab()` добавляет `.profile-avatars-tab` в `-tabs` (:795-805);
//   (3) `setCollapsed(true/false)` вешает/снимает `is-collapsed` на переданный
//       `setCollapsedOn`, а НЕ на собственный `container` (:929-944);
//   (4) `need-white` и вызов `onNeedWhiteChanged` — только на изменение
//       значения (:936-941);
//   (5) `header-filled` — оба порога (5px свёрнуто/без фона, 200px всегда) и
//       снятие класса при возврате к началу (:949-955);
//   (6) `cleanup()` — слушатели `listenerSetter` реально сняты (событие после
//       cleanup ничего не меняет) и подписка топик-аватара на зеркало пиров
//       гасится вместе с `middlewareHelper` (:957-973).
// Плюс ветка топика `setPeer` (:396-400), которую эта задача рисует целиком
// (см. докблок `peerProfileAvatars.ts`).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { AvatarManagers } from '@components/avatar'
import PeerProfileAvatars from './peerProfileAvatars'

const ALICE = 501
const GHOST = 502

const managers: AvatarManagers = { peers: { fillMirror: vi.fn(async () => {}) } }

function make() {
  const setCollapsedOn = document.createElement('div')
  const scrollableEl = document.createElement('div')
  const instance = new PeerProfileAvatars({ managers, setCollapsedOn, scrollableEl })
  return { instance, setCollapsedOn, scrollableEl }
}

beforeEach(() => {
  resetPeerMirror()
  vi.clearAllMocks()
})

describe('PeerProfileAvatars — DOM конструктора', () => {
  it('контейнер и порядок детей — 1:1 с оригиналом (tweb :81-109)', () => {
    const { instance } = make()

    expect(instance.container.classList.contains('profile-avatars-container')).toBe(true)

    const classNames = Array.from(instance.container.children).map((el) => el.className)
    expect(classNames).toEqual([
      'profile-avatars-avatars',
      'profile-avatars-gradient',
      'profile-avatars-gradient profile-avatars-gradient-top',
      'profile-avatars-tabs',
      'profile-avatars-arrow',
      'profile-avatars-arrow profile-avatars-arrow-next',
      'profile-avatars-info',
    ])
  })

  it('public container/info — те же узлы, что стоят в дереве', () => {
    const { instance } = make()
    expect(instance.container.contains(instance.info)).toBe(true)
  })
})

describe('PeerProfileAvatars.addTab()', () => {
  it('добавляет .profile-avatars-tab в -tabs, первая — active', () => {
    const { instance } = make()
    const tabsEl = instance.container.querySelector('.profile-avatars-tabs')!

    instance.addTab()
    expect(tabsEl.children.length).toBe(1)
    expect(tabsEl.children[0].classList.contains('profile-avatars-tab')).toBe(true)
    expect(tabsEl.children[0].classList.contains('active')).toBe(true)
    expect(instance.container.classList.contains('is-single')).toBe(true)

    instance.addTab()
    expect(tabsEl.children.length).toBe(2)
    // Вторая вкладка НЕ активна — active достаётся только первой.
    expect(tabsEl.children[1].classList.contains('active')).toBe(false)
    expect(instance.container.classList.contains('is-single')).toBe(false)
  })
})

describe('PeerProfileAvatars.setCollapsed()', () => {
  it('вешает/снимает is-collapsed НА setCollapsedOn, а не на свой container', () => {
    const { instance, setCollapsedOn } = make()

    ;(instance as any).setCollapsed(true)
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(true)
    expect(instance.container.classList.contains('is-collapsed')).toBe(false)

    ;(instance as any).setCollapsed(false)
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(false)
  })

  it('isCollapsed() читает тот же setCollapsedOn', () => {
    const { instance, setCollapsedOn } = make()
    ;(instance as any).setCollapsed(true)
    expect((instance as any).isCollapsed()).toBe(true)
    setCollapsedOn.classList.remove('is-collapsed')
    expect((instance as any).isCollapsed()).toBe(false)
  })

  it('need-white: hasBackgroundColor у нас всегда false, поэтому need-white === !collapsed', () => {
    const { instance, setCollapsedOn } = make()

    ;(instance as any).setCollapsed(true)
    expect(setCollapsedOn.classList.contains('need-white')).toBe(false)

    ;(instance as any).setCollapsed(false)
    expect(setCollapsedOn.classList.contains('need-white')).toBe(true)
  })

  it('onNeedWhiteChanged зовётся ТОЛЬКО когда need-white реально меняется', () => {
    const { instance } = make()
    const onNeedWhiteChanged = vi.fn()
    instance.onNeedWhiteChanged = onNeedWhiteChanged

    ;(instance as any).setCollapsed(true) // need-white: false — было false по умолчанию, не меняется
    expect(onNeedWhiteChanged).not.toHaveBeenCalled()

    ;(instance as any).setCollapsed(false) // need-white: true — изменилось
    expect(onNeedWhiteChanged).toHaveBeenCalledTimes(1)
    expect(onNeedWhiteChanged).toHaveBeenCalledWith(true)

    ;(instance as any).setCollapsed(false) // повторный тот же collapsed — значение не меняется
    expect(onNeedWhiteChanged).toHaveBeenCalledTimes(1)
  })
})

describe('PeerProfileAvatars — header-filled (tweb :949-955)', () => {
  it('порог 5px — только когда свёрнуто и без цветного фона (у нас фона нет никогда)', () => {
    const { instance, setCollapsedOn, scrollableEl } = make()
    ;(instance as any).setCollapsed(true)
    setCollapsedOn.classList.remove('header-filled') // setCollapsed уже дёрнул updateHeaderFilled на scrollTop=0

    scrollableEl.scrollTop = 4
    instance.updateHeaderFilled()
    expect(setCollapsedOn.classList.contains('header-filled')).toBe(false)

    scrollableEl.scrollTop = 5
    instance.updateHeaderFilled()
    expect(setCollapsedOn.classList.contains('header-filled')).toBe(true)

    // Возврат к началу — класс СНИМАЕТСЯ (двусторонний, а не только взводится).
    scrollableEl.scrollTop = 0
    instance.updateHeaderFilled()
    expect(setCollapsedOn.classList.contains('header-filled')).toBe(false)
  })

  it('порог 200px — взводится ДАЖЕ развёрнутым (второе условие OR)', () => {
    const { instance, setCollapsedOn, scrollableEl } = make()
    ;(instance as any).setCollapsed(false) // развёрнуто — первое условие порога 5px невозможно

    scrollableEl.scrollTop = 199
    instance.updateHeaderFilled()
    expect(setCollapsedOn.classList.contains('header-filled')).toBe(false)

    scrollableEl.scrollTop = 200
    instance.updateHeaderFilled()
    expect(setCollapsedOn.classList.contains('header-filled')).toBe(true)

    scrollableEl.scrollTop = 0
    instance.updateHeaderFilled()
    expect(setCollapsedOn.classList.contains('header-filled')).toBe(false)
  })
})

describe('PeerProfileAvatars.setPeer() — ветка топика (tweb :396-400)', () => {
  it('топик: is-topic на container и ровно один аватар в -avatars', async () => {
    const { instance } = make()
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!

    await instance.setPeer(ALICE, 7)

    expect(instance.container.classList.contains('is-topic')).toBe(true)
    expect(avatarsEl.children.length).toBe(1)
    expect(avatarsEl.children[0].classList.contains('profile-avatars-avatar')).toBe(true)
  })

  it('не топик: is-topic не ставится, -avatars остаётся пустым (лента — задача 2)', async () => {
    const { instance } = make()
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!

    await instance.setPeer(ALICE)

    expect(instance.container.classList.contains('is-topic')).toBe(false)
    expect(avatarsEl.children.length).toBe(0)
  })
})

describe('PeerProfileAvatars.cleanup() (tweb :957-973)', () => {
  it('снимает слушателей listenerSetter — событие после cleanup ничего не меняет', () => {
    const { instance } = make()
    const handler = vi.fn()
    // Листенеров в этой задаче никто не регистрирует — добавляем свой через
    // приватный listenerSetter, чтобы проверить факт снятия ФАКТИЧЕСКИМ
    // событием, а не «cleanup() был вызван».
    ;(instance as any).listenerSetter.add(instance.container)('ping', handler)

    instance.container.dispatchEvent(new Event('ping'))
    expect(handler).toHaveBeenCalledTimes(1)

    instance.cleanup()

    instance.container.dispatchEvent(new Event('ping'))
    expect(handler).toHaveBeenCalledTimes(1) // не выросло — слушатель снят
  })

  it('гасит подписку топик-аватара на зеркало пиров — узел перестаёт обновляться', async () => {
    const { instance } = make()
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!

    await instance.setPeer(GHOST, 7)
    const avatarNode = avatarsEl.children[0] as HTMLElement
    expect(avatarNode.dataset.color).toBeUndefined() // карточки ещё нет

    // Зеркало двигается ДО cleanup — узел живой, обязан перерисоваться.
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: GHOST, first_name: 'Гость', pFlags: {} }] }])
    const colorBeforeCleanup = avatarNode.dataset.color
    expect(colorBeforeCleanup).toBeDefined()

    instance.cleanup()

    // После cleanup — даже смена на «удалённый аккаунт» (меняет цвет на
    // archive, tweb :788-791) узел больше не трогает.
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: GHOST, first_name: 'Гость', pFlags: { deleted: true } }] }])
    expect(avatarNode.dataset.color).toBe(colorBeforeCleanup)
  })
})

describe('PeerProfileAvatars.goWithoutTransition()', () => {
  it('объявлен по контракту интерфейса — не бросает (наполнит задача 2)', () => {
    const { instance } = make()
    expect(() => instance.goWithoutTransition(1)).not.toThrow()
  })
})
