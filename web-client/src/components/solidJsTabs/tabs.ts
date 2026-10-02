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
import type { LangPackKey } from '@/lang'
import type { MaybePromise } from '@types'
import type { PasscodeActions } from '@lib/passcode/actions'
import type SidebarSlider from '@components/slider'

// tweb :327-329 — вкладка получает УЖЕ загруженный список сессий, а не ходит
// за ним сама: запрос делает открывающая сторона (корень настроек —
// `settings.solid.tsx::onDevicesClick`), чтобы вкладка не въезжала пустой.
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

// tweb :27-53 — «Код-пароль»: главная вкладка и вкладка ввода кода, обе обычной
// формы. Открывает строка `PasscodeLock.Item.Title` раздела конфиденциальности
// (tweb `privacyAndSecurity.tsx:193-210`): при включённом коде — сначала ввод
// текущего кода.
export const AppPasscodeLockTab =
  scaffoldSolidJSTab({
    title: 'PasscodeLock.Title',
    getComponentModule: () => import('../sidebarLeft/tabs/passcodeLock/mainTab.solid'),
    onOpenAfterTimeout: function() {
      // Remove the previous enter password tab
      (this.slider as unknown as SidebarSlider).sliceTabsUntilTab(AppPrivacyAndSecurityTab, this)
    },
  })

type AppPasscodeEnterPasswordTabPayload = {
  onSubmit: (passcode: string, tab: InstanceType<typeof AppPasscodeEnterPasswordTab>, passcodeActions: PasscodeActions) => MaybePromise<void>

  inputLabel: LangPackKey
  buttonText: LangPackKey
}

export const AppPasscodeEnterPasswordTab =
  scaffoldSolidJSTab<AppPasscodeEnterPasswordTabPayload>({
    title: 'PasscodeLock.Title',
    getComponentModule: () => import('../sidebarLeft/tabs/passcodeLock/enterPasswordTab.solid'),
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
// экрана (задача 15 плана 2D) — его React-строка слайдером своей вкладки.
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

// ── Вкладки правил приватности (tweb :59-63, :301-367; задача 17 плана 2D) ────
// Все eventable: `PrivacySection` пишет правило на `destroy` вкладки
// (`privacySection.tsx:271`). Открывают их строки раздела «Конфиденциальность»
// (tweb `privacyAndSecurity.tsx:416-472`, хаб `AppPrivacyAndSecurityTab`).
// Расхождения с оригиналом:
//  • полезной нагрузки нет ни у одной: у tweb «Был в сети» и «Подарки» получают
//    `GlobalPrivacySettings` и шлют событие `privacy` (:355-365), «Сообщения» —
//    `onSaved` (:55-63); `globalPrivacySettings` у нас нет (О-18), «Сообщения» —
//    обычное правило (шапка `privacy/messages/tab.solid.tsx`), поэтому и форма
//    у неё eventable, а не обычная, как у tweb;
//  • «Подарки» и «Сохранённая музыка» (:337-341, :362-366) не заведены — ключей
//    нет (О-16);
//  • флаг `hide_read_marks` у «Был в сети» — наше правило `read_time` (шапка
//    `privacy/lastSeen.solid.tsx`, расхождение 1).
export const AppPrivacyAboutTab =
  scaffoldSolidJSTabEventable({
    title: 'UserBio',
    getComponentModule: () => import('../sidebarLeft/tabs/privacy/about.solid'),
  })

export const AppPrivacyCallsTab =
  scaffoldSolidJSTabEventable({
    title: 'PrivacySettings.VoiceCalls',
    getComponentModule: () => import('../sidebarLeft/tabs/privacy/calls.solid'),
  })

export const AppPrivacyVoicesTab =
  scaffoldSolidJSTabEventable({
    title: 'PrivacyVoiceMessages',
    getComponentModule: () => import('../sidebarLeft/tabs/privacy/voices.solid'),
  })

export const AppPrivacyAddToGroupsTab =
  scaffoldSolidJSTabEventable({
    title: 'PrivacySettings.Groups',
    getComponentModule: () => import('../sidebarLeft/tabs/privacy/addToGroups.solid'),
  })

export const AppPrivacyBirthdayTab =
  scaffoldSolidJSTabEventable({
    title: 'Birthday',
    getComponentModule: () => import('../sidebarLeft/tabs/privacy/birthday.solid'),
  })

export const AppPrivacyForwardMessagesTab =
  scaffoldSolidJSTabEventable({
    title: 'PrivacySettings.Forwards',
    getComponentModule: () => import('../sidebarLeft/tabs/privacy/forwardMessages.solid'),
  })

export const AppPrivacyProfilePhotoTab =
  scaffoldSolidJSTabEventable({
    title: 'PrivacyProfilePhoto',
    getComponentModule: () => import('../sidebarLeft/tabs/privacy/profilePhoto.solid'),
  })

export const AppPrivacyPhoneNumberTab =
  scaffoldSolidJSTabEventable({
    title: 'PrivacyPhone',
    getComponentModule: () => import('../sidebarLeft/tabs/privacy/phoneNumber.solid'),
  })

export const AppPrivacyLastSeenTab =
  scaffoldSolidJSTabEventable({
    title: 'PrivacyLastSeen',
    getComponentModule: () => import('../sidebarLeft/tabs/privacy/lastSeen.solid'),
  })

export const AppPrivacyMessagesTab =
  scaffoldSolidJSTabEventable({
    title: 'PrivacyMessages',
    getComponentModule: () => import('../sidebarLeft/tabs/privacy/messages/tab.solid'),
  })

// tweb :143-153 — задача 20 плана 2D. Период вкладка получает от открывающей
// стороны (строка `AutoDeleteMessages` хаба «Конфиденциальность», tweb
// `privacyAndSecurity.tsx:238-247`), а `onSaved` обновляет подпись той строки.
type AppMessagesAutoDeleteTabPayload = {
  period: number
  onSaved: (period: number) => void
}

export const AppMessagesAutoDeleteTab =
  scaffoldSolidJSTab<AppMessagesAutoDeleteTabPayload>({
    title: 'AutoDeleteMessages',
    getComponentModule: () => import('../sidebarLeft/tabs/autoDeleteMessages/index.solid'),
  })

// tweb :160-164. Форма обычная, без полезной нагрузки: настройки вкладка читает
// сама (мост `useAppSettings`). Открывает её строка корня настроек
// `Telegram.GeneralSettingsViewController` (tweb `settings.tsx:255`,
// `makeSubTabConfig`); она сама открывает «Обои» и «Энергосбережение».
export const AppGeneralSettingsTab =
  scaffoldSolidJSTab({
    title: 'Telegram.GeneralSettingsViewController',
    getComponentModule: () => import('../sidebarLeft/tabs/generalSettings.solid'),
  })

// ── «Динамики и камера» (tweb :181-185) — задача 26 плана 2D ─────────────────
// Форма обычная, без полезной нагрузки: выбор устройств вкладка читает сама
// (мост `useAppSettings`, `callDevices`). Открывают её строка корня настроек
// (tweb `settings.tsx:258`, `makeSubTabConfig`) и меню «⋮» вкладки «Звонки»
// (tweb `calls.tsx:363`: `tab.slider.createTab(AppSpeakersAndCameraTab).open()`).
export const AppSpeakersAndCameraTab =
  scaffoldSolidJSTab({
    title: 'AccountSettings.SpeakersAndCamera',
    getComponentModule: () => import('../sidebarLeft/tabs/speakersAndCamera.solid'),
  })

// ── Корень настроек (tweb :188-192) — задача 28 плана 2D ─────────────────────
// Вкладка левой колонки (`AppSidebarLeft`, `sidebarLeft/index.ts`); открывает её
// пункт «Настройки» бургера и колонки папок (tweb `sidebarLeft/index.ts:765`,
// `:841`). Форма обычная, без полезной нагрузки.
export const AppSettingsTab =
  scaffoldSolidJSTab({
    title: 'Settings',
    getComponentModule: () => import('../sidebarLeft/tabs/settings.solid'),
  })

// ── «Стикеры и эмодзи» (tweb :202-206) — задача 15 плана 2D ──────────────────
// Открывает строка `StickersName` корня настроек (tweb `settings.tsx:257`); сама
// открывает «Быструю реакцию». Форма обычная, без полезной нагрузки.
export const AppStickersAndEmojiTab =
  scaffoldSolidJSTab({
    title: 'StickersName',
    getComponentModule: () => import('../sidebarLeft/tabs/stickersAndEmoji.solid'),
  })

// ── «Конфиденциальность и безопасность» (tweb :651-667) — задача 23 плана 2D ──
// Открывает строка `AccountSettings.PrivacyAndSecurity` корня настроек (tweb
// `settings.tsx:254`, `makeSubTabConfig`). Форма eventable, как у оригинала.
// Предзагрузки `getInitArgs` (tweb :651-655, :667 — `appConfig`, `globalPrivacy`,
// `webAuthorizations`) нет: все три её предмета у нас отсутствуют (О-18 плана
// 2D), поэтому и полезной нагрузки у вкладки нет.
export const AppPrivacyAndSecurityTab =
  scaffoldSolidJSTabEventable({
    title: 'PrivacySettings',
    getComponentModule: () => import('../sidebarLeft/tabs/privacyAndSecurity.solid'),
  })

// tweb :84-98 — «Редактировать профиль» (`editProfile.solid.tsx`, задача 27
// плана 2D). Предзагрузку `getEditProfileInitArgs` зовёт открывающая сторона
// (⋮ корня настроек, tweb `settings.tsx:106`). Отличия от оригинала — шапка
// модуля: `me` берётся из зеркала `chatsStore` (мост чтения, п. 4), лимит bio —
// число серверного правила (О-64, п. 3), бизнес-бота нет (п. 6). Импорт — у
// блока, как у папок ниже: блок меняется одним куском.
import { useChatsStore } from '@stores/chatsStore'

export function getEditProfileInitArgs(): import('../sidebarLeft/tabs/editProfile.solid').EditProfileTabPayload {
  const me = useChatsStore.getState().me!
  return {
    bioMaxLength: 70,
    user: me.user,
    userFull: me.fullUser,
  }
}

export const AppEditProfileTab = Object.assign(
  scaffoldSolidJSTab<import('../sidebarLeft/tabs/editProfile.solid').EditProfileTabPayload>({
    title: 'EditAccount.Title',
    getComponentModule: () => import('../sidebarLeft/tabs/editProfile.solid'),
  }),
  { noSame: true },
)

// ── Папки (tweb :609-619, :804-845) — задача 24 плана 2D ─────────────────────
// Список (`chatFolders.solid.tsx`), редактор (`editFolder.solid.tsx`) и выбор
// чатов папки (`includedChats.solid.tsx` — кусок задачи 25, без него редактор не
// собрать). Формы обычные, как у оригинала; `getInitArgs` (предзагрузка
// заставки) и `deleteFolder` висят на конструкторе (`Object.assign`), их зовут
// корень настроек, меню папки (`helpers/dom/createFolderContextMenu.ts`) и сам
// список. `_onOpenAfterTimeout` — крючок содержимого: заставка играет после
// въезда. У `getChatFoldersInitArgs` нет `filters` (`:807`): список вкладка
// берёт из `appState.folders` сама. Типы — встроенным `import()`: блок
// дописывается в конец файла одним куском.
import { deleteFolder, getEditFolderInitArgs, preloadFolderAnimation } from '../sidebarLeft/tabs/editFolderShared'

type FolderTabHooks = { _onOpenAfterTimeout?: () => void }

function folderTabOpenAfterTimeout(this: SliderSuperTab) {
  (this as SliderSuperTab & FolderTabHooks)._onOpenAfterTimeout?.()
}

type AppIncludedChatsTabPayload = {
  filter: import('@core/managers/foldersManager').Folder
  type: 'included' | 'excluded'
  onSetFilter: (filter: import('@core/managers/foldersManager').Folder) => void
}

export const AppIncludedChatsTab =
  scaffoldSolidJSTab<AppIncludedChatsTabPayload>({
    title: (p) => p.type === 'included' ? 'FilterAlwaysShow' : 'FilterNeverShow',
    getComponentModule: () => import('../sidebarLeft/tabs/includedChats.solid'),
  })

function getChatFoldersInitArgs() {
  return {
    animationData: preloadFolderAnimation('Folders_1'),
  }
}

export const AppChatFoldersTab = Object.assign(
  scaffoldSolidJSTab<ReturnType<typeof getChatFoldersInitArgs>>({
    title: 'ChatList.Filter.List.Title',
    getComponentModule: () => import('../sidebarLeft/tabs/chatFolders.solid'),
    onOpenAfterTimeout: folderTabOpenAfterTimeout,
  }),
  { getInitArgs: getChatFoldersInitArgs },
)

type AppEditFolderTabPayload = ReturnType<typeof getEditFolderInitArgs> & {
  initFilter?: import('@core/managers/foldersManager').Folder
}

export const AppEditFolderTab = Object.assign(
  scaffoldSolidJSTab<AppEditFolderTabPayload>({
    title: 'FilterHeaderEdit',
    getComponentModule: () => import('../sidebarLeft/tabs/editFolder.solid'),
    onOpenAfterTimeout: folderTabOpenAfterTimeout,
  }),
  {
    getInitArgs: getEditFolderInitArgs,
    deleteFolder,
  },
)

// ── Ссылка папки (tweb :621-635) — задача 25 плана 2D ────────────────────────
// Вкладка «Share Folder» (`sharedFolder.solid.tsx`); открывает её редактор папки
// (`openChatlistInvite`). Событие `edit` оригинала не объявлено: его шлёт только
// галка выбора чатов ссылки, а у бэкенда нет `editExportedInvite` (О-23).
// `chatlistInvite` необязателен, как у оригинала на деле (`openChatlistInvite()`
// без ссылки — «нечем делиться»). Хук заставки — `folderTabOpenAfterTimeout`
// из блока папок выше.
type AppSharedFolderTabPayload = {
  filter: import('@core/managers/foldersManager').Folder
  chatlistInvite?: import('@core/managers/foldersManager').FolderInvite
}

export const AppSharedFolderTab =
  scaffoldSolidJSTabEventable<AppSharedFolderTabPayload, {
    delete: () => void
  }>({
    title: 'SharedFolder.Edit.Title',
    getComponentModule: () => import('../sidebarLeft/tabs/sharedFolder.solid'),
    onOpenAfterTimeout: folderTabOpenAfterTimeout,
  })

// ── Права группы (tweb :640-648) — задача 0б-6 волны 7 ───────────────────────
// Вкладка правой колонки «Разрешения» (`sidebarRight/tabs/groupPermissions/
// groupPermissions.solid.tsx`); открывает её редактор группы (`editChat`, 0б-1).
// ВРЕМЕННО до 0б-1: форма eventable, у tweb — обычная `scaffoldSolidJSTab`. Мосту
// React-`GroupEditFlow` нужно событие `close`, чтобы показать свой оверлей сразу,
// а не после выезда вкладки; `editChat` этого моста не держит.
type AppGroupPermissionsTabPayload = {
  chatId: ChatId
}

export const AppGroupPermissionsTab =
  scaffoldSolidJSTabEventable<AppGroupPermissionsTabPayload>({
    title: 'ChannelPermissions',
    getComponentModule: () => import('../sidebarRight/tabs/groupPermissions/groupPermissions.solid'),
    onOpenAfterTimeout: function() {
      this.scrollable.onScroll()
    },
  })

// ── Тип чата (tweb :536-540) — задача 0б-2 волны 7 ───────────────────────────
// Вкладка правой колонки «Тип канала / группы» (`sidebarRight/tabs/chatType.solid.tsx`);
// открывает её редактор чата (`editChat`, 0б-1). Заголовок `ChannelType` — как у
// оригинала: вкладка сама меняет его на `GroupType` для группы (`chatType :57`).
// `chatFull` — наш `ChannelFull` (у tweb `AppChatFull`); его поля читают секции,
// отложенные до бэкенда (О-15 волна 7, шапка вкладки).
export const AppChatTypeTab =
  scaffoldSolidJSTabEventable<{ chatId: ChatId, chatFull: import('@core/peers/peer').ChannelFull }>({
    title: 'ChannelType',
    getComponentModule: () => import('../sidebarRight/tabs/chatType.solid'),
  })

// ── Контакты (tweb :209-222) — задача 0а-1 плана волны 7 ─────────────────────
// Вкладка адресной книги (`contacts.solid.tsx`); её же открывает «Новый личный
// чат» (tweb `sidebarLeft/index.ts:1079-1083`, `:1105-1109`). Расхождения:
//  • `highlight: 'sort'` (ссылка `tg://contacts/sort` вспыхивает кнопкой
//    сортировки, `flashControl` из `lib/settingsSearch/highlight.ts`) не
//    заведена — О-31 волны 7: ни обработчика внутренних ссылок (Э5-4), ни поиска
//    по настройкам у нас нет, опция была бы без вызывающего;
//  • `secret` — Отступление В7-1: «Новый секретный чат» (E2E, у tweb пары нет)
//    открывает эту же вкладку, и клик по контакту начинает секретный чат, а не
//    открывает личный.
export type AppContactsTabOptions = {
  secret?: true
}

// the tab is mostly opened with nothing to point at
type AppContactsTabPayload = AppContactsTabOptions | void

export const AppContactsTab =
  scaffoldSolidJSTab<AppContactsTabPayload>({
    title: 'Contacts',
    getComponentModule: () => import('../sidebarLeft/tabs/contacts.solid'),
  })
;(AppContactsTab as unknown as { noSame: boolean }).noSame = true

// ── Passkeys (tweb :132-141) — задача 21 плана 2D ────────────────────────────
// Вкладка `passkeys.solid.tsx`; открывает её строка `Privacy.Passkeys`
// «Конфиденциальности». Список и сеттер — стор ОТКРЫВАЮЩЕГО
// (`privacyAndSecurity.tsx:134-135`, `:179`): удаление и создание во вкладке
// сразу видны строке родителя. Тип ключа — предметный `Passkey` (`layer.d.ts`).
type AppPasskeysTabPayload = {
  passkeys: import('@layer').Passkey[]
  setPasskeys: import('solid-js/store').SetStoreFunction<import('@layer').Passkey[]>
}

export const AppPasskeysTab =
  scaffoldSolidJSTab<AppPasskeysTabPayload>({
    title: 'Privacy.Passkeys',
    getComponentModule: () => import('../sidebarLeft/tabs/passkeys.solid'),
  })

// ── Заблокированные (tweb :248-258) — задача 22 плана 2D ─────────────────────
// Вкладка `blockedUsers.solid.tsx`; открывает её хаб «Конфиденциальность» с уже
// загруженной первой страницей (tweb `privacyAndSecurity.tsx:217`). После въезда
// — `scrollable.onScroll()`: короткая первая страница сразу догружает следующую.
type AppBlockedUsersTabPayload = {
  peerIds: PeerId[]
}

export const AppBlockedUsersTab =
  scaffoldSolidJSTab<AppBlockedUsersTabPayload>({
    title: 'BlockedUsers',
    getComponentModule: () => import('../sidebarLeft/tabs/blockedUsers.solid'),
    onOpenAfterTimeout: function() {
      this.scrollable.onScroll()
    },
  })

// ── «Новый канал» (tweb :262-270) — задача 0а-3 плана волны 7 ───────────────
// Форма обычная, `noSame` — как у оригинала. Полезной нагрузки нет: `onCreate`/
// `openAfter` оригинала нужны только сообществам, которых у нас нет
// (расхождение 1 шапки `newChannel.solid.tsx`).
export const AppNewChannelTab =
  scaffoldSolidJSTab({
    title: 'NewChannel',
    getComponentModule: () => import('../sidebarLeft/tabs/newChannel.solid'),
  })
;(AppNewChannelTab as unknown as { noSame: boolean }).noSame = true
// ── «Новая группа» (tweb :282-296) — задача 0а-2 плана волны 7 ───────────────
// Второй шаг флоу `createNewGroupTab` (`sidebarLeft/tabs/createNewGroupTab.ts`):
// открывает его `takeOut` вкладки выбора участников. Из нагрузки оригинала —
// только `peerIds`: `isGeoChat` у tweb без вызывающих (группа «рядом» снята),
// а `onCreate`/`openAfter`/`title`/`asChannel` передаёт лишь добавление чата в
// сообщество (`communities/addChatToCommunity.tsx:35`) — сообществ нет (О-5).
type AppNewGroupTabPayload = {
  peerIds: PeerId[]
}

export const AppNewGroupTab =
  scaffoldSolidJSTab<AppNewGroupTabPayload>({
    title: 'NewGroup',
    getComponentModule: () => import('../sidebarLeft/tabs/newGroup.solid'),
  })
;(AppNewGroupTab as unknown as { noSame: boolean }).noSame = true

// ── «Звонки» (tweb :225-230) — задача 0а-4 волны 7 ──────────────────────────
// Журнал звонков левой колонки (`calls.solid.tsx`). `noSame` — как у оригинала:
// повторный пункт «Звонки» при уже открытой вкладке не кладёт вторую. Вкладки
// `AppNewCallTab` (tweb :233-238) нет — она целиком про конференции, О-1
// (шапка `calls.solid.tsx`, расхождение 1).
export const AppCallsTab =
  scaffoldSolidJSTab({
    title: 'Calls',
    getComponentModule: () => import('../sidebarLeft/tabs/calls.solid'),
  })
;(AppCallsTab as unknown as { noSame: boolean }).noSame = true

// ── «Изменить контакт» (tweb :509-513) — задача 0б-10 плана волны 7 ───────────
// Вкладка правой колонки (`sidebarRight/tabs/editContact.solid.tsx`); полезная
// нагрузка — ключ пира, заголовок вкладка переписывает сама («Edit» или
// «AddContactTitle» — по тому, контакт ли это, `editContact.tsx:42`).
export const AppEditContactTab =
  scaffoldSolidJSTab<PeerId>({
    title: 'Edit',
    getComponentModule: () => import('../sidebarRight/tabs/editContact.solid'),
  })

// ── Поиск GIF и стикеров правой колонки (tweb :458-462, :521-525) — задача 0б-11 ─
// Обе обычной формы и без полезной нагрузки, как у оригинала: колонку вкладки берут
// у синглтона `appSidebarRight`, отправку в чат — у `appImManager.chat` (мост
// `sidebarRight/tabs/emoticonsSearchBridge.ts`, ВРЕМЕННО до Э4-3).
// Открывает их лупа нижней полосы панели эмодзи (tweb `emoticonsDropdown/index.ts:300-310`).
export const AppGifsTab =
  scaffoldSolidJSTab({
    title: 'SearchGifsTitle',
    getComponentModule: () => import('../sidebarRight/tabs/gifs.solid'),
  })

export const AppStickersTab =
  scaffoldSolidJSTab({
    title: 'StickersName',
    getComponentModule: () => import('../sidebarRight/tabs/stickers.solid'),
  })
