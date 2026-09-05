// Аватарка (`components/avatar.ts`, порт tweb `components/avatarNew.tsx`).
//
// Пины:
//   (1) разметка узла — четыре класса и `data-peer-id` (tweb :1073, :1076);
//   (2) инициалы и `data-color` берутся из карточки зеркала СИНХРОННО, а промах
//       зеркала объявляется владельцу РОВНО ОДИН раз и перерисовывается по
//       приезду карточки (tweb :826-849 + механика `avatarsMap`, :56-93);
//   (3) ветки без инициалов доходят до узла: удалённый аккаунт (:788-791) и
//       скрытая атрибуция пересылки (:836-838);
//   (4) `peerTitle` строкой (:763-771) — инициалы из имени, зеркало не
//       спрашивается;
//   (5) форум — `is-forum` (:794, :997);
//   (6) фотография вытесняет инициалы (:1026), stripped-подложка живёт ПОД ней
//       (:574-589) и снимается после проявления (:598-602);
//   (7) `readyThumbPromise` разрешается ВСЕГДА — включая «фотографии нет» и сбой
//       загрузки (:609-618): его ждёт серия баблов, и висящий промис подвесил бы
//       открытие чата;
//   (8) `size: 'full'` (задача 7) даёт класс `avatar-full`, а не `avatar-{N}`
//       (tweb :417, :1073) и `noFadeIn: true` (:409, :549) гасит `fade-in` у
//       большой фотографии даже когда лайт-режим разрешает анимации.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import liteMode from '@helpers/liteMode'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { HIDDEN_PEER_ID } from '@core/peers/peerId'
import { PEER_COLOR_NAMES } from '@components/peerColor'

// Загрузка картинки — чужая подсистема со своими тестами; здесь важен только
// момент её готовности, поэтому обе точки под контролем теста.
const ensureMediaUrl = vi.hoisted(() => vi.fn<(id: number, opts?: unknown) => Promise<string>>())
const renderImageFromUrlPromise = vi.hoisted(() =>
  vi.fn<(el: HTMLImageElement, url: string) => Promise<void>>(),
)
const cachedMediaUrl = vi.hoisted(() => vi.fn<(id: number, thumb?: boolean) => string | undefined>())

vi.mock('@core/media/ensureMediaUrl', () => ({ ensureMediaUrl }))
vi.mock('@helpers/dom/renderImageFromUrl', () => ({ renderImageFromUrlPromise }))
vi.mock('@core/mediaCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/mediaCache')>()),
  cachedMediaUrl,
}))

const { avatarNew } = await import('./avatar')
type AvatarManagers = import('./avatar').AvatarManagers

const ALICE = 5
const GHOST = 6
const CHANNEL = -7
const PHOTO_ID = 4242

let fillMirror: AvatarManagers['peers']['fillMirror'] & ReturnType<typeof vi.fn>
let managers: AvatarManagers
let middlewareHelper: ReturnType<typeof getMiddleware>

beforeEach(() => {
  vi.clearAllMocks()
  resetPeerMirror()
  fillMirror = vi.fn(async () => {}) as typeof fillMirror
  managers = { peers: { fillMirror } }
  middlewareHelper = getMiddleware()

  cachedMediaUrl.mockReturnValue(undefined)
  ensureMediaUrl.mockResolvedValue('blob:full')
  renderImageFromUrlPromise.mockImplementation((el, url) => {
    el.src = url
    return Promise.resolve()
  })
  vi.spyOn(liteMode, 'isAvailable').mockReturnValue(true)
})

afterEach(() => {
  // Снимает узлы с модульного реестра живых (иначе следующий тест перерисует их).
  middlewareHelper.destroy()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const make = (options: {
  peerId?: PeerId
  peerTitle?: string
  size?: number | 'full'
  noFadeIn?: boolean
} = {}) =>
  avatarNew({
    size: options.size ?? 40,
    noFadeIn: options.noFadeIn,
    peerId: options.peerId,
    peerTitle: options.peerTitle,
    middleware: middlewareHelper.get(),
    managers,
  })

/** Инициалы могут приехать как текст или как `<img class="emoji">` — решает
 *  `wrapEmojiText` по поддержке эмодзи платформой (тот же приём, что в
 *  `chat/peerTitle.test.ts`). */
const initials = (node: HTMLElement) =>
  Array.from(node.childNodes)
    .map((n) => (n instanceof HTMLImageElement ? n.alt : n.textContent))
    .join('')

describe('avatarNew — разметка узла', () => {
  it('четыре класса оригинала, размер и ключ пира', () => {
    const { node } = make({ peerId: ALICE })

    expect(node.tagName).toBe('DIV')
    expect(node.className.split(' ').slice(0, 4)).toEqual([
      'avatar', 'avatar-like', 'avatar-40', 'avatar-gradient',
    ])
    expect(node.dataset.peerId).toBe('' + ALICE)
  })

  it('size: \'full\' даёт класс avatar-full, а не avatar-{число} (задача 7, tweb :417/:1073)', () => {
    const { node } = make({ peerId: ALICE, size: 'full' })

    expect(node.className.split(' ').slice(0, 4)).toEqual([
      'avatar', 'avatar-like', 'avatar-full', 'avatar-gradient',
    ])
  })
})

describe('avatarNew — инициалы и цвет из карточки зеркала', () => {
  it('инициалы = первая буква имени + первая буква фамилии, цвет по индексу пира', () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Алиса', last_name: 'Селезнёва', pFlags: {} }] }])

    const { node } = make({ peerId: ALICE })

    expect(initials(node)).toBe('АС')
    expect(node.dataset.color).toBe(PEER_COLOR_NAMES[ALICE % 7])
  })

  it('заголовок чата даёт инициалы так же, как имя пользователя', () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'channel', id: 7, title: 'Клуб Путешественников', date: 0, photo: { _: 'chatPhotoEmpty' } }] }])

    const { node } = make({ peerId: CHANNEL })

    expect(initials(node)).toBe('КП')
    // Индекс цвета — abs(peerId) % 7, знак ключа на него не влияет.
    expect(node.dataset.color).toBe(PEER_COLOR_NAMES[7 % 7])
  })

  it('промах зеркала объявляется владельцу один раз, приехавшая карточка перерисовывает узел', () => {
    const { node } = make({ peerId: GHOST })

    expect(fillMirror).toHaveBeenCalledTimes(1)
    expect(fillMirror).toHaveBeenCalledWith([GHOST])
    // Карточки нет — цвета тоже нет (tweb `getPeerAvatarColorByPeer(undefined)`).
    expect(node.dataset.color).toBeUndefined()
    expect(initials(node)).toBe('')

    // Зеркало двинулось из-за ЧУЖОЙ карточки: узел перерисовывается (подписка
    // одна на модуль), карточки по-прежнему нет — но второго похода к владельцу
    // за той же быть не должно.
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} }] }])
    expect(fillMirror).toHaveBeenCalledTimes(1)

    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: GHOST, first_name: 'Гость', pFlags: {} }] }])

    expect(initials(node)).toBe('Г')
    expect(node.dataset.color).toBe(PEER_COLOR_NAMES[GHOST % 7])
    expect(fillMirror).toHaveBeenCalledTimes(1)
  })

  it('форумный канал — квадратная аватарка (класс is-forum)', () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'channel', id: 7, title: 'Форум', date: 0, photo: { _: 'chatPhotoEmpty' }, pFlags: { forum: true, megagroup: true } }] }])

    expect(make({ peerId: CHANNEL }).node.classList.contains('is-forum')).toBe(true)
  })
})

describe('avatarNew — ветки без инициалов', () => {
  it('удалённый аккаунт: серый цвет и своя иконка вместо букв', () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Алиса', pFlags: { deleted: true } }] }])

    const { node } = make({ peerId: ALICE })

    expect(node.dataset.color).toBe('archive')
    // Иконка — ЕДИНСТВЕННЫЙ ребёнок: буквы «А» рядом с ней быть не должно.
    expect(node.childNodes.length).toBe(1)
    expect((node.firstChild as HTMLElement).className).toBe('tgico avatar-icon avatar-icon-deletedaccount')
  })

  it('скрытая атрибуция пересылки: фиолетовый и author_hidden, зеркало не спрашивается', () => {
    const { node } = make({ peerId: HIDDEN_PEER_ID })

    expect(node.dataset.color).toBe('violet')
    expect(node.childNodes.length).toBe(1)
    expect((node.firstChild as HTMLElement).className).toBe('tgico avatar-icon avatar-icon-author_hidden')
    expect(fillMirror).not.toHaveBeenCalled()
  })

  it('имя строкой (peerTitle): инициалы из него, цвета нет, зеркало не спрашивается', () => {
    const { node } = make({ peerId: ALICE, peerTitle: 'Иван Петров' })

    expect(initials(node)).toBe('ИП')
    expect(node.dataset.color).toBeUndefined()
    expect(fillMirror).not.toHaveBeenCalled()
  })
})

describe('avatarNew — фотография', () => {
  const withPhoto = (stripped?: string) => {
    applyPeerOps([{
      op: 'upsert',
      peers: [{
        _: 'user',
        id: ALICE,
        first_name: 'Алиса',
        pFlags: {},
        photo: { _: 'userProfilePhoto', photo_id: PHOTO_ID, stripped_thumb: stripped },
      }],
    }])
  }

  it('фотография вытесняет инициалы и разрешает readyThumbPromise', async () => {
    withPhoto()
    const { node, readyThumbPromise } = make({ peerId: ALICE })

    // До загрузки на узле ещё инициалы — подложка оригинала.
    expect(initials(node)).toBe('А')

    await readyThumbPromise

    const image = node.querySelector('img.avatar-photo')
    expect(image).not.toBeNull()
    expect((image as HTMLImageElement).src).toBe('blob:full')
    expect(ensureMediaUrl).toHaveBeenCalledWith(PHOTO_ID, expect.anything())
    // Инициалы ушли: tweb рисует `[media, abbreviature].find(Boolean)`.
    expect(node.textContent).toBe('')
  })

  it('stripped-подложка показывается под фотографией и снимается после проявления', async () => {
    vi.useFakeTimers()
    withPhoto('QUJD')

    let resolveFull: () => void = () => {}
    renderImageFromUrlPromise.mockImplementation((el, url) => {
      el.src = url
      if (url.startsWith('data:')) return Promise.resolve()
      return new Promise<void>((resolve) => { resolveFull = () => resolve() })
    })

    const { node, readyThumbPromise } = make({ peerId: ALICE })
    await readyThumbPromise

    const thumb = node.querySelector('img.avatar-photo-thumbnail')
    expect(thumb).not.toBeNull()
    expect((thumb as HTMLImageElement).src).toBe('data:image/jpeg;base64,QUJD')
    // Подложка и фотография стакаются — корню нужен позиционирующий контекст.
    expect(node.classList.contains('avatar-relative')).toBe(true)

    resolveFull()
    await vi.advanceTimersByTimeAsync(0)

    const image = node.querySelector('img.avatar-photo:not(.avatar-photo-thumbnail)')
    expect(image).not.toBeNull()
    expect((image as HTMLImageElement).classList.contains('fade-in')).toBe(true)

    vi.advanceTimersByTime(200)
    expect((image as HTMLImageElement).classList.contains('fade-in')).toBe(false)
    expect(node.querySelector('img.avatar-photo-thumbnail')).toBeNull()
    expect(node.classList.contains('avatar-relative')).toBe(false)
  })

  it('картинка уже в зеркале URL — без подложки и без анимации проявления', async () => {
    withPhoto('QUJD')
    cachedMediaUrl.mockReturnValue('blob:cached')

    const { node, readyThumbPromise } = make({ peerId: ALICE })
    await readyThumbPromise

    const image = node.querySelector('img.avatar-photo')
    expect(image).not.toBeNull()
    expect((image as HTMLImageElement).classList.contains('fade-in')).toBe(false)
    expect(node.querySelector('img.avatar-photo-thumbnail')).toBeNull()
  })

  it('noFadeIn: true гасит fade-in даже когда лайт-режим разрешает анимации (tweb :409, :549 — задача 7)', async () => {
    // Без stripped-подложки — иначе `img.avatar-photo` матчит ЕЁ (тот же
    // класс, `avatar.ts::putAvatar`), а не полную фотографию, и тест был бы
    // слеп к мутации, убирающей `noFadeIn` из вычисления `animate`.
    withPhoto()

    const { node, readyThumbPromise } = make({ peerId: ALICE, noFadeIn: true })
    await readyThumbPromise

    const image = node.querySelector('img.avatar-photo')
    expect(image).not.toBeNull()
    expect((image as HTMLImageElement).classList.contains('fade-in')).toBe(false)
  })

  it('сбой загрузки не подвешивает серию: остаёмся на инициалах, промис разрешается', async () => {
    withPhoto()
    ensureMediaUrl.mockRejectedValue(new Error('FILE_ID_INVALID'))

    const { node, readyThumbPromise } = make({ peerId: ALICE })
    await readyThumbPromise

    expect(node.querySelector('img.avatar-photo')).toBeNull()
    expect(initials(node)).toBe('А')
  })

  it('фотографии нет — промис всё равно разрешается (processResult оригинала)', async () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} }] }])

    await make({ peerId: ALICE }).readyThumbPromise
    expect(ensureMediaUrl).not.toHaveBeenCalled()
  })
})
