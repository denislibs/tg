// Порт tweb `src/lib/appManagers/appTabsManager.ts` (812502980) — реестр вкладок воркера
// и их состояния (`TabState`, tweb `apiManagerProxy.ts:168-173`). Состояние шлёт вкладка
// (`client/tabState.ts`, tweb `apiManagerProxy.updateTabState` `:1400-1407`), воркер на
// каждой смене зовёт `onTabStateChange` — по нему автоблокировка узнаёт, что все вкладки
// простаивают (`core/workerCore.ts`, tweb `index.worker.ts:396-404`).
//
// Расхождения с оригиналом:
//  1. `TabState` — только `idleStartTime`: `accountNumber`, `chatPeerIds`, `id` и рассылка
//     `tabsUpdated` вкладкам (уведомления, звук отправки, мультиаккаунт) — Б-17.
//  2. Подписка на `tabState` — не `start()` с синглтоном порта, а обработчик канала на
//     каждом порту в `workerCore.ts::bind` (`setTabState`); источник — порт вкладки.

/** tweb `apiManagerProxy.ts:168-173` — расхождение 1. */
export type TabState = {
  idleStartTime: number
}

/** Канал состояния вкладки (tweb `mainMessagePort.ts:55` `tabState`). */
export const TAB_STATE_CHANNEL = 'tabState'
/** Канал «непрерываемого занятия» вкладки (tweb `mainMessagePort.ts:69`). */
export const TOGGLE_UNINTERUPTABLE_ACTIVITY_CHANNEL = 'toggleUninteruptableActivity'

export type ToggleUninteruptableActivityPayload = { activity: string, active: boolean }

type Tab<Source> = {
  source: Source,
  state: TabState | undefined
}

export class AppTabsManager<Source = unknown> {
  private tabs = new Map<Source, Tab<Source>>()

  public onTabStateChange = () => {}

  /** tweb `start()` `:20-27` — обработчик `tabState` (расхождение 2). */
  public setTabState(source: Source, state: TabState) {
    const tab = this.tabs.get(source)
    if(!tab) return
    tab.state = state

    this.onTabStateChange()
  }

  public getTabs() {
    return [...this.tabs.values()].filter((tab): tab is { source: Source, state: TabState } => !!tab.state)
  }

  public addTab(source: Source) {
    const tab: Tab<Source> = {
      source,
      state: undefined,
    }

    this.tabs.set(source, tab)
    this.onTabStateChange()
  }

  public deleteTab(source: Source) {
    this.tabs.delete(source)
    this.onTabStateChange()
  }
}
