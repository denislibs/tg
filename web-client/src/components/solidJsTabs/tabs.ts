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

// tweb :113-117. Форма обычная, без полезной нагрузки: вкладка статична, настроек
// не пишет. Открывает её строка корня настроек `KeyboardShortcuts.Title`
// (tweb `settings.tsx:413-416`).
export const AppKeyboardShortcutsTab =
  scaffoldSolidJSTab({
    title: 'KeyboardShortcuts.Title',
    getComponentModule: () => import('../sidebarLeft/tabs/keyboardShortcuts.solid'),
  })

// tweb :167-171 и :275-279. Обе формы обычные, без полезной нагрузки: обои
// вкладки читают сами (zustand `useSettingsStore`, фон чата — `ChatBackground.tsx`).
// «Обои» открывает строка «Общих» (tweb `generalSettings.tsx:65`), «Цвет» —
// кнопка SetColor самих «Обоев» (tweb `background.tsx:585`).
export const AppChatBackgroundTab =
  scaffoldSolidJSTab({
    title: 'ChatBackground',
    getComponentModule: () => import('../sidebarLeft/tabs/background.solid'),
  })

export const AppBackgroundColorTab =
  scaffoldSolidJSTab({
    title: 'SetColor',
    getComponentModule: () => import('../sidebarLeft/tabs/backgroundColor.solid'),
  })

// tweb :195-199. Форма обычная, без полезной нагрузки: каталог вкладка берёт
// сама (в свой `promiseCollector`). Открывает её строка «Quick Reaction» экрана
// «Стикеры и эмодзи» (tweb `stickersAndEmoji.tsx:60-66`); до переезда самого
// экрана (задача 15 плана 2D) — его React-строка через `getSettingsSliderHost`.
export const AppQuickReactionTab =
  scaffoldSolidJSTab({
    title: 'DoubleTapSetting',
    getComponentModule: () => import('../sidebarLeft/tabs/quickReaction.solid'),
  })

// tweb :241-245. Форма обычная, без полезной нагрузки: галочки вкладка читает
// сама (мост `useAppSettings`, `liteMode`). Открывает её строка «Общих»
// `LiteMode.Title` (tweb `generalSettings.tsx:89`).
export const AppPowerSavingTab =
  scaffoldSolidJSTab({
    title: 'LiteMode.Title',
    getComponentModule: () => import('../sidebarLeft/tabs/powerSaving.solid'),
  })

// tweb :385-400. Экран одной сессии: открывает строка «Устройств»
// (`activeSessions.solid.tsx::openSession`). Завершение приходит колбэком от
// списка — он же снимает строку; у текущей сессии колбэка нет (свою сессию не
// завершают, из неё выходят). `onSettingsChanged` оригинала (:392-393) не
// заведён: его зовёт только секция `AuthSessions.View.AcceptTitle`, а её нет —
// нет `account.changeAuthorizationSettings` (О-8 плана 2D).
type AppSessionTabPayload = {
  authorization: Authorization.authorization
  /** Подтверждает и завершает сессию; разрешается исходом. Нет у текущей. */
  onTerminate?: () => Promise<boolean>
}

export const AppSessionTab =
  scaffoldSolidJSTabEventable<AppSessionTabPayload>({
    title: 'AuthSessions.View.Device',
    getComponentModule: () => import('../sidebarLeft/tabs/session.solid'),
  })

// tweb :419-443 — «Данные и память» и её вкладки автозагрузки, все eventable:
// корень пишет квоту кэша на своём `destroy` (`dataAndStorage/index.tsx:83-87`).
// Открывает корень строка `DataSettings` корня настроек (tweb `settings.tsx`,
// `makeSubTabConfig`), вкладки автозагрузки — строки Photos/Videos/Files.
export const AppAutoDownloadPhotoTab =
  scaffoldSolidJSTabEventable({
    title: 'AutoDownloadPhotos',
    getComponentModule: () => import('../sidebarLeft/tabs/autoDownload/photo.solid'),
  })

export const AppAutoDownloadVideoTab =
  scaffoldSolidJSTabEventable({
    title: 'AutoDownloadVideos',
    getComponentModule: () => import('../sidebarLeft/tabs/autoDownload/video.solid'),
  })

export const AppAutoDownloadFileTab =
  scaffoldSolidJSTabEventable({
    title: 'AutoDownloadFiles',
    getComponentModule: () => import('../sidebarLeft/tabs/autoDownload/file.solid'),
  })

export const AppDataAndStorageTab =
  scaffoldSolidJSTabEventable({
    title: 'DataSettings',
    getComponentModule: () => import('../sidebarLeft/tabs/dataAndStorage/index.solid'),
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
  })

// tweb :1034-1063. Вкладка выбора участников на `AppSelectPeers` (задача 16
// плана 2D); открывают её исключения правил приватности (задача 17,
// `privacySection.tsx:189`). Заголовок — из полезной нагрузки: у оригинала это
// переопределённый `init` (`overrideTitle || payload.title`, :1060-1063), у нас —
// заголовок-функция фабрики, тот же результат; `GroupAddMembers` при
// обязательном `payload.title` не показывается и там. Чего в нагрузке нет
// (категории, участники канала, `peerLoader`, лимит) — шапка `addMembers.solid.tsx`.
// Типы — встроенным `import()`: блок вкладки дописывается в конец файла одним
// куском, шапку импортов параллельные задачи не делят.
type AppAddMembersTabPayload = {
  title: import('@/lang').LangPackKey
  placeholder: import('@/lang').LangPackKey
  type: 'channel' | 'chat' | 'privacy'
  takeOut?: (peerIds: PeerId[]) => Promise<unknown> | false | void
  skippable: boolean
  selectedPeerIds?: PeerId[]
  peerType?: import('@components/appSelectPeers.solid').SelectSearchPeerType[]
  exceptSelf?: boolean
  filterPeerTypeBy?: import('@components/appSelectPeers.solid').IsPeerType[]
  attachToPromise?: (promise: Promise<unknown>) => void
}

export const AppAddMembersTab =
  scaffoldSolidJSTab<AppAddMembersTabPayload>({
    title: (payload) => payload.title,
    getComponentModule: () => import('../sidebarLeft/tabs/addMembers.solid'),
  })
;(AppAddMembersTab as unknown as { noSame: boolean }).noSame = true
