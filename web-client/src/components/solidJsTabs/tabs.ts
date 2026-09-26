/**
 * Порт tweb `src/components/solidJsTabs/tabs.ts` — ОБЪЯВЛЕНИЯ вкладок:
 * заголовок, ленивый модуль содержимого и форма полезной нагрузки. Класс
 * вкладки собирает `scaffoldSolidJSTab*` (шаг 6 плана волны 2), сам модуль содержимого
 * подтягивается динамическим `import()` — только когда вкладку открыли.
 *
 * В оригинале файл держит 75 объявлений разом (`grep -c "^export const App"`);
 * у нас их три — «Устройства», «Язык» и «Уведомления». Остальные добавляются по мере
 * портирования своих модулей (#112): перенести сюда объявление вкладки, чей
 * модуль ещё не портирован, значило бы завести `import()` в несуществующий
 * файл.
 *
 * Реестра `providedTabs` (второй элемент кортежа `useSuperTab()`) здесь нет
 * НАМЕРЕННО: в оригинале ни одна из наших вкладок в него не входит
 * (`solidJsTabs/providedTabs.ts` — там шесть других вкладок), а реестр нужен
 * только тем вкладкам, которых открывают ПО ИМЕНИ из чужого модуля, объезжая
 * циклический импорт. Ни у одной из наших такого вызывающего нет ни там,
 * ни здесь — запись в `ProvidedTabs` была бы объявлением без потребителя.
 */
import type { Authorization } from '@layer'
import type { PasswordState } from '@core/managers/authManager'
import type SliderSuperTab from '@components/sliderTab'
import { scaffoldSolidJSTab, scaffoldSolidJSTabEventable } from './scaffoldSolidJSTab.solid'

// tweb :327-329 — вкладка получает УЖЕ загруженный список сессий, а не ходит
// за ним сама: запрос делает открывающая сторона (у нас — `settingsSliderHost
// ::openActiveSessionsTab`), чтобы вкладка не въезжала пустой.
type AppActiveSessionsTabPayload = {
  authorizations: Authorization.authorization[]
}

export const AppActiveSessionsTab =
  scaffoldSolidJSTabEventable<AppActiveSessionsTabPayload>({
    title: 'SessionsTitle',
    getComponentModule: () => import('../sidebarLeft/tabs/activeSessions.solid'),
  })

// tweb :155-159. Форма ОБЫЧНАЯ (`scaffoldSolidJSTab`), а не eventable, — как в
// оригинале: у «Языка» нет открывающей стороны, которой было бы что слушать,
// и полезной нагрузки тоже нет (список языков вкладка берёт сама, в свой
// `promiseCollector`).
export const AppLanguageTab =
  scaffoldSolidJSTab({
    title: 'Telegram.LanguageViewController',
    getComponentModule: () => import('../sidebarLeft/tabs/language.solid'),
  })

// tweb :77-81. Форма обычная, без полезной нагрузки: состояние вкладка берёт
// сама (мост `useAppSettings`, `stores/notifyStore.ts`). Открывает её строка
// корня настроек `AccountSettings.Notifications` (tweb `settings.tsx:252`).
export const AppNotificationsTab =
  scaffoldSolidJSTab({
    title: 'Telegram.NotificationSettingsViewController',
    getComponentModule: () => import('../sidebarLeft/tabs/notifications.solid'),
  })

// ── Мастер 2FA (tweb :886-996) ────────────────────────────────────────────────
// Все шаги — обычная форма, как у оригинала. Состояние пароля — наш
// `PasswordState` (`GET /me/password`: `enabled`/`hint`/маска `email`) на месте
// `AccountPassword` (`pFlags.has_password`/`has_recovery`/`hint`). Шаг
// `AppTwoStepVerificationEmailConfirmationTab` (:980-996) не заведён — О-13:
// почта ставится сервером сразу, кода подтверждения нет.
//
// `_onOpenAfterTimeout` — крючок, который содержимое вешает на свою вкладку
// (tweb `(this as any)._onOpenAfterTimeout?.()`): фокус поля — после въезда.
export type TwoStepVerificationTabHooks = { _onOpenAfterTimeout?: () => void }

function twoStepOpenAfterTimeout(this: SliderSuperTab) {
  (this as SliderSuperTab & TwoStepVerificationTabHooks)._onOpenAfterTimeout?.()
}

type AppTwoStepVerificationSetTabPayload = {
  messageFor: 'password' | 'email'
}

export const AppTwoStepVerificationSetTab =
  scaffoldSolidJSTab<AppTwoStepVerificationSetTabPayload>({
    title: (p) => p.messageFor === 'password' ? 'TwoStepVerificationPasswordSet' : 'TwoStepVerificationEmailSet',
    getComponentModule: () => import('../sidebarLeft/tabs/2fa/passwordSet.solid'),
  })

type AppTwoStepVerificationTabPayload = {
  state: PasswordState
  plainPassword?: string
}

export const AppTwoStepVerificationTab =
  scaffoldSolidJSTab<AppTwoStepVerificationTabPayload>({
    title: 'TwoStepVerificationTitle',
    getComponentModule: () => import('../sidebarLeft/tabs/2fa/index.solid'),
  })

// tweb :910-927. `onClose` оригинала гасит `ForgotPasswordLink` — ссылки у нас
// нет (О-13), крючка тоже.
type AppTwoStepVerificationEnterPasswordTabPayload = {
  state: PasswordState
  plainPassword?: string
  isFirst?: boolean
}

export const AppTwoStepVerificationEnterPasswordTab =
  scaffoldSolidJSTab<AppTwoStepVerificationEnterPasswordTabPayload>({
    title: (p) => (!p.state.enabled || p.plainPassword) ? 'PleaseEnterFirstPassword' : 'PleaseEnterCurrentPassword',
    getComponentModule: () => import('../sidebarLeft/tabs/2fa/enterPassword.solid'),
    onOpenAfterTimeout: twoStepOpenAfterTimeout,
  })

type AppTwoStepVerificationReEnterPasswordTabPayload = {
  state: PasswordState
  plainPassword?: string
  newPassword?: string
}

export const AppTwoStepVerificationReEnterPasswordTab =
  scaffoldSolidJSTab<AppTwoStepVerificationReEnterPasswordTabPayload>({
    title: 'PleaseReEnterPassword',
    getComponentModule: () => import('../sidebarLeft/tabs/2fa/reEnterPassword.solid'),
    onOpenAfterTimeout: twoStepOpenAfterTimeout,
  })

type AppTwoStepVerificationHintTabPayload = {
  state: PasswordState
  plainPassword?: string
  newPassword?: string
}

export const AppTwoStepVerificationHintTab =
  scaffoldSolidJSTab<AppTwoStepVerificationHintTabPayload>({
    title: 'TwoStepAuth.SetupHintTitle',
    getComponentModule: () => import('../sidebarLeft/tabs/2fa/hint.solid'),
    onOpenAfterTimeout: twoStepOpenAfterTimeout,
  })

type AppTwoStepVerificationEmailTabPayload = {
  state: PasswordState
  plainPassword?: string
  newPassword?: string
  hint?: string
  isFirst?: boolean
  justSetPasssword?: boolean
}

export const AppTwoStepVerificationEmailTab =
  scaffoldSolidJSTab<AppTwoStepVerificationEmailTabPayload>({
    title: 'RecoveryEmailTitle',
    getComponentModule: () => import('../sidebarLeft/tabs/2fa/email.solid'),
    onOpenAfterTimeout: twoStepOpenAfterTimeout,
  })
