/** @jsxImportSource solid-js */
/**
 * Каркас роутинга шага входа — порт tweb/src/pages/authFlow.tsx (129 строк).
 * Волна 3, этап 1, задача 1: типы шага, модульный сигнал текущей карточки,
 * `navigateAuth`/`matchCard`/`useAuthFlow`. Сами карточки и хост
 * (`AuthCardsHost`) — задачи 2+.
 *
 * ── Источник поведения — tweb, а не наш React `AuthFlow.tsx` ──────────────
 * `AuthFlow.tsx` (React) держит шаг в `useState` хоста (`:203`) — карточка
 * переживает смену "текущей" только внутри жизни ОДНОГО React-дерева. У tweb
 * шаг живёт в МОДУЛЬНОМ сигнале, созданном в собственном `createRoot`
 * (`:80-86`): переживает перемонтирование хоста, а `navigateAuth` можно
 * дёрнуть СНАРУЖИ Solid вообще (кнопка passkey, обработчики ошибок,
 * `mountAuthFlow.tsx:29` — до самого `render`). Этот файл — порт ВТОРОГО
 * устройства, а не слепок первого; расхождение с `AuthFlow.tsx` не дефект.
 *
 * ── CardPayloadMap — форма ИЗ НАШЕГО хоста, а не 1:1 с оригиналом ─────────
 * У tweb `CardPayloadMap` (`:34-42`) несёт MTProto-специфичные поля
 * (`AuthSentCode.authSentCode`, `phone_code_hash`, `AuthState.signImport`) —
 * их у нас нет, авторизация идёт через REST `backend/internal/usecase/auth`.
 * Поэтому payload каждого шага собран из полей, которые СЕГОДНЯ тащит хост
 * `AuthFlow.tsx` (`:213-230`) конкретно в этот шаг — см. комментарий у
 * каждого поля `CardPayloadMap`. Шаги `signQR`/`signIn` — `void`, как и у
 * оригинала: страна и телефон живут в хосте отдельно от карты шага (правятся
 * ДВУСТОРОННЕ полем ввода, а не задаются один раз при переходе); куда им
 * переехать при порте самого хоста — решает задача 3, здесь не предмет.
 *
 * ── matchCard — Accessor, а не голое значение ──────────────────────────────
 * У оригинала (`:99-107`) `matchCard` отдаёт значение напрямую — реактивность
 * там держит автообёртка Solid-компилятора вокруг JSX-пропа
 * `<Match when={matchCard(...)}>`. У нас в этой задаче ни `<Match>`, ни
 * какого-либо JSX-потребителя ещё нет (карточки — задача 3+), поэтому
 * `matchCard` возвращает `Accessor`: реактивность не зависит от места вызова,
 * `matchCard('authCode')()` реактивен и внутри JSX-пропа, и вне его.
 *
 * ── HMR-ветка оригинала (:79-84, :129) не портирована ──────────────────────
 * У tweb сигнал переживает hot-replace модуля через `import.meta.hot.data`.
 * У нас `npm run dev` — это `vite build --watch` (см. `package.json`), а не
 * `vite dev`: HMR-рантайма нет, `import.meta.hot` всегда `undefined`. Ветка
 * без вызывающего — мёртвый код (тот же вывод, что уже сделан для
 * `attachHotClassName` в `helpers/solid/classname.ts`).
 */
import { createContext, createRoot, createSignal, useContext } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { Managers } from '../../client/bootstrap'

/* ------------------------------------------------------------------ */
/* Типы                                                                */
/* ------------------------------------------------------------------ */

/** Имена шагов — порт `authFlow.tsx:25-32`. */
export type CardName =
  | 'signQR'
  | 'signIn'
  | 'authCode'
  | 'password'
  | 'signUp'
  | 'emailRecover'
  | 'signImport'

/**
 * Нагрузка каждого шага — ровно то, что сегодня несёт в него хост
 * `AuthFlow.tsx` (`:213-230`), а не MTProto-форма оригинала (см. шапку файла).
 */
export type CardPayloadMap = {
  /** SignQRCard.tsx — колбэки без данных. */
  signQR: void
  /**
   * SignInCard.tsx — страна/телефон читаются и пишутся как ДВУСТОРОННЕЕ поле
   * хоста (`AuthFlow.tsx:213-268`), не как одноразовая нагрузка перехода.
   */
  signIn: void
  /** AuthCodeCard.tsx: `phone`/`fullPhone` — оба выводятся из одного `phone`. */
  authCode: { phone: string }
  /**
   * PasswordCard.tsx: `token`/`hint` — `pwToken`/`pwHint` хоста. `emailPattern`
   * — НАШЕ расширение против tweb (задача 5, закрытие долга задачи 4): маска
   * почты восстановления, которую эта же карточка САМА положила в переход на
   * `emailRecover` (см. ниже) и получает ОБРАТНО, когда `emailRecover` уводит
   * назад кнопкой Cancel. Без неё повторный клик «забыли пароль», упёршийся в
   * серверный `resend_too_soon`, не может отличить «код ещё жив, показать его
   * ввод снова» от «слишком рано, и мы не знаем куда» — а хранить это в
   * closure/модульном кэше карточки НЕЛЬЗЯ: карточка размонтируется на КАЖДЫЙ
   * `navigate` (хост, `mode="outin"`), обе переменные умирают вместе с ней.
   * Отсутствует при первом приходе с `authCode` — там маски ещё не было ни у
   * кого. Разбор — докблок `cards/PasswordCard.solid.tsx`.
   */
  password: { token: string; hint: string; emailPattern?: string }
  /** SignUpCard.tsx: `token` — `signUpToken` хоста. */
  signUp: { token: string }
  /**
   * EmailRecoverCard.tsx: `token`/`emailPattern` — `pwToken`/`recoverPattern`
   * хоста. `hint` — НАШЕ расширение: у tweb Cancel просто перечитывает общий
   * `authState`, а у нас переход обязан довезти ВСЮ нагрузку `password` сам
   * (см. `CardPayloadMap.password` выше) — без `hint` здесь путь
   * Cancel→password был бы не собрать: `password.hint` обязателен.
   */
  emailRecover: { token: string; emailPattern: string; hint: string }
  /** SignImportCard.tsx: `webAuthToken` хоста (ссылка `#?tgWebAuthToken=…`). */
  signImport: { webAuthToken: string }
}

/**
 * Дискриминированное объединение — `payload` обязателен, только если у шага
 * непустая нагрузка. Порт `authFlow.tsx:52-56`.
 */
export type CardSpec = {
  [K in CardName]: CardPayloadMap[K] extends void
    ? { name: K }
    : { name: K; payload: CardPayloadMap[K] }
}[CardName]

/** Порт `authFlow.tsx:58-69`. */
export type AuthFlowContextValue = {
  /** DI-хендл менеджеров воркера — аналог tweb `rootScope.managers`. */
  managers: Managers
  /** Текущий шаг (или `null` до первого `navigateAuth`). */
  current: Accessor<CardSpec | null>
  /** Переключить шаг — текущая карточка размонтируется. */
  navigate(spec: CardSpec): void
  /** Отменить вход и вернуться к прежнему аккаунту (кнопка «назад» хоста). */
  back(): void
  /** Свернуть auth-UI и забутстрапить мессенджер. */
  toIm(): Promise<void>
}

/* ------------------------------------------------------------------ */
/* Модульное состояние                                                 */
/* ------------------------------------------------------------------ */

/**
 * Собственный `createRoot` — сигнал живёт на весь сеанс процесса, а не на
 * время жизни какого-то одного Solid-дерева. Порт `authFlow.tsx:80-86` БЕЗ
 * HMR-ветки (см. шапку файла).
 */
const [currentCard, setCurrentCard] = createRoot(() => createSignal<CardSpec | null>(null))

export { currentCard }

/**
 * Вход снаружи Solid — колбэки не-Solid кода, обработчики ошибок,
 * `mountAuthFlow` (ставит стартовый шаг ДО `render`). Порт `:91-97`.
 */
export function navigateAuth(spec: CardSpec): void {
  setCurrentCard(spec)
}

/**
 * Сужение типа текущего шага. Возвращает `Accessor`, а не голое значение —
 * см. шапку файла. Порт `:99-107`.
 */
export function matchCard<K extends CardName>(name: K): Accessor<Extract<CardSpec, { name: K }> | null> {
  return () => {
    const c = currentCard()
    if (!c || c.name !== name) return null
    return c as Extract<CardSpec, { name: K }>
  }
}

/* ------------------------------------------------------------------ */
/* Контекст                                                            */
/* ------------------------------------------------------------------ */

export const AuthFlowContext = createContext<AuthFlowContextValue>()

/**
 * Хук карточек — менеджеры + API навигации. Бросает вне
 * `<AuthFlowContext.Provider>` (провайдер ставит хост карточек, задача 3) —
 * падать быстро вместо тихого `undefined`. Порт `:121-127`.
 */
export function useAuthFlow(): AuthFlowContextValue {
  const ctx = useContext(AuthFlowContext)
  if (!ctx) {
    throw new Error('useAuthFlow() called outside of <AuthFlowContext.Provider>')
  }
  return ctx
}
