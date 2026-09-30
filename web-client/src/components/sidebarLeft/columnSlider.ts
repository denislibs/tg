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
 *  • `openActiveSessionsTab` — общий вход во «Устройства» для React-экрана
 *    «Конфиденциальности» (ВРЕМЕННО до 2D-23: хаб станет вкладкой и откроет
 *    «Устройства» своим `tab.slider`, как корень настроек уже делает сам —
 *    `sidebarLeft/tabs/settings.solid.tsx::onDevicesClick`).
 */
import SidebarSlider from '@components/slider'
import type SliderSuperTab from '@components/sliderTab'
import { AppActiveSessionsTab } from '@components/solidJsTabs/tabs'
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
 * Открыть «Устройства» из React-экрана «Конфиденциальности» — порт
 * `openActiveSessions` (tweb `sidebarLeft/newAuthorization.tsx:116-121`):
 * список сессий забирает ОТКРЫВАЮЩИЙ и отдаёт вкладке готовым, чтобы та не
 * въезжала пустой. ВРЕМЕННО до 2D-23 (см. шапку).
 *
 * Слайдер берётся ДО запроса: у оригинала на его месте вечный синглтон
 * `appSidebarLeft`, снимок ссылки — ближайший аналог. Если колонку снимут, пока
 * летит `sessions.list()`, вкладка тихо гаснет о предохранитель
 * `slider.selectTab`, а не бросает на чужом экране.
 */
export async function openActiveSessionsTab(managers: Managers): Promise<void> {
  const slider = getColumnSlider()
  const authorizations = await managers.sessions.list()
  await slider.createTab(AppActiveSessionsTab).open({ authorizations })
}
