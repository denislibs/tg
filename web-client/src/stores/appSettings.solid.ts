/**
 * Порт tweb `src/stores/appSettings.ts` (1-47, 812502980) — API настроек клиента
 * для Solid-вкладок: `useAppSettings()` → `[appSettings, setAppSettings]`,
 * запись путём (`setAppSettings('notifications', 'desktop', value)`), чтение
 * `appSettings.notifications.desktop` реактивно.
 *
 * ── Источник данных — наш zustand, а не свой стор ───────────────────────────
 * У оригинала файл ВЛАДЕЕТ настройками: модульный `createStore<StateSettings>`
 * под `createRoot`, запись уходит в `appStateManager.setByKey`. У нас факт
 * настроек уже живёт в zustand `useSettingsStore` (`settings.tsx:178`): его
 * читают ~38 потребителей, включая ленту и `App.tsx`, он же пишет
 * `localStorage` в своём экшене и держит кросс-табовую синхронизацию. Второй
 * Solid-стор рядом был бы второй копией факта (`web-client/CLAUDE.md`,
 * «Владение фактами»), поэтому здесь его нет: чтение — `subscribeExternal`
 * над `useSettingsStore` (прецедент — `stores/peers.solid.ts`), запись — его
 * `update`. Стор настроек уезжает на Solid последним (спека Solid-миграции § 5).
 *
 * Расхождения с оригиналом:
 *  1. (О-2 плана 2D) Путь tweb переводится в плоский ключ zustand ОДНОЙ
 *     таблицей `APP_SETTINGS_KEYS` ниже (`notifications.desktop` →
 *     `notifyDesktop`). В таблице только ключи, которые читают портированные
 *     вкладки; каждая следующая вкладка дописывает свои строки. Путь вне
 *     таблицы — `throw` (и ошибка типов), а не молчаливый no-op: у оригинала
 *     любой путь `StateSettings` законен, у нас незаведённый путь значил бы
 *     переключатель, который ничего не сохраняет.
 *  2. Пишется только ЛИСТ. Запись поддерева (`setAppSettings('liteMode', obj)`,
 *     `('autoDownload', copy(...))` у tweb) и функция-обновитель
 *     `SetStoreFunction` не заведены: их потребители ещё не портированы;
 *     вкладка, которой они нужны, дописывает форму вместе со строками таблицы.
 *  3. `setAppSettings` возвращает уже разрешённый промис: `update` zustand
 *     синхронен и сам пишет `localStorage`; у оригинала промис — ответ
 *     `appStateManager.setByKey`. Форма возврата сохранена ради вызывающих
 *     (`Promise.all([...])` в `storageQuota.tsx:270-271`).
 *  4. `setAppSettingsSilent` не портирован: его единственный вызывающий у
 *     tweb — гидрация состояния (`index.ts:455`), у нас её делают `load()`
 *     на создании стора и `storage`-слушатель `settings.tsx`. Вкладки его не
 *     зовут.
 *  5. `appSettings` — не Solid-стор, а замороженное дерево геттеров: у
 *     каждого листа свой `createMemo`, поэтому эффект по одному пути не
 *     перезапускается от смены чужого ключа — та же гранулярность, что даёт
 *     стор оригинала.
 */
import { createMemo, createRoot, type Accessor } from 'solid-js'
import { MOUNT_CLASS_TO } from '@config/debug'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import { useSettingsStore, type Settings } from '@/settings'

type KeyTable = { readonly [key: string]: keyof Settings | KeyTable }

/** Путь tweb (`StateSettings`, `config/state.ts`) → плоский ключ `Settings`. */
const APP_SETTINGS_KEYS = {
  // tweb `config/state.ts:115-124` (`notifications`); дефолты — наши
  // (`settings.tsx::DEFAULTS`), у tweb `sound: false` (`:516-523`).
  notifications: {
    desktop: 'notifyDesktop',
    push: 'notifyPush',
    sound: 'notifySound',
    volume: 'notifyVolume',
    sentMessageSound: 'sentMessageSound',
  },
} as const satisfies KeyTable

type Table = typeof APP_SETTINGS_KEYS

type SettingsView<T> = {
  readonly [K in keyof T]: T[K] extends keyof Settings ? Settings[T[K]] : SettingsView<T[K]>
}

/** Настройки клиента в форме tweb `StateSettings` — в объёме таблицы. */
export type AppSettings = SettingsView<Table>

/** Кортежи `[...путь, значение]` для каждого листа таблицы. */
type SetArgs<T, P extends string[] = []> = {
  [K in keyof T & string]: T[K] extends keyof Settings
    ? [...P, K, Settings[T[K]]]
    : SetArgs<T[K], [...P, K]>
}[keyof T & string]

function buildView(table: KeyTable, state: Accessor<Settings>): object {
  const view = {}
  for(const [key, entry] of Object.entries(table)) {
    if(typeof entry === 'string') {
      const value = createMemo(() => state()[entry])
      Object.defineProperty(view, key, { get: value, enumerable: true })
    } else {
      Object.defineProperty(view, key, { value: buildView(entry, state), enumerable: true })
    }
  }

  return Object.freeze(view)
}

// Модульный `createRoot`, как у оригинала (`appSettings.ts:9`): подписка
// живёт столько же, сколько сам zustand-стор, — то есть всё приложение.
const appSettings = createRoot(() => buildView(
  APP_SETTINGS_KEYS,
  subscribeExternal(useSettingsStore.subscribe, useSettingsStore.getState),
)) as AppSettings

function resolveKey(path: string[]): keyof Settings {
  let entry: KeyTable | keyof Settings | undefined = APP_SETTINGS_KEYS
  for(const key of path) {
    entry = typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, key) ? entry[key] : undefined
  }

  if(typeof entry !== 'string') {
    // Текст — разработчику, не интерфейсу (`i18n/noHardcodedStrings.test.ts`).
    throw new Error(`appSettings: path "${path.join('.')}" is not in APP_SETTINGS_KEYS`)
  }

  return entry
}

function setAppSettings(...args: SetArgs<Table>): Promise<void> {
  const path = args.slice(0, -1) as string[]
  const value = args[args.length - 1]
  useSettingsStore.getState().update({ [resolveKey(path)]: value } as Partial<Settings>)
  return Promise.resolve()
}

const useAppSettings = () => [appSettings, setAppSettings] as const

export {
  appSettings,
  useAppSettings,
  setAppSettings,
}

// tweb :47 — `MOUNT_CLASS_TO && (…)`; `if` вместо `&&` — `no-unused-expressions`.
if(MOUNT_CLASS_TO) MOUNT_CLASS_TO.useAppSettings = useAppSettings
