/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/solidJsTabs/superTabProvider.tsx` — контекст,
 * через который Solid-содержимое вкладки достаёт саму вкладку
 * (`useSuperTab()` → `[tab, ...]`), не протаскивая её пропом через каждый
 * уровень дерева. Один провайдер на вкладку, ставит его `scaffoldSolidJSTab`
 * (`scaffoldSolidJSTab.solid.tsx`).
 *
 * ── `ProvidedTabs` — единственное отличие от оригинала ──────────────────────
 * Второй элемент кортежа (:20, `useSuperTab`) в tweb — статический реестр
 * КЛАССОВ других вкладок (`providedTabs.ts`), нужен коду внутри одной
 * Solid-вкладки, чтобы открыть СОСЕДНЮЮ вкладку по имени, не импортируя её
 * напрямую (так объезжают циклические импорты между модулями вкладок — сами
 * тестовые модули друг на друга ссылаются). У нас пока нет НИ ОДНОЙ
 * конкретной Solid-вкладки (первая — «Устройства», задача 7 этой же волны),
 * то есть ни одного потребителя реестра: портировать `providedTabs.ts`
 * статическим списком сейчас значило бы завести файл с заведомо мёртвым
 * содержимым.
 *
 * Вместо списка — расширяемый `interface`: будущие задачи дописывают в него
 * поля через declaration merging прямо в модуле своей вкладки
 * (`interface ProvidedTabs { AppDevicesTab: typeof AppDevicesTab }`), без
 * повторного редактирования этого файла и БЕЗ циклических импортов, которые
 * в оригинале как раз и потребовали отдельного `providedTabs.ts`. Контракт
 * (кортеж из двух элементов) — тот же, что и в оригинале; отличается только
 * механизм наполнения второго элемента.
 */
import { createContext, useContext, type ParentComponent } from 'solid-js'
import type { InstanceOf } from '@types'
import type SliderSuperTab from '@components/sliderTab'

// Реестр для declaration merging, см. докблок файла. Пустой `interface` — не
// заглушка: сам факт объявления даёт другим модулям точку расширения ИМЕНИ
// `ProvidedTabs`, объединение полей будущих задач произойдёт по этому имени.
export interface ProvidedTabs {}

const SuperTabContext = createContext<[SliderSuperTab, ProvidedTabs]>()

type SuperTabProviderProps = {
  self: SliderSuperTab
}

export const SuperTabProvider: ParentComponent<SuperTabProviderProps> & {
  allTabs: ProvidedTabs
} = (props) => {
  return (
    <SuperTabContext.Provider value={[props.self, SuperTabProvider.allTabs]}>{props.children}</SuperTabContext.Provider>
  )
}

// Наполняется вкладками задач 7+ (тем же способом, что и `allTabs: {}` в
// оригинале — там же рядом стоит `// will get reassigned in index.ts`,
// :23). У нас единой точки reassign нет — каждая будущая задача добавляет
// СВОЮ вкладку своей строкой `SuperTabProvider.allTabs.AppXxxTab = AppXxxTab`
// РЯДОМ с declaration merging для `ProvidedTabs` в СВОЁМ модуле. Расхождение
// типа и рантайма здесь возможно (тип говорит «есть», забытое присваивание
// вернёт `undefined`) — тот же риск несёт и сам оригинал: там `AppNewGroupTab`
// объявлен в типе `ProvidedTabs`, но отсутствует в объекте `providedTabs`.
SuperTabProvider.allTabs = {} as ProvidedTabs

export const useSuperTab = <TabClass extends typeof SliderSuperTab>() =>
  useContext(SuperTabContext) as [InstanceOf<TabClass>, ProvidedTabs]
