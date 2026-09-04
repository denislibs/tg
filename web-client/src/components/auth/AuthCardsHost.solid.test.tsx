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

// Задача 4: signIn/authCode/password теперь настоящие карточки — `auth`
// нужны методы, которые они реально зовут (SignInCard дёргает
// `nearestCountry` уже на `onMount`, до любого клика).
const mockManagers = () =>
  ({
    auth: {
      switchAccount: vi.fn().mockResolvedValue(true),
      nearestCountry: vi.fn().mockResolvedValue(''),
      requestCode: vi.fn(),
      passkeyLoginBegin: vi.fn(),
      passkeyLoginFinish: vi.fn(),
    },
  }) as unknown as Managers

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  // `vi.resetModules()` даёт КАЖДОМУ импорту ниже свежий экземпляр модульного
  // графа, включая `@lib/langPack` — глобальный сетап (`src/test/setup.ts`)
  // наполнил английским СТАРЫЙ экземпляр до сброса, свежий пуст. Раньше это
  // было не видно: хост сам не переводит текст (только иконки), а карточки
  // задачи 4 (SignInCard и т.д.) — первые в этом файле, кто реально зовёт
  // `i18n()`. Тот же приём, что у `src/test/setup.ts::beforeAll` — импорт
  // ради побочного эффекта, — но для СВЕЖЕГО графа этого прогона.
  await import('../../test/lang')
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

// signIn — задача 4, настоящая карточка без `[data-testid]` заглушки. Маркер
// — её собственная разметка: `.input-select` (глобальный класс CountryInput,
// есть только на signIn среди наших карточек).
async function waitForSignIn(root: HTMLElement) {
  await vi.waitFor(() => expect(root.querySelector('.input-select')).not.toBeNull())
}

// signUp — задача 5, тоже настоящая карточка без `[data-testid]`. Маркер —
// класс модификатора страницы (`s.pageSignUp`), как у `pagePassword` в тесте
// «предыдущая карточка остаётся в DOM» ниже.
async function waitForSignUp(root: HTMLElement) {
  await vi.waitFor(() => expect(root.querySelector('[class*="pageSignUp"]')).not.toBeNull())
}

function cardNodes(root: HTMLElement): Element[] {
  const container = root.querySelector('[class*="cardsContainer"]')!
  return Array.from(container.children)
}

describe('AuthCardsHost.solid — переход между карточками', () => {
  it('пин: в контейнере никогда не бывает двух карточек — уходящая доигрывает exit до входа новой', async () => {
    navigateAuth({ name: 'signIn' })
    const root = mount()
    await waitForSignIn(root)
    expect(cardNodes(root)).toHaveLength(1)

    navigateAuth({ name: 'signUp', payload: { token: 'su-tok' } })

    // Ждём, пока лениво резолвится signUp и `<Transition>` реально ЗАПУСТИТ
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
    expect(root.querySelector('.input-select')).not.toBeNull()
    expect(root.querySelector('[class*="pageSignUp"]')).toBeNull()

    // Доигрываем exit вручную — на реальном экране это делает браузер.
    // Узел, на который вендор вешает exit-классы, — это ВЕРХНИЙ элемент
    // карточки (корень `<AuthCard>`, прямой ребёнок `.cardsContainer`).
    const exiting = cardNodes(root)[0]
    exiting.dispatchEvent(new Event('transitionend', { bubbles: false }))

    await waitForSignUp(root)
    expect(cardNodes(root)).toHaveLength(1)
    expect(root.querySelector('.input-select')).toBeNull()
  })

  it('пин: предыдущая карточка остаётся в DOM на время загрузки ленивого чанка следующей', async () => {
    navigateAuth({ name: 'signIn' })
    const root = mount()
    await waitForSignIn(root)

    navigateAuth({ name: 'password', payload: { token: 't', hint: 'h' } })

    // СИНХРОННО сразу после навигации: новый ленивый чанк ещё не резолвился
    // (резолв — микротаска), поэтому `stableCard` обязана отдать ПРЕДЫДУЩУЮ
    // карточку, а не пустоту. Без `await` — это и есть проверка «не мигнуло».
    expect(root.querySelector('.input-select')).not.toBeNull()
    expect(root.querySelector('[class*="pagePassword"]')).toBeNull()
  })
})

describe('AuthCardsHost.solid — кнопка «назад» и переключатель темы', () => {
  it('кнопка «назад» скрыта без PREV_ACCOUNT_KEY в localStorage', async () => {
    navigateAuth({ name: 'signIn' })
    const root = mount()
    await waitForSignIn(root)

    expect(root.querySelector('[class*="closeButton"]')).toBeNull()
    expect(root.querySelector('[class*="themeButton"]')).not.toBeNull()
  })

  it('кнопка «назад» показана при PREV_ACCOUNT_KEY и ведёт хост через .hostExit к managers.auth.switchAccount', async () => {
    localStorage.setItem('msgr_prev_account', '42')
    navigateAuth({ name: 'signIn' })
    const managers = mockManagers()
    const root = mount({ managers })
    await waitForSignIn(root)

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
    await waitForSignIn(root)

    const themeBtn = root.querySelector<HTMLElement>('[class*="themeButton"]')!
    expect(themeBtn).not.toBeNull()
    themeBtn.click()

    // Без `document.startViewTransition` (нет в happy-dom) переключатель
    // применяет смену мгновенно — тот же фолбэк, что у `useThemeToggle`.
    expect(useSettingsStore.getState().themeChoice).toBe('night')
  })
})
