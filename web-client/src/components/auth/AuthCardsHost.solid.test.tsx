/** @jsxImportSource solid-js */
/**
 * Пины хоста карточек входа (`AuthCardsHost.solid.tsx`, порт tweb
 * `src/pages/AuthCardsHost.tsx`). Три факта — устройство ОРИГИНАЛА (см.
 * докблок `AuthCardsHost.solid.tsx`, «Ключевая деталь»), не наша выдумка:
 *
 *  1. В контейнере карточек НИКОГДА не бывает двух карточек одновременно —
 *     уходящая доигрывает exit-переход до того, как новая войдёт (`mode="outin"`).
 *  2. На время загрузки ленивого чанка следующей карточки в DOM остаётся
 *     ПРЕДЫДУЩАЯ, а не пустота — `children()` + `createMemo((prev) => c || prev)`.
 *  3. Кнопка «назад» показывается только при возврате к прежнему аккаунту
 *     (`PREV_ACCOUNT_KEY` в localStorage) и ведёт хост через `.hostExit`/
 *     `.hostExiting` к `managers.auth.switchAccount`; кнопка темы всегда на
 *     месте и переключает `themeChoice`.
 *
 * Модуль `authFlow.solid` держит модульный сигнал `currentCard` — каждый тест
 * поднимает СВЕЖИЙ модуль (`vi.resetModules()` + динамический импорт ПОСЛЕ
 * сброса), иначе тесты делили бы один и тот же сигнал (тот же приём, что у
 * `authFlow.solid.test.tsx`). Это заодно даёт каждому тесту свежие `lazy()`-
 * слоты карточек — их внутренний кэш промиса иначе пережил бы предыдущий тест.
 *
 * Реальные CSS-переходы `<Transition>` не играют в happy-dom (нет layout-движка,
 * `transitionend` сам не рождается) — вендор `@vendor/solid-transition-group`
 * умеет закрывать exit и без него ТОЛЬКО если передан `duration`, а хост его не
 * передаёт (как и оригинал). Поэтому «доигрывание» exit-перехода в тестах
 * продвигается вручную — диспатчим `transitionend` на уходящем узле, как это
 * сделал бы реальный браузер по окончании CSS-анимации.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'

let render: typeof import('solid-js/web').render
let navigateAuth: typeof import('./authFlow.solid').navigateAuth
let AuthCardsHost: typeof import('./AuthCardsHost.solid').default

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

const mockManagers = () =>
  ({ auth: { switchAccount: vi.fn().mockResolvedValue(true) } }) as unknown as Managers

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  ;({ render } = await import('solid-js/web'))
  ;({ navigateAuth } = await import('./authFlow.solid'))
  ;({ default: AuthCardsHost } = await import('./AuthCardsHost.solid'))
})

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
  localStorage.clear()
})

function mount(props: { managers?: Managers; onComplete?: () => void } = {}) {
  host = document.createElement('div')
  document.body.append(host)
  const managers = props.managers ?? mockManagers()
  const onComplete = props.onComplete ?? vi.fn()
  dispose = render(
    (() => <AuthCardsHost managers={managers} onComplete={onComplete} />) as () => never,
    host,
  )
  return host
}

/** Ждёт, пока в `.cardsContainer` появится текстовый маркер заглушки карточки. */
async function waitForCard(root: HTMLElement, testId: string) {
  await vi.waitFor(() => {
    expect(root.querySelector(`[data-testid="${testId}"]`)).not.toBeNull()
  })
}

function cardNodes(root: HTMLElement): Element[] {
  const container = root.querySelector('[class*="cardsContainer"]')!
  return Array.from(container.children)
}

describe('AuthCardsHost.solid — переход между карточками', () => {
  it('пин: в контейнере никогда не бывает двух карточек — уходящая доигрывает exit до входа новой', async () => {
    navigateAuth({ name: 'signIn' })
    const root = mount()
    await waitForCard(root, 'stub-card-signIn')
    expect(cardNodes(root)).toHaveLength(1)

    navigateAuth({ name: 'signQR' })

    // Ждём, пока лениво резолвится signQR и `<Transition>` реально ЗАПУСТИТ
    // exit прежней карточки (класс `cardExitActive` на узле). До этого момента
    // `stableCard` ещё отдаёт старую карточку без изменений — тот же факт,
    // что доказывает второй тест этого файла (см. ниже), здесь важен как ШАГ,
    // а не как отдельное утверждение.
    await vi.waitFor(() => {
      const el = cardNodes(root)[0] as HTMLElement
      expect(el.className).toMatch(/cardExitActive/)
    })

    // Пока играет exit прежней карточки (happy-dom не рождает transitionend
    // сам), в контейнере — ровно одна карточка: старая, с классами выхода.
    expect(cardNodes(root)).toHaveLength(1)
    expect(root.querySelector('[data-testid="stub-card-signIn"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="stub-card-signQR"]')).toBeNull()

    // Доигрываем exit вручную — на реальном экране это делает браузер.
    // Узел, на который вендор вешает exit-классы, — это ВЕРХНИЙ элемент
    // карточки (корень `<AuthCard>`, прямой ребёнок `.cardsContainer`), а не
    // сам `[data-testid]`, который лежит внутри `.input-wrapper` двумя
    // уровнями глубже.
    const exiting = cardNodes(root)[0]
    exiting.dispatchEvent(new Event('transitionend', { bubbles: false }))

    await waitForCard(root, 'stub-card-signQR')
    expect(cardNodes(root)).toHaveLength(1)
    expect(root.querySelector('[data-testid="stub-card-signIn"]')).toBeNull()
  })

  it('пин: предыдущая карточка остаётся в DOM на время загрузки ленивого чанка следующей', async () => {
    navigateAuth({ name: 'signIn' })
    const root = mount()
    await waitForCard(root, 'stub-card-signIn')

    navigateAuth({ name: 'password', payload: { token: 't', hint: 'h' } })

    // СИНХРОННО сразу после навигации: новый ленивый чанк ещё не резолвился
    // (резолв — микротаска), поэтому `stableCard` обязана отдать ПРЕДЫДУЩУЮ
    // карточку, а не пустоту. Без `await` — это и есть проверка «не мигнуло».
    expect(root.querySelector('[data-testid="stub-card-signIn"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="stub-card-password"]')).toBeNull()
  })
})

describe('AuthCardsHost.solid — кнопка «назад» и переключатель темы', () => {
  it('кнопка «назад» скрыта без PREV_ACCOUNT_KEY в localStorage', async () => {
    navigateAuth({ name: 'signIn' })
    const root = mount()
    await waitForCard(root, 'stub-card-signIn')

    expect(root.querySelector('[class*="closeButton"]')).toBeNull()
    expect(root.querySelector('[class*="themeButton"]')).not.toBeNull()
  })

  it('кнопка «назад» показана при PREV_ACCOUNT_KEY и ведёт хост через .hostExit к managers.auth.switchAccount', async () => {
    localStorage.setItem('msgr_prev_account', '42')
    navigateAuth({ name: 'signIn' })
    const managers = mockManagers()
    const root = mount({ managers })
    await waitForCard(root, 'stub-card-signIn')

    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})

    const backBtn = root.querySelector<HTMLElement>('[class*="closeButton"]')!
    expect(backBtn).not.toBeNull()
    backBtn.click()

    // Структура back() — 1:1 с оригиналом: hostExit → (doubleRaf) → hostExiting.
    const hostEl = root.querySelector<HTMLElement>('[id="auth-pages"]')!
    await vi.waitFor(() => {
      expect(hostEl.className).toMatch(/hostExit/)
    })

    await vi.waitFor(() => {
      expect(managers.auth.switchAccount).toHaveBeenCalledWith(42)
    })
    expect(localStorage.getItem('msgr_prev_account')).toBeNull()
    expect(localStorage.getItem('msgr_animate_main')).toBe('1')

    reload.mockRestore()
  })

  it('переключатель темы всегда на месте и переключает themeChoice в settings-сторе', async () => {
    const { useSettingsStore } = await import('@/settings')
    useSettingsStore.getState().update({ themeChoice: 'day' })

    navigateAuth({ name: 'signIn' })
    const root = mount()
    await waitForCard(root, 'stub-card-signIn')

    const themeBtn = root.querySelector<HTMLElement>('[class*="themeButton"]')!
    expect(themeBtn).not.toBeNull()
    themeBtn.click()

    // Без `document.startViewTransition` (нет в happy-dom) переключатель
    // применяет смену мгновенно — тот же фолбэк, что у `useThemeToggle`.
    expect(useSettingsStore.getState().themeChoice).toBe('night')
  })
})
