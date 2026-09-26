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

// tweb :195-199. Форма обычная, без полезной нагрузки: каталог вкладка берёт
// сама (в свой `promiseCollector`). Открывает её строка «Quick Reaction» экрана
// «Стикеры и эмодзи» (tweb `stickersAndEmoji.tsx:60-66`); до переезда самого
// экрана (задача 15 плана 2D) — его React-строка через `getSettingsSliderHost`.
export const AppQuickReactionTab =
  scaffoldSolidJSTab({
    title: 'DoubleTapSetting',
    getComponentModule: () => import('../sidebarLeft/tabs/quickReaction.solid'),
  })
