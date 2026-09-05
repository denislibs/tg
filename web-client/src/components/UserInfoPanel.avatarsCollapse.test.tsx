// Задача 5 (docs/superpowers/plans/2026-09-05-profile-avatars-class.md) —
// проводка «панель ↔ PeerProfileAvatars ↔ useCollapsable» внутри
// `UserInfoPanel.tsx`. Сама панель нерендерибельна в vitest (тянет портал,
// менеджеры и полдюжины сторов — то же основание, что у `UserInfoPanel.
// shell.test.ts`), поэтому здесь — узкий ХАРНЕСС, воспроизводящий БУКВАЛЬНО
// ТУ ЖЕ форму вызовов, что и панель (`useCollapsable` → `useImperativeIsland`
// → эффект `folded → setCollapsed`, тот же порядок хуков и тот же гейт
// `hasPhoto`): `UserInfoPanel.shell.test.ts` пином на шов (баланс скобок)
// проверяет, что РЕАЛЬНЫЙ файл вызывает класс и убирает его именно так, а
// этот файл проверяет, что ЭТА ФОРМА, если она на месте, реально работает —
// разворачивается/сворачивается колесом, гасится гейтом «нет фото», и не
// переживает размонтирование.
//
// `useImperativeIsland` (мост host+strays) уже покрыт своими тестами
// (`useImperativeIsland.test.tsx`) — здесь его механику НЕ передоказываем,
// только композицию с классом. `useCollapsable` (колесо/свайп/скролл) — тоже
// свой файл (`useCollapsable.test.tsx`) — здесь важно только то, что панель
// СВЯЗЫВАЕТ его `folded`/`unfold`/`fold` с классом, а не то, что хук вообще
// умеет считать колесо.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { useImperativeIsland } from '../core/hooks/useImperativeIsland'
import useCollapsable from '../core/hooks/useCollapsable'
import type { PeerProfileAvatarsManagers } from './peerProfileAvatars'
import { shouldForceFold } from './userInfo/helpers'

// Тот же приём, что в `peerProfileAvatars.test.ts`: конструктор класса создаёт
// IntersectionObserver синхронно, а happy-dom его не знает — стаб ДО импорта
// класса (динамический import ниже исполняется ПОСЛЕ vi.stubGlobal).
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

vi.mock('@core/media/ensureMediaUrl', () => ({ ensureMediaUrl: vi.fn(async (id: number) => `blob:media-${id}`) }))
vi.mock('@core/mediaUrl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/mediaUrl')>()),
  resolveStreamUrl: vi.fn((id: number) => `blob:video-${id}`),
}))

const { default: PeerProfileAvatars } = await import('./peerProfileAvatars')

const PEER_WITH_PHOTO = 901
const PEER_NO_PHOTO = 902

function makeManagers(): PeerProfileAvatarsManagers {
  return {
    peers: { fillMirror: vi.fn(async () => {}) },
    profile: { listPhotos: vi.fn(async () => []) },
  }
}

/**
 * Харнесс — ТА ЖЕ форма вызовов, что `UserInfoPanel.tsx` (собрана вручную из
 * тех же трёх кусков: реальный `useCollapsable()`, `useImperativeIsland` с
 * `host`+`strays`, эффект `folded → setCollapsed` с гейтом `hasPhoto`). Если
 * когда-нибудь эта форма разъедется с панелью — обязанность синхронизировать
 * их у ревью задачи 5 и любых будущих правок обоих файлов; шов в самой панели
 * пинует `UserInfoPanel.shell.test.ts` балансом скобок.
 */
function Harness({ peerId, managers }: { peerId: number; managers: PeerProfileAvatarsManagers }) {
  const avatarsRef = useRef<InstanceType<typeof PeerProfileAvatars> | null>(null)
  const setCollapsedOnRef = useRef<HTMLDivElement>(null)
  const scrollableRef = useRef<HTMLDivElement>(null)
  const avatarsHostRef = useRef<HTMLDivElement>(null)

  const { folded, unfold, fold } = useCollapsable({
    scrollable: () => scrollableRef.current,
    listenWheelOn: () => setCollapsedOnRef.current,
    container: () => avatarsRef.current?.container ?? null,
  })

  useImperativeIsland((container) => {
    const instance = new PeerProfileAvatars({
      managers,
      setCollapsedOn: setCollapsedOnRef.current!,
      scrollableEl: scrollableRef.current!,
      unfold,
    })
    avatarsRef.current = instance
    container.appendChild(instance.container)
    void instance.setPeer(peerId)
    return () => {
      instance.cleanup()
      avatarsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [], { host: avatarsHostRef, strays: '.profile-avatars-container' })

  useLayoutEffect(() => {
    const instance = avatarsRef.current
    if (!instance) return
    if (shouldForceFold(instance.hasPhoto, folded)) {
      fold()
      return
    }
    instance.setCollapsed(folded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folded])

  return (
    <div>
      <div data-testid="setCollapsedOn" ref={setCollapsedOnRef} />
      <div data-testid="scrollable" ref={scrollableRef} />
      <div data-testid="host" ref={avatarsHostRef} />
    </div>
  )
}

function Mount({ peerId, managers, mounted }: { peerId: number; managers: PeerProfileAvatarsManagers; mounted: boolean }) {
  return mounted ? <Harness peerId={peerId} managers={managers} /> : null
}

const wheelUp = (el: HTMLElement) => {
  const e = new WheelEvent('wheel', { cancelable: true })
  Object.defineProperty(e, 'wheelDeltaY', { value: 120 })
  el.dispatchEvent(e)
}
const wheelDown = (el: HTMLElement) => {
  const e = new WheelEvent('wheel', { cancelable: true })
  Object.defineProperty(e, 'wheelDeltaY', { value: -120 })
  el.dispatchEvent(e)
}

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([
    { op: 'upsert', peers: [{ _: 'user', id: PEER_WITH_PHOTO, first_name: 'Alice', pFlags: {}, photo: { _: 'userProfilePhoto', photo_id: 42 } }] },
    { op: 'upsert', peers: [{ _: 'user', id: PEER_NO_PHOTO, first_name: 'Ghost', pFlags: {} }] },
  ])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UserInfoPanel — проводка PeerProfileAvatars ↔ useCollapsable (задача 5)', () => {
  it('пир с фото: старт свёрнут, колесо вверх при scrollTop=0 разворачивает, колесо вниз сворачивает обратно', async () => {
    const managers = makeManagers()
    const { getByTestId } = render(<Harness peerId={PEER_WITH_PHOTO} managers={managers} />)
    const setCollapsedOn = getByTestId('setCollapsedOn')
    const scrollable = getByTestId('scrollable')

    // Старт — свёрнуто (tweb :310, this.setCollapsed(true) в конструкторе;
    // у нас — useCollapsable STATE_FOLDED начальным + эффект).
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(true)

    scrollable.scrollTop = 0
    act(() => wheelUp(setCollapsedOn))
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(false)

    act(() => wheelDown(setCollapsedOn))
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(true)
  })

  it('прокрутка (scrollTop > 0) сворачивает НЕМЕДЛЕННО — без ожидания повторного колеса', async () => {
    const managers = makeManagers()
    const { getByTestId } = render(<Harness peerId={PEER_WITH_PHOTO} managers={managers} />)
    const setCollapsedOn = getByTestId('setCollapsedOn')
    const scrollable = getByTestId('scrollable')

    act(() => wheelUp(setCollapsedOn)) // разворачиваем
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(false)

    // useCollapsable.onMove: scrollTop && progress !== STATE_FOLDED → fold немедленно,
    // даже жестом «вверх» (который иначе развернул бы).
    scrollable.scrollTop = 50
    act(() => wheelUp(setCollapsedOn))
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(true)
  })

  // ОБЯЗАТЕЛЬНОЕ покрытие брифа задачи 5 (гейт tweb :341-344, `hasNoPhoto &&
  // !folded() → fold()`, портированный ЦЕЛИКОМ): пир БЕЗ фото не
  // разворачивается колесом — без гейта шапка развернулась бы в пустоту.
  it('пир БЕЗ фото не разворачивается колесом (гейт tweb :341-344 через геттер hasPhoto)', async () => {
    const managers = makeManagers()
    const { getByTestId } = render(<Harness peerId={PEER_NO_PHOTO} managers={managers} />)
    const setCollapsedOn = getByTestId('setCollapsedOn')
    const scrollable = getByTestId('scrollable')

    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(true)

    scrollable.scrollTop = 0
    act(() => wheelUp(setCollapsedOn))

    // useCollapsable САМ по себе флипнул бы folded в false — гейт панели
    // обязан немедленно вернуть его в true через fold().
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(true)
  })

  it('размонтирование: узел класса уходит из DOM, событие после — no-op (слушатели сняты)', async () => {
    const managers = makeManagers()
    const { getByTestId, rerender } = render(<Mount peerId={PEER_WITH_PHOTO} managers={managers} mounted={true} />)
    const host = getByTestId('host')
    expect(host.querySelector('.profile-avatars-container')).not.toBeNull()

    const setCollapsedOnBefore = getByTestId('setCollapsedOn')
    act(() => wheelUp(setCollapsedOnBefore)) // разворачиваем — есть что сломать снятием класса
    expect(setCollapsedOnBefore.classList.contains('is-collapsed')).toBe(false)

    rerender(<Mount peerId={PEER_WITH_PHOTO} managers={managers} mounted={false} />)

    expect(host.querySelector('.profile-avatars-container')).toBeNull()
    // Узел вкладки тоже размонтирован вместе со всем харнессом — клик/колесо
    // по отсоединённому узлу ничего не бросает и ни на что не влияет.
    expect(() => wheelUp(setCollapsedOnBefore)).not.toThrow()
    expect(setCollapsedOnBefore.isConnected).toBe(false)
  })
})
