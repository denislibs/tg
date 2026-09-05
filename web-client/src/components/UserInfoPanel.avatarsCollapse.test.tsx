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
//
// РЕВЬЮ ЗАДАЧИ 5 (Critical, раунд правок 3): `setCollapsedOnRef`-узел держит
// ДВУХ писателей классов — класс `PeerProfileAvatars` (`classList.toggle`,
// мимо React) и панельную половину `header-filled` (tweb sharedMedia.tsx).
// ПРЕЖДЕ панель писала свою половину через `classNames()` в JSX — а React
// не мержит атрибут: при смене ВЫЧИСЛЕННОЙ строки `className` он
// присваивает `node.className` ЦЕЛИКОМ, стирая всё, что выставил не он
// (is-collapsed/need-white/половину класса). Харнесс ниже держит
// `headerFilled` ПРОПОМ и применяет его тем же `classList.toggle`, что и
// класс, — единственный писатель-механизм для ВСЕХ владельцев узла (правило
// проекта: «узлом владеет тот, кто решает, когда узел меняется»). Тест
// «Critical (находка ревью)» ниже прогнан МУТАЦИЕЙ харнесса ДО фикса (JSX
// classNames() вместо classList.toggle — see review, red) — числа в теле
// коммита.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useEffect, useLayoutEffect, useRef } from 'react'
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
// Второй пир С фото — для теста «смена пира С фото → С фото» (нужен ДРУГОЙ
// peerId, иначе deps `[peerId]` эффектов не изменятся и смена не произойдёт).
const PEER_WITH_PHOTO_2 = 903

function makeManagers(): PeerProfileAvatarsManagers {
  return {
    peers: { fillMirror: vi.fn(async () => {}) },
    profile: { listPhotos: vi.fn(async () => []) },
  }
}

/**
 * Харнесс — ТА ЖЕ форма вызовов, что `UserInfoPanel.tsx` (собрана вручную из
 * тех же шести кусков: реальный `useCollapsable()`, `useImperativeIsland` с
 * `host`+`strays`, `setPeer` в СВОЁМ эффекте по deps `[peerId]`, сброс
 * свёрнутости на смену `[peerId]`, эффект `folded → setCollapsed` с гейтом
 * `hasPhoto`, и — после находки ревью Critical — ВТОРОЙ писатель классов на
 * ТОМ ЖЕ узле, `headerFilled` (панельная половина `header-filled`, tweb
 * sharedMedia.tsx), применяемый ТЕМ ЖЕ `classList.toggle`, а не пересчётом
 * `className` в JSX).
 * Если когда-нибудь эта форма разъедется с панелью — обязанность
 * синхронизировать их у ревью задачи 5 и любых будущих правок обоих файлов;
 * шов в самой панели пинует `UserInfoPanel.shell.test.ts` балансом скобок.
 *
 * НАХОДКА ФИНАЛЬНОГО РЕВЬЮ ВЕТКИ (Important, п.1): раньше `setPeer` звался
 * ВНУТРИ создания острова (deps `[]`) — путь смены пира харнессу был
 * недостижим, потому что смена пропа `peerId` у уже смонтированного
 * `Harness` ничего не перегружала. Приведено к форме панели: `setPeer` —
 * в своём эффекте по deps `[peerId]` (как в `UserInfoPanel.tsx`), и туда же
 * добавлен сброс свёрнутости, который панель раньше не делала вовсе (сам
 * баг) — см. коммент у соответствующего эффекта ниже.
 */
function Harness({ peerId, managers, headerFilled = false }: { peerId: number; managers: PeerProfileAvatarsManagers; headerFilled?: boolean }) {
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
    return () => {
      instance.cleanup()
      avatarsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [], { host: avatarsHostRef, strays: '.profile-avatars-container' })

  // ФОРМА ПАНЕЛИ (`UserInfoPanel.tsx`): смена пира — тот же инстанс класса
  // просто перегружает ленту (докблок `setPeer` в `peerProfileAvatars.ts`).
  useEffect(() => {
    void avatarsRef.current?.setPeer(peerId)
  }, [peerId])

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

  // ФОРМА ПАНЕЛИ: находка финального ревью ветки (Important, п.1) — tweb
  // создаёт под КАЖДОГО пира новый инстанс `PeerProfileAvatars`, и последняя
  // строка его конструктора — `this.setCollapsed(true)` (tweb :309): новый
  // пир ВСЕГДА открывается свёрнутым, гейт «нет фото» пересчитывается заново
  // на свежем инстансе. У нас инстанс переживает смену пира, поэтому
  // свёрнутость сама себя не восстанавливает — без этого эффекта развёрнутая
  // шапка пира С фото пережила бы переключение на пира БЕЗ фото (клик её при
  // этом не сворачивает — гейт `!this.currentHasPhoto` в клик-хендлере класса
  // гасит клик целиком). `fold()` возвращает `useCollapsable()` к исходному
  // `folded=true`; `instance.setCollapsed(true)` применяет ЭТО же немедленно
  // — если `folded` уже был `true`, `fold()` не меняет состояние и эффект
  // `[folded]` выше не переиграется сам по себе, поэтому DOM обновляем здесь
  // напрямую, а не полагаемся на реакцию на смену `folded`. Порядок
  // деклараций (после эффекта `[folded]`) не влияет на поведение — как и в
  // `UserInfoPanel.tsx`, эффекты реагируют на СВОИ deps независимо от
  // порядка объявления.
  useLayoutEffect(() => {
    const instance = avatarsRef.current
    if (!instance) return
    fold()
    instance.setCollapsed(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId])

  // Задача 5, находка ревью (Critical): ВТОРОЙ писатель классов на ЭТОМ ЖЕ
  // узле — панельная половина `header-filled` — идёт ТЕМ ЖЕ механизмом,
  // `classList.toggle`, что и класс выше. Если бы вместо этого JSX
  // ПЕРЕСЧИТЫВАЛ `className` строкой (`classNames('profile-container',
  // headerFilled ? 'header-filled' : '')`), React при смене `headerFilled`
  // присвоил бы `node.className` ЦЕЛИКОМ и стёр `is-collapsed`/`need-white`,
  // выставленные классом мимо React, — именно так и было устроено ДО этой
  // находки в `UserInfoPanel.tsx` (см. коммент у `setCollapsedOnRef` там же).
  useLayoutEffect(() => {
    const el = setCollapsedOnRef.current
    if (!el) return
    el.classList.toggle('header-filled', headerFilled)
  }, [headerFilled])

  return (
    <div>
      <div data-testid="setCollapsedOn" ref={setCollapsedOnRef} className="profile-container" />
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
    { op: 'upsert', peers: [{ _: 'user', id: PEER_WITH_PHOTO_2, first_name: 'Bob', pFlags: {}, photo: { _: 'userProfilePhoto', photo_id: 43 } }] },
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

  // CRITICAL (находка ревью задачи 5): `setCollapsedOnRef` держит ДВУХ
  // писателей классов — класс `PeerProfileAvatars` (classList.toggle,
  // is-collapsed/need-white/свою половину header-filled) и панель
  // (header-filled — свою половину). Мутация харнесса на ЭТОМ тесте (JSX
  // classNames() вместо classList.toggle для headerFilled) даёт RED —
  // транскрипт в теле коммита.
  it('CRITICAL: смена headerFilled (панельная половина header-filled) НЕ стирает is-collapsed класса', async () => {
    const managers = makeManagers()
    const { getByTestId, rerender } = render(
      <Harness peerId={PEER_WITH_PHOTO} managers={managers} headerFilled={false} />,
    )
    const setCollapsedOn = getByTestId('setCollapsedOn')

    // Старт — свёрнуто (тот же факт, что и в других тестах файла).
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(true)
    expect(setCollapsedOn.classList.contains('header-filled')).toBe(false)

    // Имитация «доскроллили до табов sharedMedia» — панельная половина
    // header-filled взводится (tweb sharedMedia.tsx:513). Ре-рендер с НОВЫМ
    // пропом — ровно то, что раньше происходило при пересчёте classNames()
    // в JSX того же узла.
    act(() => {
      rerender(<Harness peerId={PEER_WITH_PHOTO} managers={managers} headerFilled={true} />)
    })

    expect(setCollapsedOn.classList.contains('header-filled')).toBe(true) // панельная половина применилась
    // is-collapsed выставлен КЛАССОМ, не панелью, — панельный ре-рендер не
    // имеет права его тронуть (единственный писатель — classList.toggle).
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(true)
  })

  // НАХОДКА ФИНАЛЬНОГО РЕВЬЮ ВЕТКИ (Important, п.1): смена пира обязана
  // вернуть шапку в свёрнутое состояние — так же, как в tweb новый пир
  // получает НОВЫЙ инстанс класса, чей конструктор оканчивается
  // `this.setCollapsed(true)` (tweb :309). До фикса `UserInfoPanel.tsx`
  // (и харнесса) переключение пира просто перегружало ленту, не трогая
  // `useCollapsable()` — развёрнутая шапка пережила бы смену пира. RED-
  // транскрипт ДО фикса — в теле коммита.
  it('смена пира (С фото → С фото): развёрнутая шапка возвращается в свёрнутое состояние', async () => {
    const managers = makeManagers()
    const { getByTestId, rerender } = render(<Harness peerId={PEER_WITH_PHOTO} managers={managers} />)
    const setCollapsedOn = getByTestId('setCollapsedOn')
    const scrollable = getByTestId('scrollable')

    scrollable.scrollTop = 0
    act(() => wheelUp(setCollapsedOn)) // разворачиваем пира С фото
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(false)

    act(() => {
      rerender(<Harness peerId={PEER_WITH_PHOTO_2} managers={managers} />)
    })

    // tweb: КАЖДЫЙ новый пир открывается свёрнутым, вне зависимости от того,
    // была ли развёрнута шапка прежнего.
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(true)
  })

  // НАХОДКА ФИНАЛЬНОГО РЕВЬЮ ВЕТКИ (Important, п.1), воспроизведение из
  // брифа буквально: развернули пира С фото → переключили на пира БЕЗ фото →
  // ожидаем `is-collapsed` вернувшимся И гейт «нет фото» перепроверенным
  // (колесом развернуть НЕЛЬЗЯ). До фикса шапка осталась бы развёрнутой с
  // кружком-инициалами, а клик/колесо её не сворачивали (гейт `!hasPhoto` в
  // клик-хендлере класса гасит клик целиком, эффект `[folded]` не переигрывался
  // сам по себе, потому что `folded` не менялся).
  it('смена пира (С фото → БЕЗ фото): is-collapsed возвращается и гейт «нет фото» не даёт развернуть колесом', async () => {
    const managers = makeManagers()
    const { getByTestId, rerender } = render(<Harness peerId={PEER_WITH_PHOTO} managers={managers} />)
    const setCollapsedOn = getByTestId('setCollapsedOn')
    const scrollable = getByTestId('scrollable')

    scrollable.scrollTop = 0
    act(() => wheelUp(setCollapsedOn)) // разворачиваем пира С фото
    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(false)

    act(() => {
      rerender(<Harness peerId={PEER_NO_PHOTO} managers={managers} />)
    })

    expect(setCollapsedOn.classList.contains('is-collapsed')).toBe(true)

    scrollable.scrollTop = 0
    act(() => wheelUp(setCollapsedOn)) // попытка развернуть колесом пира БЕЗ фото
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
