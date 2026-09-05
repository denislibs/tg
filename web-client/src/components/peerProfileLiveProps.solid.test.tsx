/** @jsxImportSource solid-js */
/**
 * Поведенческий пин Critical-находки финального ревью ветки «карточка
 * профиля на Solid» (`peerProfile.solid.tsx::createPeerProfileContextValue`):
 * гейты/данные/колбэки задачи 5 (`showStatistics`/`showDiscussion`/
 * `joinRequests`/`isSecret`, плюс `onOpenQrCode` и три колбэка) обязаны
 * доезжать до секций дерева ПОСЛЕ первого рендера — реальный первый кадр
 * монтируется в layout-фазе `UserInfoPanel.tsx`, задолго до ответа
 * `useGroupInfo` (сетевой поход), поэтому первое значение этих пропов —
 * всегда `false`/`undefined`/`[]`, а обновление приходит ПОЗЖЕ, через
 * `update(patch)` моста `mountSolid`.
 *
 * ── Почему существующие пины эту дыру пропустили ────────────────────────────
 * Каждый — по своей причине, и ни один не проверяет ИМЕННО путь «мост →
 * контекст → секция»:
 *  - `peerProfileMisplacedSections.solid.test.tsx` монтирует `PeerProfile`
 *    напрямую (`solid-js/web::render`), МИНУЯ мост `mountSolid`. Все пропы
 *    там статичны с первого кадра — `value.x = props.x`, скопированный
 *    СНИМКОМ в момент маунта, и `props.x`, прочитанный МОСТОМ уже после
 *    маунта, в этом сценарии просто совпадают: второго значения никогда не
 *    приходит, поэтому баг «поле вместо геттера» там физически невидим;
 *  - `mountSolid.solid.test.tsx` проверяет САМ мост на компоненте-пробе без
 *    контекста и геттеров — что патч долетает до `props` стора, а не то,
 *    что происходит ДАЛЬШЕ внутри `createPeerProfileContextValue`;
 *  - `UserInfoPanel.shell.test.ts` — текстовый (грепает исходник панели на
 *    то, что она ЗОВЁТ `update` с нужными полями), поведения самого
 *    Solid-дерева не видит вовсе.
 *
 * Этот файл монтирует НАСТОЯЩИЙ `PeerProfile` ЧЕРЕЗ `mountSolid` (тот же
 * мост, которым его монтирует `UserInfoPanel.tsx`), начинает БЕЗ гейтов
 * задачи 5 (как реальный первый кадр) и зовёт `update(patch)` — секции
 * обязаны появиться в DOM. Мутация «вернуть `x: props.x` вместо
 * `get x() { return props.x }`» в `createPeerProfileContextValue` обязана
 * покраснить каждый `it` ниже.
 *
 * Мок-слой скопирован с `peerProfileMisplacedSections.solid.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSignal } from 'solid-js'
import { mountSolid } from '../shared/solid/mountSolid.solid'
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

vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { groups: { setMute: vi.fn() } } }),
}))

const { default: PeerProfile } = await import('./peerProfile.solid')
type Props = Parameters<typeof PeerProfile>[0]

function rowByIcon(host: HTMLElement, icon: IconName): HTMLElement | null {
  const g = glyph(icon)
  const span = Array.from(host.querySelectorAll<HTMLElement>('.row-icon')).find((s) => s.textContent === g)
  return (span?.closest('.row') as HTMLElement | null) ?? null
}

let dispose: (() => void) | undefined
const el = () => document.createElement('div')
const baseProps: Props = { peerId: 7, isDialog: true, scrollable: el(), setCollapsedOn: el() }

function mountBridge(props: Props) {
  const host = document.createElement('div')
  document.body.append(host)
  const bridge = mountSolid(host, PeerProfile, props)
  dispose = bridge.dispose
  return { host, update: bridge.update }
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  meId = 1
  peerSignal[1](undefined)
  fullPeerSignal[1](undefined)
})

describe('Живые пропы моста mountSolid доезжают до PeerProfile (Critical, финальный раунд волны)', () => {
  it('Statistics: отсутствует на первом кадре, появляется в DOM после update({showStatistics: true}) и зовёт СВЕЖИЙ onOpenStatistics', () => {
    const { host, update } = mountBridge({ ...baseProps })
    expect(rowByIcon(host, 'statistics'), 'первый кадр — гейта ещё нет, как в проде до ответа useGroupInfo').toBeNull()

    const onOpenStatistics = vi.fn()
    update({ showStatistics: true, onOpenStatistics })

    const row = rowByIcon(host, 'statistics')
    expect(row, 'мутация: снимок вместо геттера — секция навсегда осталась бы скрытой').not.toBeNull()
    row!.click()
    expect(onOpenStatistics).toHaveBeenCalledTimes(1)
  })

  it('Discussion: появляется в DOM после update({showDiscussion, discussionPeerId})', () => {
    const { host, update } = mountBridge({ ...baseProps })
    expect(rowByIcon(host, 'comments')).toBeNull()

    update({ showDiscussion: true, discussionPeerId: 0 })

    const row = rowByIcon(host, 'comments')
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('Enable discussion')
  })

  it('Discussion: колбэк onEnableDiscussion, доехавший ПОЗЖЕ update, а не первым кадром (снимок замкнул бы undefined)', () => {
    const { host, update } = mountBridge({ ...baseProps, showDiscussion: true, discussionPeerId: 0 })
    const onEnableDiscussion = vi.fn()

    update({ onEnableDiscussion })

    rowByIcon(host, 'comments')!.click()
    expect(onEnableDiscussion).toHaveBeenCalledTimes(1)
  })

  it('JoinRequests: список появляется в DOM после update({showJoinRequests, joinRequests}) и одобрение зовёт СВЕЖИЙ колбэк', () => {
    const { host, update } = mountBridge({ ...baseProps })
    expect(host.textContent).not.toContain('Alice')

    const onApproveJoinRequest = vi.fn()
    const onDeclineJoinRequest = vi.fn()
    update({
      showJoinRequests: true,
      joinRequests: [{ userId: 42, title: 'Alice' }],
      onApproveJoinRequest,
      onDeclineJoinRequest,
    })

    expect(host.textContent).toContain('Alice')
    const buttons = Array.from(host.querySelectorAll<HTMLElement>('.row-right button'))
    expect(buttons).toHaveLength(2)
    buttons[0].click()
    expect(onApproveJoinRequest).toHaveBeenCalledWith(42)
    buttons[1].click()
    expect(onDeclineJoinRequest).toHaveBeenCalledWith(42)
  })

  it('EncryptionKey: появляется в DOM после update({isSecret: true}) и зовёт СВЕЖИЙ onOpenEncryptionKey', () => {
    const { host, update } = mountBridge({ ...baseProps })
    expect(rowByIcon(host, 'key')).toBeNull()

    const onOpenEncryptionKey = vi.fn()
    update({ isSecret: true, onOpenEncryptionKey })

    const row = rowByIcon(host, 'key')
    expect(row).not.toBeNull()
    row!.click()
    expect(onOpenEncryptionKey).toHaveBeenCalledTimes(1)
  })

  it('onOpenQrCode: QR-строка зовёт ОБНОВЛЁННЫЙ колбэк, а не тот, что был на первом маунте', () => {
    peerSignal[1]({ _: 'user', id: 7, username: 'durov' })
    const firstOpenQrCode = vi.fn()
    const { host, update } = mountBridge({ ...baseProps, onOpenQrCode: firstOpenQrCode })

    const secondOpenQrCode = vi.fn()
    update({ onOpenQrCode: secondOpenQrCode })

    const row = rowByIcon(host, 'username')!
    const qr = row.querySelector('button.qr') as HTMLElement
    expect(qr).not.toBeNull()
    qr.click()

    expect(secondOpenQrCode).toHaveBeenCalledTimes(1)
    expect(firstOpenQrCode).not.toHaveBeenCalled()
  })
})
