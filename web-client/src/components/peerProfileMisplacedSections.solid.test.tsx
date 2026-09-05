/** @jsxImportSource solid-js */
/**
 * Тесты наших секций без аналога в оригинале (`peerProfile.solid.tsx`, Task 5
 * плана `docs/superpowers/plans/2026-09-05-profile-card-solid.md`, «Задача 5»):
 * Statistics/Discussion/JoinRequests/EncryptionKey.
 *
 * Мок-слой скопирован с `peerProfileMainSection.solid.test.tsx` (peer/fullPeer/
 * chatsStore) — эти секции сами peer/fullPeer не читают, но их подключает
 * `MainSection`, смонтированная тем же корнем `<PeerProfile>`, и без мока
 * `client/bootstrap` (`startClient`, дёргает `Notifications`) тест тянул бы
 * реальный воркерный бутстрап.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import { glyph, type IconName } from '../core/tgico-icons'

const peerSignal = createSignal<unknown>(undefined)
const fullPeerSignal = createSignal<unknown>(undefined)
vi.mock('../stores/peers.solid', () => ({ usePeer: () => peerSignal[0] }))
vi.mock('../stores/fullPeers.solid', () => ({ useFullPeer: () => fullPeerSignal[0] }))

let meId: number | null = 1
vi.mock('../stores/chatsStore', () => ({
  useChatsStore: {
    getState: () => ({ meId, dialogs: [] as unknown[] }),
    subscribe: () => () => {},
  },
}))

vi.mock('../core/profilePhoneCache', () => ({
  cachedProfilePhone: () => undefined,
  subscribeProfilePhoneMirror: () => () => {},
  profilePhoneMirrorVersion: () => 0,
}))

const setMuteSpy = vi.fn()
vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { groups: { setMute: setMuteSpy } } }),
}))

const { default: PeerProfile } = await import('./peerProfile.solid')

let dispose: (() => void) | undefined
const el = () => document.createElement('div')

function mount(props: Record<string, unknown>) {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <PeerProfile {...(props as Parameters<typeof PeerProfile>[0])} />, host)
  return host
}

function rowByIcon(host: HTMLElement, icon: IconName): HTMLElement | null {
  const g = glyph(icon)
  const span = Array.from(host.querySelectorAll<HTMLElement>('.row-icon')).find((s) => s.textContent === g)
  return (span?.closest('.row') as HTMLElement | null) ?? null
}

const baseProps = { peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() }

afterEach(() => {
  dispose?.()
  dispose = undefined
  meId = 1
  peerSignal[1](undefined)
  fullPeerSignal[1](undefined)
  setMuteSpy.mockClear()
})

describe('Statistics — порт chat/topbar.ts:664 (пункт меню топбара, у нас — строка профиля)', () => {
  it('показывается при showStatistics и зовёт onOpenStatistics по клику', () => {
    const onOpenStatistics = vi.fn()
    const h = mount({ ...baseProps, showStatistics: true, onOpenStatistics })
    const row = rowByIcon(h, 'statistics')
    expect(row).not.toBeNull()
    row!.click()
    expect(onOpenStatistics).toHaveBeenCalledTimes(1)
  })

  it('не показывается без showStatistics', () => {
    const h = mount({ ...baseProps, showStatistics: false })
    expect(rowByIcon(h, 'statistics')).toBeNull()
  })
})

describe('Discussion — порт editChat.tsx:362 (строка вкладки редактирования, у нас — строка профиля)', () => {
  it('не показывается без showDiscussion', () => {
    const h = mount({ ...baseProps, showDiscussion: false, discussionPeerId: 0 })
    expect(rowByIcon(h, 'comments')).toBeNull()
  })

  it('«Enable discussion»: показывается при discussionPeerId===0, зовёт onEnableDiscussion по клику', () => {
    const onEnableDiscussion = vi.fn()
    const h = mount({ ...baseProps, showDiscussion: true, discussionPeerId: 0, onEnableDiscussion })
    const row = rowByIcon(h, 'comments')
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('Enable discussion')
    row!.click()
    expect(onEnableDiscussion).toHaveBeenCalledTimes(1)
  })

  it('«Enable discussion» гасит клик, пока enablingDiscussion', () => {
    const onEnableDiscussion = vi.fn()
    const h = mount({ ...baseProps, showDiscussion: true, discussionPeerId: 0, enablingDiscussion: true, onEnableDiscussion })
    const row = rowByIcon(h, 'comments')!
    row.click()
    expect(onEnableDiscussion).not.toHaveBeenCalled()
  })

  it('«Discussion enabled»: показывается при ЗНАКОВОМ discussionPeerId !== 0, без клика', () => {
    const h = mount({ ...baseProps, showDiscussion: true, discussionPeerId: -100 })
    const row = rowByIcon(h, 'comments')
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('Discussion enabled')
  })
})

describe('JoinRequests — порт editChat.tsx:227 + плашка chat/requests.tsx (у нас — список в профиле)', () => {
  it('не показывается без showJoinRequests', () => {
    const h = mount({ ...baseProps, showJoinRequests: false, joinRequests: [{ userId: 1, title: 'Alice' }] })
    expect(h.textContent).not.toContain('Alice')
  })

  it('не показывается при пустом joinRequests', () => {
    const h = mount({ ...baseProps, showJoinRequests: true, joinRequests: [] })
    expect(h.querySelector('.avatar')).toBeNull()
  })

  it('показывает строку заявки (аватар-инициал + имя) и зовёт onApprove/onDeclineJoinRequest с userId', () => {
    const onApproveJoinRequest = vi.fn()
    const onDeclineJoinRequest = vi.fn()
    const h = mount({
      ...baseProps,
      showJoinRequests: true,
      joinRequests: [{ userId: 42, title: 'Alice' }],
      onApproveJoinRequest,
      onDeclineJoinRequest,
    })
    expect(h.querySelector('.avatar')!.textContent).toBe('A')
    expect(h.textContent).toContain('Alice')
    const buttons = Array.from(h.querySelectorAll('.row-right button'))
    expect(buttons).toHaveLength(2)
    ;(buttons[0] as HTMLElement).click()
    expect(onApproveJoinRequest).toHaveBeenCalledWith(42)
    ;(buttons[1] as HTMLElement).click()
    expect(onDeclineJoinRequest).toHaveBeenCalledWith(42)
  })
})

describe('EncryptionKey — у tweb предмета нет вовсе (секретных чатов не существует)', () => {
  it('показывается при isSecret и зовёт onOpenEncryptionKey по клику', () => {
    const onOpenEncryptionKey = vi.fn()
    const h = mount({ ...baseProps, isSecret: true, onOpenEncryptionKey })
    const row = rowByIcon(h, 'key')
    expect(row).not.toBeNull()
    row!.click()
    expect(onOpenEncryptionKey).toHaveBeenCalledTimes(1)
  })

  it('не показывается без isSecret', () => {
    const h = mount({ ...baseProps, isSecret: false })
    expect(rowByIcon(h, 'key')).toBeNull()
  })
})
