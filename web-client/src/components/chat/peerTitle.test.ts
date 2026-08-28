// Узел имени пира (`PeerTitle`, порт tweb `components/peerTitle.ts`).
//
// Пины:
//   (1) имя берётся из зеркала карточек СИНХРОННО — узел строится готовым;
//   (2) фолбэки оригинала доходят до узла: удалённый аккаунт, промах зеркала и
//       скрытая атрибуция пересылки (`HIDDEN_PEER_ID`) — узел не остаётся
//       пустым НИКОГДА (tweb `getPeerTitle.ts:62`, `peerTitle.ts:149`);
//   (3) имя проходит через `wrapEmojiText` — эмодзи в имени становится узлом
//       `.emoji`, а не остаётся системным глифом (tweb `peerTitle.ts:114`,
//       `wrappers/getPeerTitle.ts:91`);
//   (4) промах зеркала объявляется владельцу РОВНО ОДИН раз, а приехавшая
//       карточка перерисовывает узел.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { AUTHOR_HIDDEN_TITLE, DELETED_ACCOUNT_TITLE } from '@core/peers/getPeerTitle'
import { HIDDEN_PEER_ID } from '@core/peers/peerId'
import PeerTitle, { type PeerTitleManagers } from './peerTitle'

const ALICE = 5
const GHOST = 6

let fillMirror: PeerTitleManagers['peers']['fillMirror'] & ReturnType<typeof vi.fn>
let managers: PeerTitleManagers
const middlewareHelper = getMiddleware()

beforeEach(() => {
  resetPeerMirror()
  fillMirror = vi.fn(async () => {}) as typeof fillMirror
  managers = { peers: { fillMirror } }
})

/** Эмодзи рисуется либо картинкой CDN (её текст — в `alt`), либо своим глифом
 *  в `span.emoji-native` — как решит `IS_EMOJI_SUPPORTED` платформы. */
const emojiText = (element: HTMLElement) =>
  element instanceof HTMLImageElement ? element.alt : element.textContent

const title = (peerId?: PeerId, fromName?: string) =>
  new PeerTitle({ peerId, fromName, middleware: middlewareHelper.get(), managers }).element

describe('PeerTitle', () => {
  it('берёт имя из зеркала синхронно — узел готов сразу', () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} }] }])

    const element = title(ALICE)

    expect(element.textContent).toBe('Алиса')
    expect(element.dataset.peerId).toBe('' + ALICE)
    expect(element.classList.contains('peer-title')).toBe(true)
  })

  it('удалённый аккаунт — фолбэк оригинала, а не пустой узел', () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, pFlags: { deleted: true } }] }])

    expect(title(ALICE).textContent).toBe(DELETED_ACCOUNT_TITLE)
  })

  it('промах зеркала — тот же фолбэк (у tweb `!user` первым термом), узел не пуст', () => {
    expect(title(GHOST).textContent).toBe(DELETED_ACCOUNT_TITLE)
    expect(fillMirror).toHaveBeenCalledWith([GHOST])
  })

  it('скрытая атрибуция пересылки — «Скрытое имя», и зеркало НЕ спрашивается', () => {
    const element = title(HIDDEN_PEER_ID)

    expect(element.textContent).toBe(AUTHOR_HIDDEN_TITLE)
    // карточки у sentinel-ключа не существует — просить её было бы вечным пробелом
    expect(fillMirror).not.toHaveBeenCalled()
  })

  it('приехавшая карточка перерисовывает узел, а пробел объявляется один раз', () => {
    const element = title(ALICE)
    expect(element.textContent).toBe(DELETED_ACCOUNT_TITLE)

    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} }] }])

    expect(element.textContent).toBe('Алиса')
    expect(fillMirror).toHaveBeenCalledTimes(1)
  })

  it('эмодзи в имени становится узлом .emoji (wrapEmojiText, а не текст)', () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Алиса 😎', pFlags: {} }] }])

    const element = title(ALICE)

    const emoji = element.querySelectorAll<HTMLElement>('.emoji')
    expect(emoji).toHaveLength(1)
    // без обёртки эмодзи остался бы обычным текстом внутри `.peer-title`
    expect(emojiText(emoji[0])).toBe('😎')
    expect(element.firstChild?.textContent).toBe('Алиса ')
  })

  it('имя строкой (`fromName`) идёт тем же путём — и тоже через wrapEmojiText', () => {
    const element = title(undefined, 'Канал 😎')

    expect(element.firstChild?.textContent).toBe('Канал ')
    const emoji = element.querySelectorAll<HTMLElement>('.emoji')
    expect(emoji).toHaveLength(1)
    expect(emojiText(emoji[0])).toBe('😎')
    // строка не может измениться — зеркало для неё не спрашивается
    expect(fillMirror).not.toHaveBeenCalled()
  })
})
