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
 *  2. Формы записи — те, что зовут портированные вкладки: лист; путь ВНУТРЬ
 *     значения-объекта (`('autoDownload', 'photo', 'groups', v)` — ключ
 *     zustand `autoDownloadPhoto` держит объект целиком, поле меняется
 *     неизменяемой копией); поддерево (`('autoDownload', copy(...))`) — одним
 *     `update`, со слиянием по ключам объекта на верхнем уровне и заменой
 *     ниже, как `setStore(путь, объект)` Solid-стора оригинала (`mergeStoreNode`
 *     сливает только первый уровень). Функция-обновитель `SetStoreFunction` не
 *     заведена: её потребители ещё не портированы.
 *     `liteMode` — лист: в zustand это ОДИН ключ-объект формы tweb
 *     (`settings.tsx`), поэтому `setAppSettings('liteMode', obj)`
 *     «Энергосбережения» (`powerSaving.tsx:108`) ложится как есть, а
 *     `appSettings.liteMode.all` реактивен через мемо листа. Наше меню «Ещё»
 *     (tweb `sidebarLeft/index.ts:1028`) — React и пишет zustand напрямую.
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
 *  6. Лист может нести преобразование (`codec`), когда смысл нашего ключа
 *     обратен пути tweb: `autoDownloadNew.pFlags.disabled` (`true | undefined`,
 *     tweb `dataAndStorage/index.tsx:57`, `:69`) ↔ наш `autoDownloadEnabled`.
 *     Переименовать ключ zustand ради формы tweb нельзя — его читает лента
 *     (`core/hooks/useChatAutoDownload.ts`) и он лежит в `localStorage`.
 *  7. `SETTINGS_INIT` — то же представление над `DEFAULTS` (`settings.tsx`), а
 *     не отдельная копия дефолтов в форме tweb (`config/state.ts:450-588`):
 *     дефолт у нас один. В нём только пути таблицы.
 */
import { createMemo, createRoot, type Accessor } from 'solid-js'
import { MOUNT_CLASS_TO } from '@config/debug'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import { DEFAULTS, useSettingsStore, type Settings } from '@/settings'

const CODEC = Symbol('appSettingsCodec')

/** Лист с преобразованием: значение по пути tweb ↔ значение нашего ключа. */
type Codec<K extends keyof Settings = keyof Settings, V = unknown> = {
  readonly [CODEC]: true
  readonly key: K
  readonly get: (value: Settings[K]) => V
  readonly set: (value: V) => Settings[K]
}

function codec<K extends keyof Settings, V>(
  key: K,
  get: (value: Settings[K]) => V,
  set: (value: V) => Settings[K],
): Codec<K, V> {
  return { [CODEC]: true, key, get, set }
}

/** Любой `Codec`: параметры — `never`, чтобы конкретный был ему присваиваем. */
type AnyCodec = {
  readonly [CODEC]: true
  readonly key: keyof Settings
  readonly get: (value: never) => unknown
  readonly set: (value: never) => unknown
}

type Leaf = keyof Settings | AnyCodec
type KeyTable = { readonly [key: string]: Leaf | KeyTable }

const isLeaf = (entry: Leaf | KeyTable): entry is Leaf => typeof entry === 'string' || CODEC in entry

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
  // tweb `config/state.ts:67-76` — «Данные и память» и автозагрузка
  // (`sidebarLeft/tabs/dataAndStorage`, `autoDownload`). Из `autoDownloadNew`
  // (`AutoDownloadSettings` MTProto) у нас есть только выключатель и предел
  // размера файла — остальные поля у tweb читает лишь его менеджер загрузок.
  autoDownload: {
    photo: 'autoDownloadPhoto',
    video: 'autoDownloadVideo',
    file: 'autoDownloadFile',
  },
  autoDownloadNew: {
    pFlags: {
      disabled: codec(
        'autoDownloadEnabled',
        (enabled): true | undefined => enabled ? undefined : true,
        (disabled: true | undefined) => !disabled,
      ),
    },
    file_size_max: 'autoDownloadFileSizeMax',
  },
  // tweb `config/state.ts:127` — объект галочек «Энергосбережения» (задача 11)
  liteMode: 'liteMode',
  // tweb `config/state.ts:148-154` (`passcode`) — вкладка «Код-пароль» (задача 18)
  // и экран блокировки (`canAttemptAgainOn` — срок следующей попытки,
  // `passcodeLock/passcodeLockScreen.solid.tsx`).
  passcode: {
    enabled: 'passcodeEnabled',
    autoLockTimeoutMins: 'passcodeAutoLockMins',
    lockShortcutEnabled: 'passcodeLockShortcutEnabled',
    lockShortcut: 'passcodeLockShortcut',
    canAttemptAgainOn: 'passcodeCanAttemptAgainOn',
  },
  // tweb `config/state.ts:159-160`
  cacheTTL: 'cacheTTL',
  cacheSize: 'cacheSize',
  // tweb `config/state.ts` — «Общие» (задача 13): `messagesTextSize`, `theme`
  // (значения совпадают с нашим `ThemeChoice` один в один: day = Classic,
  // light = Day, night, tinted = Dark, system), `timeFormat` ('h12' | 'h23' ↔
  // наш '12h' | '24h' — его читают `settings.tsx::hourCycle` и `localStorage`).
  messagesTextSize: 'textSize',
  theme: 'themeChoice',
  timeFormat: codec(
    'timeFormat',
    (format): 'h12' | 'h23' => format === '12h' ? 'h12' : 'h23',
    (format: 'h12' | 'h23') => format === 'h12' ? '12h' : '24h',
  ),
  // tweb `config/state.ts` (`settings.tabsInSidebar`) — «Расположение папок»
  // вкладки «Папки» (задача 24)
  tabsInSidebar: 'tabsInSidebar',
} as const satisfies KeyTable

type Table = typeof APP_SETTINGS_KEYS

type LeafValue<E> = E extends keyof Settings ? Settings[E] : E extends { get: (value: never) => infer V } ? V : never

type SettingsView<T> = {
  readonly [K in keyof T]: T[K] extends Leaf ? LeafValue<T[K]> : SettingsView<T[K]>
}

/** Настройки клиента в форме tweb `StateSettings` — в объёме таблицы. */
export type AppSettings = SettingsView<Table>

/** Путь на одно поле ВНУТРЬ значения-объекта листа. */
type InnerArgs<V, P extends string[]> = V extends object
  ? { [K in keyof V & string]: [...P, K, V[K]] }[keyof V & string]
  : never

/** Кортежи `[...путь, значение]`: лист, поле значения-объекта, поддерево. */
type SetArgs<T, P extends string[] = []> = {
  [K in keyof T & string]: T[K] extends Leaf
    ? [...P, K, LeafValue<T[K]>] | InnerArgs<LeafValue<T[K]>, [...P, K]>
    : [...P, K, Partial<SettingsView<T[K]>>] | SetArgs<T[K], [...P, K]>
}[keyof T & string]

function buildView(table: KeyTable, state: Accessor<Settings>): object {
  const view = {}
  for(const [key, entry] of Object.entries(table)) {
    if(isLeaf(entry)) {
      const value = typeof entry === 'string' ?
        createMemo(() => state()[entry]) :
        createMemo(() => entry.get(state()[entry.key] as never))
      Object.defineProperty(view, key, { get: value, enumerable: true })
    } else {
      Object.defineProperty(view, key, { value: buildView(entry, state), enumerable: true })
    }
  }

  return Object.freeze(view)
}

// Модульный `createRoot`, как у оригинала (`appSettings.ts:9`): подписка
// живёт столько же, сколько сам zustand-стор, — то есть всё приложение.
const [appSettings, SETTINGS_INIT] = createRoot(() => [
  buildView(APP_SETTINGS_KEYS, subscribeExternal(useSettingsStore.subscribe, useSettingsStore.getState)),
  buildView(APP_SETTINGS_KEYS, () => DEFAULTS),
]) as [AppSettings, AppSettings]

const pathError = (path: string[]) =>
  // Текст — разработчику, не интерфейсу (`i18n/noHardcodedStrings.test.ts`).
  new Error(`appSettings: path "${path.join('.')}" is not in APP_SETTINGS_KEYS`)

const own = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)

/** Неизменяемая запись `value` по пути `path` внутри объекта `obj`. */
function setIn(obj: unknown, path: string[], value: unknown): unknown {
  const [key, ...rest] = path
  const base = (obj ?? {}) as Record<string, unknown>
  return { ...base, [key]: rest.length ? setIn(base[key], rest, value) : value }
}

function writeLeaf(entry: Leaf, value: unknown, patch: Record<string, unknown>) {
  if(typeof entry === 'string') patch[entry] = value
  else patch[entry.key] = entry.set(value as never)
}

/** Поддерево: `merge` — слияние по ключам объекта (верхний уровень), ниже — замена. */
function writeTree(table: KeyTable, value: unknown, patch: Record<string, unknown>, merge: boolean) {
  const obj = (value ?? {}) as Record<string, unknown>
  for(const [key, entry] of Object.entries(table)) {
    if(merge && !own(obj, key)) continue
    if(isLeaf(entry)) writeLeaf(entry, obj[key], patch)
    else writeTree(entry, obj[key], patch, false)
  }
}

function setAppSettings(...args: SetArgs<Table>): Promise<void> {
  const path = args.slice(0, -1) as string[]
  const value = args[args.length - 1]
  const patch: Record<string, unknown> = {}

  let entry: Leaf | KeyTable = APP_SETTINGS_KEYS
  let depth = 0
  while(depth < path.length && !isLeaf(entry)) {
    const key: string = path[depth++]
    if(!own(entry, key)) throw pathError(path)
    entry = entry[key]
  }

  const inner = path.slice(depth)
  if(!isLeaf(entry)) {
    writeTree(entry, value, patch, true)
  } else if(!inner.length) {
    writeLeaf(entry, value, patch)
  } else if(typeof entry === 'string') {
    const current = useSettingsStore.getState()[entry]
    if(typeof current !== 'object' || current === null || !own(current, inner[0])) throw pathError(path)
    patch[entry] = setIn(current, inner, value)
  } else {
    throw pathError(path)
  }

  useSettingsStore.getState().update(patch as Partial<Settings>)
  return Promise.resolve()
}

const useAppSettings = () => [appSettings, setAppSettings] as const

export {
  appSettings,
  useAppSettings,
  setAppSettings,
  SETTINGS_INIT,
}

// tweb :47 — `MOUNT_CLASS_TO && (…)`; `if` вместо `&&` — `no-unused-expressions`.
if(MOUNT_CLASS_TO) MOUNT_CLASS_TO.useAppSettings = useAppSettings
