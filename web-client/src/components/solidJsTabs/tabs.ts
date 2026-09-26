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
