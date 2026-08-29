/**
 * Порт tweb `src/components/solidJsTabs/tabs.ts` — ОБЪЯВЛЕНИЯ вкладок:
 * заголовок, ленивый модуль содержимого и форма полезной нагрузки. Класс
 * вкладки собирает `scaffoldSolidJSTab*` (задача 6), сам модуль содержимого
 * подтягивается динамическим `import()` — только когда вкладку открыли.
 *
 * В оригинале файл держит ~60 объявлений разом; у нас пока ровно одно —
 * «Устройства» (первая настоящая Solid-вкладка). Остальные добавляются по
 * мере портирования, каждое своей задачей: перенести сюда объявление вкладки,
 * чей модуль ещё не портирован, значило бы завести `import()` в
 * несуществующий файл.
 *
 * Реестра `providedTabs` (второй элемент кортежа `useSuperTab()`) здесь нет
 * НАМЕРЕННО: в оригинале `AppActiveSessionsTab` в него тоже не входит
 * (`solidJsTabs/providedTabs.ts` — там шесть других вкладок), а реестр нужен
 * только тем вкладкам, которых открывают ПО ИМЕНИ из чужого модуля, объезжая
 * циклический импорт. У «Устройств» такого вызывающего нет ни там, ни здесь —
 * запись в `ProvidedTabs` была бы объявлением без потребителя.
 *
 * Форма вкладки — `scaffoldSolidJSTabEventable`, как в оригинале (:334): у
 * «Устройств» открывающая сторона слушает `destroy` вкладки.
 */
import type { Authorization } from '@layer'
import { scaffoldSolidJSTabEventable } from './scaffoldSolidJSTab.solid'

// tweb :330-332 — вкладка получает УЖЕ загруженный список сессий, а не ходит
// за ним сама: запрос делает открывающая сторона (у нас — задача 8), чтобы
// вкладка не въезжала пустой.
type AppActiveSessionsTabPayload = {
  authorizations: Authorization.authorization[]
}

export const AppActiveSessionsTab =
  scaffoldSolidJSTabEventable<AppActiveSessionsTabPayload>({
    title: 'SessionsTitle',
    getComponentModule: () => import('../sidebarLeft/tabs/activeSessions.solid'),
  })
