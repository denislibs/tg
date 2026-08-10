// Порт tweb `src/config/state.ts`: ЕДИНЫЙ объект персистентного состояния
// приложения. Читается один раз батчем на старте (core/state/loadState.ts),
// живёт в памяти (stores/appState.ts), пишется по одному ключу write-through.
//
// Что сюда НЕ кладём (как и tweb): диалоги, сообщения, юзеров, me. Они лежат в
// своих сторах IndexedDB (tweb config/databases/state.ts:5) — State целиком
// перезаписывается на каждое изменение ключа, и сущности сделали бы это тяжёлым.
import type { Folder } from '../managers/foldersManager'
import type { Draft } from '../models'

export interface AppState {
  /** версия схемы State (tweb STATE_VERSION) — при несовпадении стартуем с STATE_INIT */
  version: number
  /** папки-фильтры (tweb `filtersArr`) */
  folders: Folder[]
  /** облачные черновики по чатам (tweb `drafts`) */
  drafts: Draft[]
  /** свёрнутые пользователем пин-плашки: chatId → msgId (tweb `hiddenPinnedMessages`) */
  hiddenPinnedMessages: Record<number, number>
  /**
   * недавние в глобальном поиске (tweb `recentSearch`). У tweb там числовые
   * `PeerId[]`, у нас id чата — строка (`Chat.id`, data.ts:134), поэтому и
   * храним строки: разница модели, не поведения.
   */
  recentSearch: string[]
  /** порядок закреплённых по папкам: folderId → chatId[] (tweb `pinnedOrders`) */
  pinnedOrders: Record<number, number[]>
  /**
   * баланс звёзд; null — ни разу не загружался. Отличие от списков: у баланса `0`
   * это ЗАКОННОЕ значение, поэтому «пусто» и «не загружено» без явного null
   * не различить.
   */
  starsBalance: number | null
}

export const STATE_VERSION = 1

/** tweb `STATE_INIT` — дефолты и одновременно источник списка ключей. */
export const STATE_INIT: AppState = {
  version: STATE_VERSION,
  folders: [],
  drafts: [],
  hiddenPinnedMessages: {},
  recentSearch: [],
  pinnedOrders: {},
  starsBalance: null,
}

/** tweb `ALL_KEYS = Object.keys(STATE_INIT)` (loadState.ts:43) */
export const STATE_KEYS = Object.keys(STATE_INIT) as (keyof AppState)[]

/**
 * Свежий экземпляр дефолтов. Нужен именно ГЛУБОКАЯ копия, а не `{ ...STATE_INIT }`:
 * при поверхностной вложенные `folders`/`hiddenPinnedMessages` остались бы теми же
 * объектами, что и в модульной константе, и первая же мутация отравила бы дефолты
 * на весь сеанс. В tweb по этой же причине везде `copy(STATE_INIT)`
 * (loadState.ts:122,164,204).
 */
export function initialState(): AppState {
  return structuredClone(STATE_INIT)
}
