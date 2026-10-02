/**
 * Колоночный слайдер левой колонки — `SidebarSlider` (`components/slider.ts`,
 * порт tweb `components/slider.ts`) над разметкой `#column-left`, ровно как его
 * заводит оригинал: `sidebarEl: #column-left`, `navigationType: 'left'`
 * (tweb `sidebarLeft/index.ts:147-152`). Вкладка №0 — `.item-main` колонки
 * (список чатов), все остальные экраны колонки — вкладки этого слайдера:
 * корень настроек `AppSettingsTab` и всё, что он открывает, папки, а по мере
 * переезда — контакты, новая группа/канал, звонки, архив (волна 7, этап 0а).
 *
 * ── ВРЕМЕННО до 2-1 (волна 7): модуль вместо класса `AppSidebarLeft` ────────
 *
 * У tweb слайдер колонки — это сам класс колонки (`AppSidebarLeft extends
 * SidebarSlider`, `sidebarLeft/index.ts:118`) и его синглтон
 * `appSidebarLeft` (`:1798`); вкладки открывают его как
 * `appSidebarLeft.createTab(AppXxxTab).open()`, а изнутри вкладки —
 * `tab.slider.createTab(…)`. У нас колонку пока рисует React (`Sidebar.tsx`),
 * поэтому класса нет, а синглтон — этот модуль: `Sidebar.tsx` заводит слайдер
 * на своём узле (`createColumnSlider`, после монтирования — узел рисует React),
 * открывающая сторона берёт его `getColumnSlider()`. Задача 2-1 волны 7
 * превращает слайдер в класс `AppSidebarLeft`, и модуль уходит.
 *
 * Узлом `.sidebar-slider` владеет React (его дети — `.item-main`), вкладками —
 * слайдер: он дописывает их в тот же контейнер (`slider.ts::addTab`), React про
 * них не знает и не трогает. Это правило шва спеки Solid-миграции § 7.
 *
 * ── Что здесь сверх оригинала ──────────────────────────────────────────────
 *  • `destroy()` — колонка у нас монтируется и размонтируется вместе с
 *    React-шеллом (выход, смена аккаунта, тесты), а у tweb живёт столько же,
 *    сколько страница. Вкладки обязаны умереть вместе с колонкой — иначе их
 *    Solid-острова, записи навигации и Esc-обработчики пережили бы её
 *    (`slider.ts::destroy`, ВРЕМЕННО до Э4-1: с узлами из `index.html`
 *    колонка станет вечной);
 *  • `openContactsTab` — вход во вкладку контактов для пунктов React-колонки
 *    (бургер «Контакты», `#new-menu` «Новый личный чат» и «Новый секретный
 *    чат»); у tweb это строки `createToolsMenu`/`createNewChatsMenuOptions`
 *    самого класса (`sidebarLeft/index.ts:695`, `:1079-1083`), ВРЕМЕННО до 2-1.
 */
import SidebarSlider from '@components/slider'
import type SliderSuperTab from '@components/sliderTab'
import { AppContactsTab, type AppContactsTabOptions } from '@components/solidJsTabs/tabs'
import pause from '@helpers/schedulers/pause'
import type { Managers } from '@/client/bootstrap'

/**
 * Зачаток `AppSidebarLeft` (ВРЕМЕННО до 2-1): из класса колонки перенесено
 * ровно то, что касается самих вкладок. Переопределение `createTab` для
 * свёрнутой колонки (настройки попапом, tweb :1730-1741) не перенесено — О-27
 * плана 2D.
 */
class ColumnSlider extends SidebarSlider {
  // tweb :1743-1753 — Every non-main tab in the left sidebar gets
  // `.item-secondary` (SCSS rules that target "secondary" tabs — ширина
  // вкладки у свёрнутой колонки, `_leftSidebar.scss:80-83`).
  public addTab(tab: SliderSuperTab) {
    super.addTab(tab)
    if(!tab.container.classList.contains('item-main')) {
      tab.container.classList.add('item-secondary')
    }
  }
}

let current: SidebarSlider | undefined

/**
 * Завести слайдер на узле колонки. Узел обязан нести разметку tweb
 * `.sidebar-slider.tabs-container > .tabs-tab.item-main` (`index.html:91-99`):
 * слайдер выбирает вкладку №0 в конструкторе (`slider.ts::constructor`,
 * tweb :46-48), и ею становится `.item-main`.
 *
 * `onTabsCountChange` — хук колонки (tweb `:652-654` →
 * `onSomethingOpenInsideChange`): число вкладок в навигации сменилось, колонке
 * пора пересчитать `has-open-tabs`.
 */
export function createColumnSlider(
  columnEl: HTMLElement,
  managers: Managers,
  onTabsCountChange?: () => void,
): SidebarSlider {
  // Слайдер ОДИН на колонку: он владеет историей вкладок, а история одна.
  current?.destroy()

  const slider = new ColumnSlider({ sidebarEl: columnEl, navigationType: 'left', managers })
  slider.onTabsCountChange = onTabsCountChange
  current = slider
  return slider
}

/** Колонка размонтирована — вкладки умирают с ней (см. шапку, ВРЕМЕННО до Э4-1). */
export function destroyColumnSlider(slider: SidebarSlider): void {
  slider.destroy()
  if(current === slider) {
    current = undefined
  }
}

/**
 * Слайдер для открывающей стороны — роль синглтона `appSidebarLeft`
 * (ВРЕМЕННО до 2-1). Бросает, а не молчит: открывают вкладки только строки
 * живой колонки, и пустой ответ означал бы мёртвую строку меню, а не законное
 * «нечего делать». Тот же приём, что у `useManagers` (`core/hooks/useManagers.tsx`).
 */
export function getColumnSlider(): SidebarSlider {
  if(!current) {
    throw new Error('columnSlider: вкладку открывают вне левой колонки — слайдер не заведён')
  }

  return current
}

/**
 * Открыть вкладку контактов — `this.createTab(AppContactsTab).open()` оригинала
 * (`sidebarLeft/index.ts:695`, `:1079-1083`). ВРЕМЕННО до 2-1 (см. шапку).
 *
 * `noSame` (tweb `solidJsTabs/tabs.ts:222`) отдаёт уже открытую вкладку, если
 * она сверху, и повторное открытие ничего не делает — как у оригинала. Сверх
 * него — Отступление В7-1: у вкладки есть наша опция `secret` («Новый
 * секретный чат»), и вкладка сверху с ДРУГОЙ опцией не годится — клик по
 * контакту в ней сделал бы не то, что выбрали в меню. Такая вкладка
 * закрывается, и после её ухода (та же пауза 200 мс, что у `closeTabsBefore`,
 * tweb `:1068`) открывается новая с нужной опцией.
 */
export async function openContactsTab(options?: AppContactsTabOptions): Promise<void> {
  const slider = getColumnSlider()
  const history = slider.getHistory()
  const top = history[history.length - 1]
  if(top instanceof AppContactsTab && !!(top.payload as AppContactsTabOptions | void)?.secret !== !!options?.secret) {
    top.close()
    await pause(200)
  }

  await slider.createTab(AppContactsTab).open(options)
}
