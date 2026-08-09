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
  /** недавние в глобальном поиске (tweb `recentSearch`) */
  recentSearch: number[]
}

export const STATE_VERSION = 1

/** tweb `STATE_INIT` — дефолты и одновременно источник списка ключей. */
export const STATE_INIT: AppState = {
  version: STATE_VERSION,
  folders: [],
  drafts: [],
  hiddenPinnedMessages: {},
  recentSearch: [],
}

/** tweb `ALL_KEYS = Object.keys(STATE_INIT)` (loadState.ts:43) */
export const STATE_KEYS = Object.keys(STATE_INIT) as (keyof AppState)[]
