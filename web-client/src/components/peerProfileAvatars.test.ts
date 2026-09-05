// `PeerProfileAvatars` (`components/peerProfileAvatars.ts`, порт tweb
// `components/peerProfileAvatars.ts`) — задачи 1-2 из шести
// (`docs/superpowers/plans/2026-09-05-profile-avatars-class.md`).
//
// Пины ЗАДАЧИ 1 (каркас), норма проводки из её брифа:
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
// Плюс ветка топика `setPeer` (:396-400), которую задача 1 рисует целиком
// (см. докблок `peerProfileAvatars.ts`) — БЕЗ иконки темы форума (её у нашего
// `avatarNew` нет вовсе, долг `backlogs/frontend/profile-topic-avatar.md`).
//
// Пины ЗАДАЧИ 2 (данные и лента) — норма проводки из её брифа:
//   (7) N фото → N узлов `.profile-avatars-avatar` и N полосок;
//   (8) `goWithoutTransition` двигает `transform` и переносит `.active` на
//       аватаре И на полоске; закольцовывание — оба направления;
//   (9) смена пира сбрасывает ленту (узлов прежнего пира не остаётся);
//  (10) ответ на ПРОТУХШИЙ peerId игнорируется (гонка «переключили пира, пока
//       грузилось»);
//  (11) ленивая догрузка — элементы дальше `LOAD_NEAREST` не грузятся до
//       появления в `IntersectionObserver`;
//  (12) пустая галерея — `SHOW_NO_AVATAR`;
//  (13) `cleanup()` снимает `IntersectionObserver` и регистрацию видео в
//       `animationIntersector`.
//
// `avatarNew` не мокается целиком (нужен настоящий узел — data-peer-id,
// классы), а оборачивается шпионом: реальная реализация зовётся как есть,
// но аргументы вызова записываются — тест ниже проверяет, что `threadId` в
// них НЕ уходит (иначе будущая правка «прокину threadId» пройдёт молча, раз
// у `AvatarOptions` этого поля сегодня нет и добавить его — вопрос одной
// строки типа).
//
// `IntersectionObserver` в happy-dom нет (тот же приём, что и в
// `animationIntersector.test.ts`/`stickyIntersector.test.ts`) — подменяем
// заглушкой ДО импорта класса: конструктор создаёт наблюдатель сразу, поэтому
// импорт класса переезжает в динамический `await import`, исполняющийся ПОСЛЕ
// `vi.stubGlobal` (обычный статический import был бы поднят раньше стаба).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import animationIntersector from '@components/animationIntersector'
import * as viewerModule from '@components/mediaViewer/openMediaViewer'
import type { ProfilePhoto } from '@core/managers/profileManager'
import type { PeerProfileAvatarsManagers } from './peerProfileAvatars'

type AvatarModule = typeof import('@components/avatar')

const avatarNewSpy = vi.hoisted(() => vi.fn())
vi.mock('@components/avatar', async (importOriginal) => {
  const actual = await importOriginal<AvatarModule>()
  const avatarNew: AvatarModule['avatarNew'] = (options) => {
    avatarNewSpy(options)
    return actual.avatarNew(options)
  }
  return { ...actual, avatarNew }
})

// happy-dom шлёт `<video>` событие `canplay` СИНХРОННО внутри сеттера `src`
// (тот же факт документирует шапка `wrappers/video.test.ts`). `renderImageFromUrl`
// для видео сначала выставляет `src`, а слушатель `onMediaLoad` вешает
// ПОСЛЕ — событие успевает уйти ДО подписки, и промис виснет навсегда. В
// реальном браузере `canplay` асинхронный, гонки там нет — это баг тестового
// окружения, не прод-кода (изолированный репро с `onMediaLoad` — в отчёте
// задачи). Подменяем ветку video: назначаем `src` и резолвим сразу, как это
// и происходило бы в браузере к моменту, когда за URL реально сходили бы за
// байтами. Ветку img НЕ трогаем — она идёт через реальную реализацию (уже
// покрыта топик-тестами задачи 1, там `avatarNew`/`putAvatar` грузят картинку
// тем же путём и проходят).
vi.mock('@helpers/dom/renderImageFromUrl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@helpers/dom/renderImageFromUrl')>()
  return {
    ...actual,
    renderImageFromUrlPromise: (elem: HTMLElement, url: string, useCache?: boolean) => {
      if (elem instanceof HTMLVideoElement) {
        elem.src = url
        return Promise.resolve()
      }
      return actual.renderImageFromUrlPromise(elem, url, useCache)
    },
  }
})

// `processItem` ходит за URL исторических фото/видео через ЕДИНСТВЕННЫЕ
// ванильные точки входа (`ensureMediaUrl`/`resolveStreamUrl`, см. докблок
// `PeerProfileAvatarsManagers`), а НЕ через `managers` — обе реально бьют в
// воркер (`startClient()`), которого в юнит-тесте нет; мокаем ровно так же,
// как это уже делает `avatar.test.ts` для `putAvatar`.
const ensureMediaUrlMock = vi.hoisted(() => vi.fn(async (id: number) => `blob:media-${id}`))
const resolveStreamUrlMock = vi.hoisted(() => vi.fn((id: number) => `blob:video-${id}`))
vi.mock('@core/media/ensureMediaUrl', () => ({ ensureMediaUrl: ensureMediaUrlMock }))
vi.mock('@core/mediaUrl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/mediaUrl')>()),
  resolveStreamUrl: resolveStreamUrlMock,
}))

type IOEntry = { target: Element; isIntersecting: boolean }
let ioInstances: IntersectionObserverStub[] = []
class IntersectionObserverStub {
  cb: (entries: IOEntry[]) => void
  observed = new Set<Element>()
  constructor(cb: (entries: IOEntry[]) => void) {
    this.cb = cb
    ioInstances.push(this)
  }
  observe(el: Element) { this.observed.add(el) }
  unobserve(el: Element) { this.observed.delete(el) }
  disconnect() { this.observed.clear() }
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

// Имитация срабатывания IntersectionObserver для конкретного узла — находит
// наблюдатель(и), у которых он числится, и дёргает колбэк с isIntersecting: true.
function intersect(target: Element) {
  for (const inst of ioInstances) {
    if (inst.observed.has(target)) inst.cb([{ target, isIntersecting: true }])
  }
}

const { default: PeerProfileAvatars } = await import('./peerProfileAvatars')

const ALICE = 501
const GHOST = 502

function photo(id: number, videoMediaId?: number): ProfilePhoto {
  return { id, mediaId: id, videoMediaId, createdAt: '' }
}

function photos(n: number): ProfilePhoto[] {
  return Array.from({ length: n }, (_, i) => photo(i + 1))
}

// `AvatarManagers` (`peers.fillMirror`) достаточно для задачи 1 (топик/DOM);
// задача 2 расширяет срез `profile.listPhotos` — фейк по умолчанию пустой
// (ничего не грузит), тесты данных задачи 2 переопределяют его через
// `makeManagers`. URL картинки/видео в этот срез не входит — `processItem`
// ходит за ними напрямую через `ensureMediaUrl`/`resolveStreamUrl` (моки —
// выше), см. докблок `PeerProfileAvatarsManagers`.
function makeManagers(byUserId: Record<number, ProfilePhoto[]> = {}): PeerProfileAvatarsManagers {
  return {
    peers: { fillMirror: vi.fn(async () => {}) },
    profile: { listPhotos: vi.fn(async (userId: number) => byUserId[userId] ?? []) },
  }
}

const managers = makeManagers()

function make(mgrs: PeerProfileAvatarsManagers = managers) {
  const setCollapsedOn = document.createElement('div')
  const scrollableEl = document.createElement('div')
  const instance = new PeerProfileAvatars({ managers: mgrs, setCollapsedOn, scrollableEl })
  return { instance, setCollapsedOn, scrollableEl }
}

beforeEach(() => {
  resetPeerMirror()
  vi.clearAllMocks()
  ioInstances = []
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
  it('топик: is-topic на container и ровно один узел — АВАТАР ПИРА (не иконка темы, долг задокументирован)', async () => {
    const { instance } = make()
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!

    await instance.setPeer(ALICE, 7)

    expect(instance.container.classList.contains('is-topic')).toBe(true)
    expect(avatarsEl.children.length).toBe(1)

    const node = avatarsEl.children[0] as HTMLElement
    expect(node.classList.contains('profile-avatars-avatar')).toBe(true)
    // Содержимое — НАСТОЯЩИЙ узел avatarNew для peerId (data-peer-id + его
    // собственные классы), а не какая-то заглушка/иконка темы.
    expect(node.dataset.peerId).toBe(String(ALICE))
    expect(node.classList.contains('avatar-like')).toBe(true)

    // Пин расхождения с оригиналом: threadId в avatarNew НЕ уходит — у нашего
    // порта нет ветки render({peerId, threadId}) (tweb :836-841), которая
    // рисует иконку темы. Если это когда-нибудь изменят не выполнив долг
    // (`backlogs/frontend/profile-topic-avatar.md`) — тест покраснеет здесь.
    expect(avatarNewSpy).toHaveBeenCalledTimes(1)
    const callOptions = avatarNewSpy.mock.calls[0][0]
    expect(callOptions).toMatchObject({ peerId: ALICE, size: 120, managers })
    expect('threadId' in callOptions).toBe(false)
  })

  it('не топик: is-topic не ставится; пустая галерея — один узел-заглушка (SHOW_NO_AVATAR, задача 2)', async () => {
    const { instance } = make()
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!

    await instance.setPeer(ALICE)

    expect(instance.container.classList.contains('is-topic')).toBe(false)
    // Раньше здесь проверялась пустая лента («лента — задача 2»): задача 2
    // реализована, и SHOW_NO_AVATAR (детальный тест — ниже) рисует ОДИН
    // узел-заглушку даже без единой фотографии — как в оригинале.
    expect(avatarsEl.children.length).toBe(1)
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

describe('PeerProfileAvatars.setPeer() — лента данных (задача 2, tweb :376-521, :807-912)', () => {
  it('N фото → N узлов .profile-avatars-avatar и N полосок; первый узел и первая полоска — active', async () => {
    const mgrs = makeManagers({ [ALICE]: photos(3) })
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!
    const tabsEl = instance.container.querySelector('.profile-avatars-tabs')!

    await instance.setPeer(ALICE)

    // Элемент #0 готов синхронно (setPeer await-ит его напрямую); элементы
    // #1/#2 приходят из `void listLoader.load(true)` (round 1 ревью: setPeer
    // не блокирует байты фото, только их метаданные) — ждём фактической
    // готовности DOM, а не порядка микрозадач (тот же приём, что у теста
    // ленивой догрузки ниже).
    await vi.waitFor(() => {
      expect(avatarsEl.children.length).toBe(3)
      expect(tabsEl.children.length).toBe(3)
    })
    expect(avatarsEl.children[0].classList.contains('active')).toBe(true)
    expect(tabsEl.children[0].classList.contains('active')).toBe(true)
  })

  it('setPeer() резолвится, НЕ дожидаясь байтов фото #1 (round 1 ревью: void listLoader.load(true))', async () => {
    // Гейт вручную — ТОЛЬКО на первый вызов ensureMediaUrl (элемент #1,
    // mediaId=2; элемент #0 идёт через avatarNew, не ensureMediaUrl вовсе,
    // элемент #2 использует дефолтную реализацию мока).
    let resolveByte1!: (url: string) => void
    const byte1Promise = new Promise<string>((resolve) => { resolveByte1 = resolve })
    ensureMediaUrlMock.mockImplementationOnce(() => byte1Promise)

    const mgrs = makeManagers({ [ALICE]: photos(3) })
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!

    await instance.setPeer(ALICE)

    // Узел #1 УЖЕ в DOM: `processItem` (:405-409) добавляет `avatarWrap` в
    // `.profile-avatars-avatars` СИНХРОННО, до await за URL — сам факт узла
    // в счётчике ленты доказательством не был бы. Доказательство — что
    // `await instance.setPeer(ALICE)` уже вернул управление тесту, а
    // `ensureMediaUrl(2)` всё ещё висит на `byte1Promise` (мы её не
    // резолвили): с `await listLoader.load(true)` (как было до раунда 1)
    // строка ниже была бы недостижима — сам `setPeer()` завис бы здесь.
    expect(avatarsEl.children[1].classList.contains('hide')).toBe(true)

    resolveByte1('blob:media-2')
    await vi.waitFor(() => expect(avatarsEl.children[1].classList.contains('hide')).toBe(false))
  })

  it('goWithoutTransition(distance) двигает transform, переносит .active на аватаре И на полоске; закольцовывание на обоих краях', async () => {
    const mgrs = makeManagers({ [ALICE]: photos(3) })
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector<HTMLElement>('.profile-avatars-avatars')!
    const tabsEl = instance.container.querySelector('.profile-avatars-tabs')!
    await instance.setPeer(ALICE)
    // `void listLoader.load(true)` — ждём, пока байты #1/#2 реально доедут
    // (round 1 ревью), иначе `goWithoutTransition` уйдёт в пустой `next`.
    await vi.waitFor(() => {
      expect(avatarsEl.children.length).toBe(3)
      expect(tabsEl.children.length).toBe(3)
    })

    instance.goWithoutTransition(1)
    expect(avatarsEl.style.transform).toBe('translate(-100%, 0)')
    expect(avatarsEl.children[1].classList.contains('active')).toBe(true)
    expect(tabsEl.children[1].classList.contains('active')).toBe(true)
    expect(avatarsEl.children[0].classList.contains('active')).toBe(false)
    expect(tabsEl.children[0].classList.contains('active')).toBe(false)

    instance.goWithoutTransition(1)
    expect(avatarsEl.style.transform).toBe('translate(-200%, 0)')
    expect(avatarsEl.children[2].classList.contains('active')).toBe(true)
    expect(tabsEl.children[2].classList.contains('active')).toBe(true)

    // Закольцовывание ВПЕРЁД с последнего индекса (count-1=2): distance
    // -(count-1) переносит на индекс 0 (та же формула, что применит клик по
    // правой зоне в задаче 3, tweb :227-228).
    instance.goWithoutTransition(-2)
    expect(avatarsEl.style.transform).toBe('translate(-0%, 0)')
    expect(avatarsEl.children[0].classList.contains('active')).toBe(true)
    expect(tabsEl.children[0].classList.contains('active')).toBe(true)

    // Закольцовывание НАЗАД с индекса 0: distance +(count-1) переносит на
    // последний индекс (формула клика по левой зоне, tweb :227).
    instance.goWithoutTransition(2)
    expect(avatarsEl.style.transform).toBe('translate(-200%, 0)')
    expect(avatarsEl.children[2].classList.contains('active')).toBe(true)
    expect(tabsEl.children[2].classList.contains('active')).toBe(true)
  })

  it('смена пира сбрасывает ленту — узлов прежнего пира не остаётся', async () => {
    const mgrs = makeManagers({ [ALICE]: photos(2), [GHOST]: photos(1) })
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!
    const tabsEl = instance.container.querySelector('.profile-avatars-tabs')!

    await instance.setPeer(ALICE)
    // `void listLoader.load(true)` — элемент #1 ALICE ещё грузит байты.
    await vi.waitFor(() => expect(avatarsEl.children.length).toBe(2))

    await instance.setPeer(GHOST)
    expect(avatarsEl.children.length).toBe(1)
    expect(tabsEl.children.length).toBe(1)
  })

  it('группа/канал — listPhotos не зовётся вовсе, в ленте одно текущее фото без карусели (tweb :443-499, долг backlogs/frontend/profile-chat-photo-history.md)', async () => {
    const CHANNEL = -601
    // Фото под ALICE есть — если бы isUser-гейт исчез, `toUserId(CHANNEL)`
    // (простое `+peerId`, БЕЗ учёта знака) ушёл бы за ЭТИМ же списком и тест
    // красил бы 3 узла вместо 1, а `listPhotos` был бы вызван.
    const mgrs = makeManagers({ [ALICE]: photos(3) })
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!
    const tabsEl = instance.container.querySelector('.profile-avatars-tabs')!

    await instance.setPeer(CHANNEL)

    expect(mgrs.profile.listPhotos).not.toHaveBeenCalled()
    expect(avatarsEl.children.length).toBe(1)
    expect(tabsEl.children.length).toBe(1)
    expect(instance.container.classList.contains('is-single')).toBe(true) // карусели нет — одна вкладка

    // Содержимое — мирроr пира через avatarNew (та же isFirst-ветка, что и
    // SHOW_NO_AVATAR), а не img/video: истории фото у ручки нет вовсе.
    const avatarNode = avatarsEl.children[0].querySelector('.avatar-like') as HTMLElement
    expect(avatarNode).toBeTruthy()
    expect(avatarNode.dataset.peerId).toBe(String(CHANNEL))
  })

  it('ответ на ПРОТУХШИЙ peerId игнорируется — гонка «переключили пира, пока грузилось»', async () => {
    let resolveAlice!: (v: ProfilePhoto[]) => void
    const alicePromise = new Promise<ProfilePhoto[]>((resolve) => { resolveAlice = resolve })
    const mgrs = makeManagers({ [GHOST]: photos(2) })
    mgrs.profile.listPhotos = vi.fn((userId: number) => (userId === ALICE ? alicePromise : Promise.resolve(photos(2))))
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector<HTMLElement>('.profile-avatars-avatars')!
    const tabsEl = instance.container.querySelector('.profile-avatars-tabs')!

    const alicePending = instance.setPeer(ALICE) // не ждём — переключаемся раньше ответа
    await instance.setPeer(GHOST)
    // `void listLoader.load(true)` — элемент #1 GHOST ещё грузит байты. Ждём
    // ОБА счётчика (не только avatarsEl): узел ленты появляется синхронно при
    // append, а вот вкладка (`addTab()`) и попадание элемента в `listLoader.next`
    // происходят только ПОСЛЕ полной загрузки — без вкладки в счётчике
    // `goWithoutTransition` ниже мог бы уйти в ещё пустой `next`.
    await vi.waitFor(() => {
      expect(avatarsEl.children.length).toBe(2)
      expect(tabsEl.children.length).toBe(2)
    }) // GHOST успел отрисоваться (2 фото)

    resolveAlice(photos(5)) // ALICE отвечает ПОСЛЕ переключения, с БОЛЬШИМ числом фото
    await alicePending

    // ALICE не долетел до DOM — ни узлов, ни (что важнее числа узлов, которое
    // случайно не изменилось бы и без гейта, будь у ALICE тоже 2 фото) не
    // подменённого `this.listLoader`: без гейта строка `this.listLoader =
    // new ListLoader(...)` для ALICE выполнилась бы ДО внутренней проверки в
    // processItem и подменила бы собой loader ленты GHOST — goWithoutTransition
    // после этого либо сломался бы (индекс/count от чужой, 5-элементной
    // галереи), либо молча тронул чужие данные.
    expect(avatarsEl.children.length).toBe(2)
    instance.goWithoutTransition(1)
    expect(avatarsEl.style.transform).toBe('translate(-100%, 0)')
    expect(avatarsEl.children[1].classList.contains('active')).toBe(true)
  })

  it('ленивая догрузка — элементы дальше LOAD_NEAREST не грузятся до появления в IntersectionObserver', async () => {
    const mgrs = makeManagers({ [ALICE]: photos(8) })
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!

    await instance.setPeer(ALICE)
    const nodes = Array.from(avatarsEl.children) as HTMLElement[]
    expect(nodes.length).toBe(8)

    // Первые LOAD_NEAREST=3 узла грузятся сразу (eager), но байты #1/#2 идут
    // через `void listLoader.load(true)` (round 1 ревью) — ждём фактического
    // снятия `hide`, а не порядка микрозадач.
    await vi.waitFor(() => {
      for (let i = 0; i < 3; i++) expect(nodes[i].classList.contains('hide')).toBe(false)
    })
    // Остальные ждут наблюдателя — им нечем ответить на ensureMediaUrl/
    // resolveStreamUrl, если бы они начали грузиться, поэтому факт "hide" —
    // прямое доказательство (и не изменится дальнейшим ожиданием выше).
    for (let i = 3; i < 8; i++) expect(nodes[i].classList.contains('hide')).toBe(true)

    intersect(nodes[3]) // имитация появления 4-го узла во вьюпорте
    await vi.waitFor(() => expect(nodes[3].classList.contains('hide')).toBe(false))

    // Последний узел (idx 7) вне окна LOAD_NEAREST вокруг idx 3 — не догрузился.
    expect(nodes[7].classList.contains('hide')).toBe(true)
  })

  it('пустая галерея — SHOW_NO_AVATAR: один узел-заглушка через avatarNew (мирроr пира)', async () => {
    const mgrs = makeManagers({ [ALICE]: [] })
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!
    const tabsEl = instance.container.querySelector('.profile-avatars-tabs')!

    await instance.setPeer(ALICE)

    expect(avatarsEl.children.length).toBe(1)
    expect(tabsEl.children.length).toBe(1)
    const node = avatarsEl.children[0] as HTMLElement
    expect(node.classList.contains('profile-avatars-avatar')).toBe(true)
    // Содержимое — настоящий узел avatarNew (мирроr пира), а не img/video.
    const avatarNode = node.querySelector('.avatar-like') as HTMLElement
    expect(avatarNode).toBeTruthy()
    expect(avatarNode.dataset.peerId).toBe(String(ALICE))
  })

  it('видео-аватар (videoMediaId) — <video class="avatar-photo avatar-video">, комментарий у ветки объясняет недостижимость на проводе', async () => {
    // Порождаем фикстуру НАПРЯМУЮ (мимо реального provider'а): на настоящем
    // проводе mapProfilePhoto сегодня жёстко кладёт videoMediaId: undefined
    // (profileManager.ts:143) — ветка ниже проверяет, что КОД processItem
    // корректно её обработает, когда провод почитают, а не то, что провод уже
    // чинит видео сегодня.
    const mgrs = makeManagers({ [ALICE]: [photo(1), photo(2, 999)] })
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!

    await instance.setPeer(ALICE)

    // Элемент #1 (видео) приходит из `void listLoader.load(true)` — ждём,
    // пока `resolveStreamUrl`/`renderImageFromUrlPromise` реально отработают.
    const video = await vi.waitFor(() => {
      const el = avatarsEl.children[1].querySelector('video.avatar-video') as HTMLVideoElement | null
      expect(el).toBeTruthy()
      return el!
    })
    expect(video.loop).toBe(true)
    expect(video.muted).toBe(true)
    expect(resolveStreamUrlMock).toHaveBeenCalledWith(999)
  })

  it('setCollapsed(true) возвращает ленту на первый кадр (tweb :931-933)', async () => {
    const mgrs = makeManagers({ [ALICE]: photos(3) })
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector<HTMLElement>('.profile-avatars-avatars')!
    const tabsEl = instance.container.querySelector('.profile-avatars-tabs')!
    await instance.setPeer(ALICE)
    // `void listLoader.load(true)` — ждём, пока байты #1/#2 реально доедут.
    await vi.waitFor(() => {
      expect(avatarsEl.children.length).toBe(3)
      expect(tabsEl.children.length).toBe(3)
    })

    instance.goWithoutTransition(2) // ушли на последний индекс (2)
    expect(avatarsEl.children[2].classList.contains('active')).toBe(true)

    ;(instance as any).setCollapsed(true) // сворачивание — лента обязана вернуться на индекс 0
    expect(avatarsEl.children[0].classList.contains('active')).toBe(true)
    expect(avatarsEl.style.transform).toBe('translate(-0%, 0)')

    // Повторное сворачивание (уже свёрнуто) — новых прыжков нет, полоска
    // остаётся на месте (tweb-условие `!this.isCollapsed()`).
    instance.goWithoutTransition(1)
    ;(instance as any).setCollapsed(true)
    expect(avatarsEl.children[1].classList.contains('active')).toBe(true) // НЕ откатилось на 0
  })
})

describe('PeerProfileAvatars.cleanup() — лента данных (задача 2, tweb :957-973)', () => {
  it('снимает регистрацию видео в animationIntersector и отключает IntersectionObserver', async () => {
    // 5 фото > LOAD_NEAREST(3) — idx 3/4 остаются ленивыми и ПОПАДАЮТ под
    // наблюдение (иначе `observed` пуст ещё ДО cleanup, и снятие наблюдения
    // нечем было бы проверить: ассерт про disconnect() красил бы что угодно).
    const mgrs = makeManagers({ [ALICE]: [photo(1), photo(2, 999), photo(3), photo(4), photo(5)] })
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!

    await instance.setPeer(ALICE)
    // Видео (#1) и регистрация ленивых #3/#4 в наблюдателе приходят из
    // `void listLoader.load(true)` — ждём фактического состояния, а не
    // порядка микрозадач.
    const video = await vi.waitFor(() => {
      const el = avatarsEl.children[1].querySelector('video.avatar-video') as HTMLVideoElement | null
      expect(el).toBeTruthy()
      expect(ioInstances.some((io) => io.observed.size > 0)).toBe(true) // idx 3/4 реально под наблюдением
      return el!
    })

    const removeSpy = vi.spyOn(animationIntersector, 'removeAnimationByPlayer')
    instance.cleanup()

    expect(removeSpy).toHaveBeenCalledWith(video)
    // IntersectionObserver отключён — ни один инстанс не наблюдает узлов.
    expect(ioInstances.some((io) => io.observed.size > 0)).toBe(false)
  })
})

// ─── Задача 3: жесты (tweb :127-298, :591-650) ─────────────────────────────
//
// happy-dom не считает layout — `getBoundingClientRect()` у всего нулевой
// (тот же факт документируют `scrollable.test.ts`/`rangeSelector.test.ts` и
// другие); геометрия контейнера/ленты мокается явно там, где по ней принимает
// решение клик-зона/свайп (приём — как в `chat/replySwipe.test.ts`).
//
// Клик — `Event('click')` с `pageX`, довешенным через `defineProperty`:
// `MouseEvent` happy-dom НЕ вычисляет `pageX` из `clientX` (координата
// страницы требует знания скролла) — `pageX` остаётся 0 у любого
// сконструированного `MouseEvent`, поэтому нужен голый `Event` + ручное поле
// (тот же приём для тач-полей уже применяет `core/dom/swipeHandler.test.ts::makeEvent`).
function mockRect(el: HTMLElement, rect: Partial<DOMRect> = {}): void {
  el.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300, x: 0, y: 0,
    toJSON: () => ({}),
    ...rect,
  }) as DOMRect
}

function clickAt(el: HTMLElement, pageX: number): void {
  const e = new Event('click', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pageX', { value: pageX, configurable: true })
  el.dispatchEvent(e)
}

function pointerEvent(type: string, props: Record<string, unknown>): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries(props)) Object.defineProperty(e, key, { value, configurable: true })
  return e
}

/** Загруженная лента из `n` фото + замоканная геометрия `container` (300px,
 *  трети по 100px: [0,100) — prev, (100,200) — viewer, (200,300] — next). */
async function makeLoaded(n = 3) {
  const mgrs = makeManagers({ [ALICE]: photos(n) })
  const { instance, setCollapsedOn, scrollableEl } = make(mgrs)
  const avatarsEl = instance.container.querySelector<HTMLElement>('.profile-avatars-avatars')!
  const tabsEl = instance.container.querySelector('.profile-avatars-tabs')!

  await instance.setPeer(ALICE)
  await vi.waitFor(() => {
    expect(avatarsEl.children.length).toBe(n)
    expect(tabsEl.children.length).toBe(n)
  })

  mockRect(instance.container, { left: 0, width: 300, right: 300 })

  return { instance, avatarsEl, tabsEl, setCollapsedOn, scrollableEl }
}

describe('PeerProfileAvatars — клик по зонам (tweb :142-233)', () => {
  it('левая/правая треть листают с закольцовыванием на обоих краях', async () => {
    const { instance, avatarsEl, tabsEl } = await makeLoaded(3)

    clickAt(instance.container, 30) // левая треть, индекс 0 → закольцовка на последний (tweb :227)
    expect(avatarsEl.children[2].classList.contains('active')).toBe(true)
    expect(tabsEl.children[2].classList.contains('active')).toBe(true)

    clickAt(instance.container, 270) // правая треть с последнего индекса → закольцовка на 0 (tweb :228)
    expect(avatarsEl.children[0].classList.contains('active')).toBe(true)
    expect(tabsEl.children[0].classList.contains('active')).toBe(true)
  })

  it('клик в центр открывает просмотрщик с ПРАВИЛЬНЫМ индексом — проверяем аргументы openMediaViewer, не факт вызова', async () => {
    const { instance, avatarsEl } = await makeLoaded(3)
    instance.goWithoutTransition(1) // индекс 1 — не первый и не последний, чтобы индекс не совпал случайно с 0

    const openSpy = vi.spyOn(viewerModule, 'openMediaViewer').mockImplementation(() => undefined)
    clickAt(instance.container, 150) // центр — треть [100,200)

    expect(openSpy).toHaveBeenCalledTimes(1)
    const args = openSpy.mock.calls[0][0]
    expect(args.index).toBe(1) // tweb :211 — this.listLoader.previous.length в момент клика
    expect(args.reverse).toBe(false) // галерея профиля — newest-first (openMediaViewer.ts:31-33), не окно чата
    expect(args.items).toHaveLength(3)
    expect(args.target).toBe(avatarsEl.children[1])
  })

  it('клик при is-collapsed только разворачивает (снимает is-collapsed) и НЕ листает (tweb :174-182)', async () => {
    const { instance, avatarsEl, setCollapsedOn } = await makeLoaded(3)
    ;(instance as any).setCollapsed(true)
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(true)

    clickAt(instance.container, 30) // была бы левая треть (листание), но шапка свёрнута

    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(false) // клик развернул
    expect(avatarsEl.children[0].classList.contains('active')).toBe(true) // индекс НЕ ушёл со старта — листания не было
  })

  it('checkScrollTop: ненулевой скролл гасит клик и скроллит контейнер к началу (tweb :127-137, :166-168)', async () => {
    const { instance, avatarsEl, scrollableEl } = await makeLoaded(3)
    scrollableEl.scrollTop = 50
    const scrollToSpy = vi.spyOn(scrollableEl, 'scrollTo')

    clickAt(instance.container, 30) // была бы левая треть

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(avatarsEl.children[0].classList.contains('active')).toBe(true) // не листнуло
  })
})

describe('PeerProfileAvatars — свайп через SwipeHandler (tweb :243-298)', () => {
  it('нулевой чистый сдвиг (вернулись к точке нажатия до отпускания) возвращает ленту на прежний индекс; is-swiping/no-transition появляются и СНИМАЮТСЯ', async () => {
    const { instance, avatarsEl } = await makeLoaded(3)
    mockRect(avatarsEl, { left: 0, width: 300 })

    avatarsEl.dispatchEvent(pointerEvent('mousedown', { clientX: 150, clientY: 100, button: 0 }))
    await Promise.resolve() // SwipeHandler.handleStart асинхронный (core/dom/swipeHandler.ts:309)

    document.dispatchEvent(pointerEvent('mousemove', { clientX: 170, clientY: 100 }))
    expect(instance.container.classList.contains('is-swiping')).toBe(true) // onFirstSwipe (tweb :282)
    expect(avatarsEl.classList.contains('no-transition')).toBe(true)

    document.dispatchEvent(pointerEvent('mousemove', { clientX: 150, clientY: 100 })) // назад к точке старта — net 0
    document.dispatchEvent(pointerEvent('mouseup', { clientX: 150, clientY: 100 }))

    // fastRaf — реальный requestAnimationFrame (эта describe его не мокает,
    // в отличие от блока rAF-прогресса ниже) — ждём фактического снятия.
    await vi.waitFor(() => {
      expect(instance.container.classList.contains('is-swiping')).toBe(false)
      expect(avatarsEl.classList.contains('no-transition')).toBe(false)
    })
    expect(avatarsEl.children[0].classList.contains('active')).toBe(true) // индекс не менялся
  })

  it('ЛЮБОЙ ненулевой чистый сдвиг переводит индекс минимум на ±1 — формула ceil(|dx|/width), не пропорциональный порог (tweb :287)', async () => {
    const { avatarsEl } = await makeLoaded(3)
    mockRect(avatarsEl, { left: 0, width: 300 })

    avatarsEl.dispatchEvent(pointerEvent('mousedown', { clientX: 150, clientY: 100, button: 0 }))
    await Promise.resolve()

    document.dispatchEvent(pointerEvent('mousemove', { clientX: 100, clientY: 100 })) // -50px, дальше половины ширины не нужно — ceil любого ненулевого даёт 1
    document.dispatchEvent(pointerEvent('mouseup', { clientX: 100, clientY: 100 }))

    await vi.waitFor(() => {
      expect(avatarsEl.children[1].classList.contains('active')).toBe(true)
    })
  })

  it('is-single (одно фото) блокирует старт свайпа (verifyTouchTarget, tweb :265)', async () => {
    const { instance, avatarsEl } = await makeLoaded(1)
    mockRect(avatarsEl, { left: 0, width: 300 })
    expect(instance.container.classList.contains('is-single')).toBe(true)

    avatarsEl.dispatchEvent(pointerEvent('mousedown', { clientX: 150, clientY: 100, button: 0 }))
    await Promise.resolve()
    document.dispatchEvent(pointerEvent('mousemove', { clientX: 100, clientY: 100 }))

    // verifyTouchTarget вернул false — onFirstSwipe не звался, is-swiping не взводится.
    expect(instance.container.classList.contains('is-swiping')).toBe(false)
  })
})

describe('PeerProfileAvatars — rAF-прогресс полоски видео-аватара (tweb :591-650)', () => {
  // Управляемая очередь кадров — тот же приём, что `core/chat/gradientRenderer.test.ts`:
  // `flushFrame()` играет ровно ОДИН тик и даёт тесту решить, продолжать ли.
  let frames: Map<number, FrameRequestCallback>
  let nextId: number

  const flushFrame = () => {
    const queue = Array.from(frames.values())
    frames.clear()
    queue.forEach((cb) => cb(0))
  }

  beforeEach(() => {
    frames = new Map()
    nextId = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      nextId += 1
      frames.set(nextId, cb)
      return nextId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('play запускает цикл; тикает --progress пока видео играет; останавливается на паузе; будится повторным play', async () => {
    const mgrs = makeManagers({ [ALICE]: [photo(1), photo(2, 999)] })
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!
    const tabsEl = instance.container.querySelector('.profile-avatars-tabs')!

    await instance.setPeer(ALICE)
    const video = await vi.waitFor(() => {
      const el = avatarsEl.children[1].querySelector('video.avatar-video') as HTMLVideoElement | null
      expect(el).toBeTruthy()
      return el!
    })
    instance.goWithoutTransition(1) // активный индекс — 1, тот же, что у видео
    // goWithoutTransition сам планирует кадр через fastRaf (снятие
    // no-transition) — эта describe мокает requestAnimationFrame ГЛОБАЛЬНО,
    // поэтому и он оседает в `frames`; он не по нашей части, сбрасываем.
    frames.clear()

    Object.defineProperty(video, 'duration', { value: 10, configurable: true })
    video.currentTime = 3
    Object.defineProperty(video, 'paused', { value: false, configurable: true })

    video.dispatchEvent(new Event('play')) // capture-слушатель конструктора (tweb :119-125) запускает цикл
    expect(frames.size).toBe(1)

    flushFrame() // первый тик: видео играет → --progress выставлен, следующий кадр запланирован сам собой
    const tab = tabsEl.children[1] as HTMLElement
    expect(tab.classList.contains('is-playing')).toBe(true)
    expect(tab.style.getPropertyValue('--progress')).toBe('30.0%')
    expect(frames.size).toBe(1)

    Object.defineProperty(video, 'paused', { value: true, configurable: true })
    flushFrame() // видео на паузе — тик гасит --progress и НЕ планирует следующий кадр (самоприостановка)
    expect(tab.classList.contains('is-playing')).toBe(false)
    expect(tab.style.getPropertyValue('--progress')).toBe('')
    expect(frames.size).toBe(0)

    Object.defineProperty(video, 'paused', { value: false, configurable: true })
    video.dispatchEvent(new Event('play')) // будим самоприостановленный цикл
    expect(frames.size).toBe(1)
  })

  it('cleanup() гасит цикл — cancelAnimationFrame снимает запланированный кадр', async () => {
    const mgrs = makeManagers({ [ALICE]: [photo(1), photo(2, 999)] })
    const { instance } = make(mgrs)
    const avatarsEl = instance.container.querySelector('.profile-avatars-avatars')!

    await instance.setPeer(ALICE)
    const video = await vi.waitFor(() => {
      const el = avatarsEl.children[1].querySelector('video.avatar-video') as HTMLVideoElement | null
      expect(el).toBeTruthy()
      return el!
    })
    instance.goWithoutTransition(1)
    frames.clear() // сбрасываем кадр fastRaf самого goWithoutTransition — см. комментарий в тесте выше
    Object.defineProperty(video, 'duration', { value: 10, configurable: true })
    Object.defineProperty(video, 'paused', { value: false, configurable: true })
    video.dispatchEvent(new Event('play'))
    expect(frames.size).toBe(1)

    instance.cleanup()
    expect(frames.size).toBe(0)
  })
})
