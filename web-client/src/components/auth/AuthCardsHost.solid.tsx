/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/pages/AuthCardsHost.tsx` (243 строки) — хост карточек входа:
 * фон, кнопки «назад»/тема, `<Scrollable>`, `<Transition mode="outin">` с семью
 * `<Match keyed>`, ленивые карточки. Задача 3 волны 3 (этап 1, Solid-миграция
 * auth-экрана) — переносит ХОСТ и его переход между экранами; сами семь
 * карточек — задачи 4/5 (см. «ВРЕМЕННЫЕ карточки» ниже).
 *
 * ── Ключевая деталь: удержание предыдущей карточки на время лени ───────────
 * (Перевод докблока оригинала, `AuthCardsHost.tsx:174-195`, — снимать нельзя.)
 *
 * `<Switch>` вынесен из прямых детей `<Transition>` и разрешён через
 * `children()`, чтобы видеть смэтченную карточку СНАРУЖИ примитива перехода.
 * Два следствия:
 *
 * - Ленивые чанки карточек резолвятся в `""`, пока импорт летит, а
 *   `resolveFirst` (внутри `<Transition>`) читает это как `null`. Если бы
 *   `<Transition>` был смонтирован в этот момент, последующий переход
 *   `null → element` читался бы им как ВХОД — и заанимировал бы ПЕРВУЮ карточку.
 *   Поэтому `<Transition>` стоит за `<Show>`-гейтом, пока не резолвится первая
 *   настоящая карточка: тогда его начальный ребёнок — сама карточка, и
 *   `appear={false}` корректно гасит начальную анимацию.
 * - Для перехода карточка→карточка `createMemo` удерживает ПРЕДЫДУЩУЮ
 *   отрендеренную карточку на время окна ленивой загрузки следующей — значит,
 *   `<Transition>` никогда не увидит переходное пустое состояние и в середине
 *   навигации тоже.
 *
 * Пины (`AuthCardsHost.solid.test.tsx`): в контейнере никогда не бывает двух
 * карточек одновременно (уходящая доигрывает до монтирования новой — это и
 * есть `mode="outin"`), и на время загрузки ленивой карточки в DOM остаётся
 * ПРЕДЫДУЩАЯ, а не пустота.
 *
 * ── `<Transition>` — вендор, не npm-пакет ───────────────────────────────────
 * Как и у оригинала (`@vendor/solid-transition-group`) — свой форк
 * `solid-js-community/solid-transition-group`, а не сам npm-пакет с этим
 * именем. Портирован в `src/vendor/solid-transition-group/` (только
 * `<Transition>`, без `<TransitionGroup>` — см. докблок там); зависимости
 * `@solid-primitives/{refs,transition-group}` — настоящие npm-пакеты тех же
 * версий, что у tweb.
 *
 * ── matchCard('x') вызывается КАК `()` — из-за контракта задачи 1 ─────────
 * У оригинала `matchCard` отдаёт значение напрямую, и `<Match when={matchCard(...)}>`
 * реактивен за счёт автообёртки Solid-компилятора вокруг JSX-пропа. У НАС
 * (`authFlow.solid.tsx`, см. её докблок «matchCard — Accessor, а не голое
 * значение») `matchCard('x')` возвращает АКСЕССОР, а не значение, — поэтому
 * здесь `<Match when={matchCard('x')()}>` (с вызовом): именно вызов внутри
 * авто-геттера JSX-пропа читает сигнал `currentCard` в скоупе слежения.
 * Без вызова `when` получил бы САМУ ФУНКЦИЮ-аксессор — она truthy всегда,
 * и `<Match keyed>` отдавала бы карточке эту функцию вместо `CardSpec`.
 *
 * ── Расхождения с tweb (наша SPA-архитектура, не MTProto-мультиаккаунт) ────
 * Источник поведения — tweb, а не наш React `AuthFlow.tsx` (там своя
 * `useCardTransition` — WAAPI поверх React-состояния, НЕ источник для
 * `<Transition>`; но `.hostEnter/.hostExit`-классы `AuthFlow.module.scss`
 * зарезервированы ИМЕННО под этот файл, см. её докблок «writes happen in
 * runEnterSequence in AuthCardsHost.tsx» — используем их, а не WAAPI-хелперы
 * React-версии).
 *
 *  • `managers` — параметр компонента, а не `rootScope.managers` (модульный
 *    синглтон tweb). У нас DI менеджеров идёт через React-контекст
 *    (`core/hooks/useManagers.tsx`, «прямой аналог `rootScope.managers`»);
 *    Solid-аналога такого синглтона пока нет, и заводить его ради одного
 *    компонента — отсебятина. Владелец монтирования (пока не портирован —
 *    задача снятия React, волна 3+) передаст то же значение, что сегодня
 *    `startClient().managers`.
 *  • `onComplete` — параметр вместо `bootstrapIm()` (модуль реального
 *    бутстрапа мессенджера, которого в Solid-слое ещё нет). `toIm()` делает
 *    ровно то же, что и в оригинале СТРУКТУРНО — гасит фикс-кнопки классом
 *    `.leaving` (см. `AuthFlow.module.scss::.leaving`, тот же класс, что и у
 *    React-версии) и передаёт управление дальше, — но «дальше» здесь параметр,
 *    а не прямой вызов.
 *  • `getCurrentAccount() !== 1` (у tweb — реальный мультиаккаунт,
 *    `lib/accounts/*`, которого у нас нет) заменён на то же условие, что уже
 *    использует наш React `AuthFlow.tsx`: `PREV_ACCOUNT_KEY` в localStorage
 *    (`core/accountTransition.ts` — ставит `MainMenu.tsx` при «добавить
 *    аккаунт», часть уже смержённой, не придуманной здесь схемы).
 *  • `sessionStorage.set/get/delete('should_animate_auth'/'should_animate_main'
 *    /'previous_account')` + `getValidatedAccount`/`changeAccount` (модули
 *    `lib/accounts/*`, которых у нас нет) заменены на `localStorage`-флаги
 *    `ANIMATE_AUTH_KEY`/`ANIMATE_MAIN_KEY`/`PREV_ACCOUNT_KEY` +
 *    `commandThenReload(managers.auth.switchAccount(prevAccountId))` —
 *    ТОТ ЖЕ приём, что и в React `AuthFlow.tsx::backToAccount`, у нас общая
 *    команда воркеру + reload вместо MTProto-переключения активного DC.
 *    Структура самого back() (классы `.hostExit`/`.hostExiting`, `doubleRaf`,
 *    `pause(200)`) — 1:1 с оригиналом.
 *  • `themeController.switchTheme(...)` (глобальный синглтон tweb) заменён на
 *    локальный `switchTheme()`: та же формула кругового View Transition, что
 *    уже портирована для React в `core/hooks/useThemeToggle.ts` (координаты
 *    клика → `document.startViewTransition` → `clipPath`-круг, `duration: 450`,
 *    фолбэк на мгновенную смену без API/reduced-motion/без координат), но без
 *    её `useLayoutEffect`, который держит `<html data-theme>` В СИНХРОНЕ С
 *    настройками ВООБЩЕ (не про клик по кнопке — про применение сохранённого
 *    выбора при каждом маунте). У tweb этим тоже не занимается
 *    `AuthCardsHost` — применение темы при старте живёт в `src/index.ts`,
 *    здесь только обработчик клика.
 *
 * ── ВРЕМЕННЫЕ карточки (снимается задачей 5) ────────────────────────────────
 * Задача 4 перевела signIn/authCode/password на настоящий `lazy(() =>
 * import('./cards/...'))`. Четыре карточки без предмета в этой задаче
 * (signUp/emailRecover/signQR/signImport) остаются на `stubCard` — `lazy()`
 * поверх `Promise.resolve()`: лень должна быть НАСТОЯЩЕЙ (Solid откладывает
 * первый рендер `lazy`-компонента на микротаск независимо от источника
 * промиса), иначе пин «предыдущая карточка держится в DOM, пока грузится
 * следующая» проверял бы то, чего на самом деле не происходит. По готовности
 * задачи 5 — заменить оставшиеся константы, `stubCard` и этот комментарий
 * снимаются целиком.
 */
import {
  Match,
  Show,
  Switch,
  children,
  createMemo,
  lazy,
  onMount,
  type Component,
  type JSX,
} from 'solid-js'
import Scrollable from '@components/scrollable2.solid'
import Button from '@components/buttonTsx.solid'
import { Transition } from '@vendor/solid-transition-group'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_MOBILE_SAFARI } from '@environment/userAgent'
import classNames from '@helpers/string/classNames'
import { doubleRaf } from '@helpers/schedulers'
import {
  ANIMATE_AUTH_KEY,
  ANIMATE_MAIN_KEY,
  PREV_ACCOUNT_KEY,
  commandThenReload,
  pause,
} from '@core/accountTransition'
import { loadFonts } from '@core/dom/loadFonts'
import { setTheme } from '@core/theme/themeController'
import { dispatchHeavyAnimationEvent } from '@core/dom/heavyAnimation'
import { useSettingsStore } from '@/settings'
import { resolvePreset, PRESET_MODE, type ThemeChoice } from '@/theme'
import type { Managers } from '@/client/bootstrap'
import {
  AuthFlowContext,
  currentCard,
  matchCard,
  navigateAuth,
  type AuthFlowContextValue,
  type CardName,
  type CardSpec,
} from './authFlow.solid'
import AuthCard from './AuthCard.solid'
import styles from './AuthFlow.module.scss'

/* ------------------------------------------------------------------ */
/* Ленивые слоты карточек — временные заглушки, см. докблок выше       */
/* ------------------------------------------------------------------ */

function stubCard<K extends CardName>(name: K): Component<{ spec: Extract<CardSpec, { name: K }> }> {
  return () => (
    <AuthCard>
      <div data-testid={`stub-card-${name}`}>{name}</div>
    </AuthCard>
  )
}

// Задача 4 (волна 3, этап 1): signIn/authCode/password — настоящие карточки.
// Заглушки для signUp/emailRecover/signQR/signImport остаются до задачи 5.
const SignInCard = lazy(() => import('./cards/SignInCard.solid'))
const AuthCodeCard = lazy(() => import('./cards/AuthCodeCard.solid'))
const PasswordCard = lazy(() => import('./cards/PasswordCard.solid'))
const SignUpCard = lazy(async () => ({ default: stubCard('signUp') }))
const EmailRecoverCard = lazy(async () => ({ default: stubCard('emailRecover') }))
const SignQRCard = lazy(async () => ({ default: stubCard('signQR') }))
const SignImportCard = lazy(async () => ({ default: stubCard('signImport') }))

/* ------------------------------------------------------------------ */
/* Host                                                               */
/* ------------------------------------------------------------------ */

export type AuthCardsHostProps = {
  /** DI-хендл менеджеров воркера — см. докблок «Расхождения с tweb». */
  managers: Managers
  /** Свернуть auth-UI и забутстрапить мессенджер — см. докблок «toIm()». */
  onComplete: () => void
}

export default function AuthCardsHost(props: AuthCardsHostProps): JSX.Element {
  // Порт `getCurrentAccount() !== 1` — см. докблок «Расхождения с tweb».
  const prevAccountId = (() => {
    const raw = localStorage.getItem(PREV_ACCOUNT_KEY)
    return raw ? Number(raw) : null
  })()
  const showBackButton = prevAccountId != null

  let hostEl!: HTMLDivElement

  /* ---------- context ---------- */

  const ctx: AuthFlowContextValue = {
    managers: props.managers,
    current: currentCard,
    navigate: navigateAuth,
    back,
    toIm,
  }

  /* ---------- back button (возврат к прежнему аккаунту) ---------- */

  async function back(): Promise<void> {
    if (prevAccountId == null) return
    localStorage.setItem(ANIMATE_MAIN_KEY, '1')
    localStorage.removeItem(PREV_ACCOUNT_KEY)

    if (hostEl) {
      hostEl.classList.add(styles.hostExit)
      await doubleRaf()
      hostEl.classList.add(styles.hostExiting)
      await pause(200)
    }

    await commandThenReload(props.managers.auth.switchAccount(prevAccountId))
  }

  /* ---------- переход на экран мессенджера ---------- */

  async function toIm(): Promise<void> {
    // `#page-chats` тут же прячет карточки, но фикс-кнопки углов (z-index: 100)
    // лежат НАД ним — гасим их сразу классом, не дожидаясь, пока хост реально
    // размонтируется (тот же приём и тот же комментарий, что у оригинала).
    hostEl.classList.add(styles.leaving)
    props.onComplete()
  }

  /* ---------- переключатель темы (см. докблок «Расхождения с tweb») ---------- */

  function switchTheme(coords?: { x: number; y: number }): void {
    const currentPreset = resolvePreset(useSettingsStore.getState().themeChoice)
    const next: ThemeChoice = PRESET_MODE[currentPreset] === 'dark' ? 'day' : 'night'
    const apply = () => {
      useSettingsStore.getState().update({ themeChoice: next })
      setTheme(resolvePreset(next))
    }

    const start = (document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> }
    }).startViewTransition
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (!start || !coords || reduce) {
      apply()
      return
    }

    const { x, y } = coords
    const transition = start.call(document, apply)
    // Пока играет круговое раскрытие — пауза тяжёлого рендера (стикеры/видео),
    // как и в React-версии; `.catch` — чтобы реджект `finished` не заклинил
    // паузу до истечения таймаута.
    void dispatchHeavyAnimationEvent(transition.finished.catch(() => {}), 2000)
    void transition.ready.then(() => {
      const endRadius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
        { duration: 450, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
  }

  function toggleTheme(e: MouseEvent): void {
    const target = e.currentTarget as HTMLElement
    const icon = target.querySelector('.tgico') ?? target
    const rect = icon.getBoundingClientRect()
    switchTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }

  /* ---------- enter-анимация (порт runEnterSequence, :117-138) ---------- */

  async function runEnterSequence(): Promise<void> {
    const fontsPromise = loadFonts()

    const shouldAnimate = !!localStorage.getItem(ANIMATE_AUTH_KEY)
    if (shouldAnimate) {
      localStorage.removeItem(ANIMATE_AUTH_KEY)
      hostEl.classList.add(styles.hostEnter)
    }

    await fontsPromise
    hostEl.style.opacity = ''

    if (!shouldAnimate) return

    await pause(20)
    await doubleRaf()
    hostEl.classList.add(styles.hostEntering)
    await pause(1000)
    hostEl.classList.remove(styles.hostEnter, styles.hostEntering)
  }

  /* ---------- onMount ---------- */

  onMount(() => {
    if (!currentCard()) {
      console.warn(
        '[AuthCardsHost] mounted without an initial card — call navigateAuth({...}) before render',
      )
    }

    void runEnterSequence()
  })

  /* ---------- render ---------- */

  return (
    <AuthFlowContext.Provider value={ctx}>
      <div
        ref={hostEl}
        style={{ opacity: 0 }}
        class={classNames('whole', styles.host)}
        id="auth-pages"
      >
        <Show when={showBackButton}>
          <Button.Icon icon="back" class={styles.closeButton} onClick={() => void back()} />
        </Show>
        <Button.Icon icon="darkmode_filled" class={styles.themeButton} onClick={toggleTheme} />
        <Scrollable
          class={classNames(
            styles.scrollable,
            (!IS_TOUCH_SUPPORTED || IS_MOBILE_SAFARI) && 'no-scrollbar',
          )}
        >
          <div class={classNames(styles.placeholder, styles.placeholderTop)} />
          <div class={styles.cardsContainer}>
            <CardsTransition />
          </div>
          <div class={styles.placeholder} />
        </Scrollable>
      </div>
    </AuthFlowContext.Provider>
  )
}

/**
 * См. докблок файла — «Ключевая деталь» и «matchCard('x') вызывается КАК ()».
 */
function CardsTransition(): JSX.Element {
  const cardChild = children(() => (
    <Switch>
      <Match when={matchCard('signIn')()} keyed>
        {(spec) => <SignInCard spec={spec} />}
      </Match>
      <Match when={matchCard('authCode')()} keyed>
        {(spec) => <AuthCodeCard spec={spec} />}
      </Match>
      <Match when={matchCard('password')()} keyed>
        {(spec) => <PasswordCard spec={spec} />}
      </Match>
      <Match when={matchCard('signUp')()} keyed>
        {(spec) => <SignUpCard spec={spec} />}
      </Match>
      <Match when={matchCard('emailRecover')()} keyed>
        {(spec) => <EmailRecoverCard spec={spec} />}
      </Match>
      <Match when={matchCard('signQR')()} keyed>
        {(spec) => <SignQRCard spec={spec} />}
      </Match>
      <Match when={matchCard('signImport')()} keyed>
        {(spec) => <SignImportCard spec={spec} />}
      </Match>
    </Switch>
  ))

  // Удержание предыдущей карточки на время лени следующей — см. докблок файла.
  const stableCard = createMemo<JSX.Element>((prev) => {
    const c = cardChild()
    return c || prev
  })

  return (
    <Show when={stableCard()}>
      <Transition
        mode="outin"
        enterActiveClass={styles.cardEnterActive}
        exitActiveClass={styles.cardExitActive}
        enterClass={styles.cardEnter}
        enterToClass={styles.cardEnterTo}
        exitClass={styles.cardExit}
        exitToClass={styles.cardExitTo}
        appear={false}
      >
        {stableCard()}
      </Transition>
    </Show>
  )
}
