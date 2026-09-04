/** @jsxImportSource solid-js */
/**
 * Поведенческие пины `mountAuthFlow.solid.tsx` (находка 1 ревью задачи 6):
 * прогон существующих тестов оставался зелёным даже после того, как ревьюер
 * вырезал из устройства `document.body.classList.add('has-auth-pages')` и
 * `dispose(); root.remove()` — ни один пин не смотрел на само устройство
 * монтирования. Отказ, который это пропускает: после logout→login
 * `#auth-flow-root` остаётся в `body` с живым Solid-корнем (утечка DOM и
 * реактивного графа), а `.main-column` анимируется на первом кадре
 * мессенджера (см. докблок `mountAuthFlow.solid.tsx`, «has-auth-pages»).
 *
 * `AuthCardsHost.solid` замокан минимальным маркером: предмет ЭТОГО файла —
 * устройство монтирования (узел/класс/dispose/стартовый шаг), а не рендер
 * настоящих карточек — тот предмет уже держат `AuthCardsHost.solid.test.tsx`
 * и тесты самих карточек. Мок заодно ловит пятый факт бонусом: пропы
 * (managers/onComplete) долетают до хоста, не теряясь по дороге.
 *
 * ── Повторное ревью, ОБЯЗАТЕЛЬНО 2: снятие Solid-корня было не запинено ────
 * Первая редакция мокала хост ГОЛЫМ DOM-узлом без `onCleanup` — снимать
 * внутри Solid-дерева было нечего, поэтому мутация «вырезать ТОЛЬКО
 * `dispose()`, оставить `root.remove()`» оставалась зелёной: `root.remove()`
 * убирает узел из `document` сам по себе, а утечка РЕАКТИВНОГО ГРАФА (то, что
 * этот файл заявляет своим предметом в первом абзаце) снаружи никак не видна
 * без явного наблюдателя. Мок теперь регистрирует `onCleanup` — точно как
 * это делают настоящие карточки (`SignQRCard.solid.tsx` и другие снимают
 * таймеры тем же примитивом); `cleanupCalled.count` — единственный способ
 * снаружи отличить «Solid реально снял корень» от «DOM-узел вынули из
 * документа, а реактивный граф хоста жив вечно».
 *
 * `vi.resetModules()` + динамические импорты — тот же приём, что у
 * `AuthCardsHost.solid.test.tsx`: `authFlow.solid` держит МОДУЛЬНЫЙ сигнал
 * `currentCard`, и тест на стартовый шаг должен видеть тот же экземпляр
 * модуля, что использует `mountAuthFlow` изнутри.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onCleanup } from 'solid-js'
import type { Managers } from '@/client/bootstrap'

let mountAuthFlow: typeof import('./mountAuthFlow.solid').mountAuthFlow
let currentCard: typeof import('./authFlow.solid').currentCard

// `vi.mock` хоистится над импортами — переменная, которую читает и пишет
// фабрика, обязана родиться ДО хойста, иначе `ReferenceError` (тот же приём,
// что у `emailPattern.solid.test.tsx::spies`). `onCleanup` — обычный импорт
// `solid-js`, а не часть мокаемого модуля, поэтому хойстинг его не касается:
// фабрика `vi.mock` физически выполняется позже, при динамическом импорте в
// `beforeEach`, когда все обычные импорты файла уже вычислены.
const receivedProps = vi.hoisted(() => [] as unknown[])
const cleanupCalled = vi.hoisted(() => ({ count: 0 }))

vi.mock('./AuthCardsHost.solid', () => ({
  default: (props: unknown) => {
    receivedProps.push(props)
    onCleanup(() => { cleanupCalled.count++ })
    const marker = document.createElement('div')
    marker.setAttribute('data-testid', 'mock-auth-cards-host')
    return marker
  },
}))

beforeEach(async () => {
  vi.resetModules()
  receivedProps.length = 0
  cleanupCalled.count = 0
  ;({ mountAuthFlow } = await import('./mountAuthFlow.solid'))
  ;({ currentCard } = await import('./authFlow.solid'))
})

afterEach(() => {
  document.getElementById('auth-flow-root')?.remove()
  document.body.classList.remove('has-auth-pages')
  location.hash = ''
})

function mock() {
  return { managers: {} as Managers, onComplete: vi.fn() }
}

describe('mountAuthFlow: узел монтирования', () => {
  it('вешает #auth-flow-root на body как display:contents', () => {
    const dispose = mountAuthFlow(mock())

    const root = document.getElementById('auth-flow-root')
    expect(root).not.toBeNull()
    expect(root!.parentElement).toBe(document.body)
    expect(root!.style.display).toBe('contents')
    // Хост реально смонтирован ВНУТРИ узла — не рядом с ним.
    expect(root!.querySelector('[data-testid="mock-auth-cards-host"]')).not.toBeNull()

    dispose()
  })

  it('пропы (managers/onComplete) долетают до AuthCardsHost как есть', () => {
    const props = mock()
    const dispose = mountAuthFlow(props)

    expect(receivedProps).toHaveLength(1)
    expect(receivedProps[0]).toMatchObject({ managers: props.managers, onComplete: props.onComplete })

    dispose()
  })
})

describe('mountAuthFlow: has-auth-pages', () => {
  it('ставится синхронно при монтировании', () => {
    expect(document.body.classList.contains('has-auth-pages')).toBe(false)
    const dispose = mountAuthFlow(mock())
    expect(document.body.classList.contains('has-auth-pages')).toBe(true)
    dispose()
  })
})

describe('mountAuthFlow: dispose', () => {
  it('снимает узел, класс И реактивный граф хоста (onCleanup) — иначе экран входа переживает собственный уход', async () => {
    const dispose = mountAuthFlow(mock())
    expect(document.getElementById('auth-flow-root')).not.toBeNull()
    expect(cleanupCalled.count, 'onCleanup не должен звать себя ДО dispose()').toBe(0)

    dispose()

    // Узел уходит немедленно (mountAuthFlow.solid.tsx: dispose(); root.remove()
    // — до doubleRaf); класс — после двойного rAF, тем же приёмом, что и
    // прежний React `AuthFlow.tsx`, поэтому ждём его отдельно.
    expect(document.getElementById('auth-flow-root')).toBeNull()
    // Реактивный граф хоста реально снят Solid'ом — не только DOM-узел вынут
    // из документа. Мутация «убрать только dispose(), оставить root.remove()»
    // (находка 2 повторного ревью) убирает узел из DOM ровно так же, но
    // `onCleanup` мока НЕ позовётся — этот ассерт обязан покраснеть на ней.
    expect(cleanupCalled.count, 'onCleanup хоста не был вызван — Solid-корень не снят').toBe(1)
    await vi.waitFor(() => {
      expect(document.body.classList.contains('has-auth-pages')).toBe(false)
    })
  })
})

describe('mountAuthFlow: стартовый шаг', () => {
  it('без #?tgWebAuthToken=… стартует с signIn', () => {
    location.hash = ''
    const dispose = mountAuthFlow(mock())
    expect(currentCard()).toEqual({ name: 'signIn' })
    dispose()
  })

  it('#?tgWebAuthToken=… даёт стартовый шаг signImport с токеном в payload', () => {
    location.hash = '#?tgWebAuthToken=abc123'
    const dispose = mountAuthFlow(mock())
    expect(currentCard()).toEqual({ name: 'signImport', payload: { webAuthToken: 'abc123' } })
    dispose()
  })
})
