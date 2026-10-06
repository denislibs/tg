// Порт tweb `src/config/state.ts`: ЕДИНЫЙ объект персистентного состояния
// приложения. Читается один раз батчем на старте (core/state/loadState.ts),
// живёт в памяти (stores/appState.ts), пишется по одному ключу write-through.
//
// Что сюда НЕ кладём (как и tweb): диалоги, сообщения, юзеров, me. Они лежат в
// своих сторах IndexedDB (tweb config/databases/state.ts:5) — State целиком
// перезаписывается на каждое изменение ключа, и сущности сделали бы это тяжёлым.
import type { Folder } from '../managers/foldersManager'

export interface AppState {
  /** версия схемы State (tweb STATE_VERSION) — при несовпадении стартуем с STATE_INIT */
  version: number
  /** папки-фильтры (tweb `filtersArr`) */
  folders: Folder[]
  /** свёрнутые пользователем пин-плашки: ключ `getPinnedMessagesKey(peerId, threadId)` → msgId
   *  (tweb `hiddenPinnedMessages`) */
  hiddenPinnedMessages: Record<string, number>
  /**
   * недавние в глобальном поиске (tweb `recentSearch`). У tweb там числовые
   * `PeerId[]`, у нас id чата — строка (`Chat.id`, data.ts:134), поэтому и
   * храним строки: разница модели, не поведения.
   */
  recentSearch: string[]
  /**
   * чаты, которые пользователь закрыл или откуда ушёл (tweb `recentlyClosedChats`,
   * `config/state.ts:248`) — фильтр «Closed» карточки чатов пустой колонки
   * (`components/chatTips/chatsCard.solid.tsx`). Ключ пира — строка, как у `recentSearch`.
   */
  recentlyClosedChats: string[]
  /** порядок закреплённых по папкам: folderId → peerId[] (tweb `pinnedOrders`) */
  pinnedOrders: Record<number, number[]>
  /**
   * выборки списка, загруженные целиком: проводная папка (0 — все, 1 — архив)
   * → признак (tweb `allDialogsLoaded`, lib/storages/dialogs.ts:262, :342-344).
   * Пишет и читает только владелец диалогов в воркере.
   */
  allDialogsLoaded: Record<number, boolean>
  /**
   * баланс звёзд; null — ни разу не загружался. Отличие от списков: у баланса `0`
   * это ЗАКОННОЕ значение, поэтому «пусто» и «не загружено» без явного null
   * не различить.
   */
  starsBalance: number | null
  /** пиры, у которых отключено подтверждение платного сообщения («Больше не
   *  спрашивать», tweb `dontShowPaidMessageWarningFor`, config/state.ts:264). Пишет
   *  `chat/paidMessagesInterceptor.ts`. */
  dontShowPaidMessageWarningFor: PeerId[]
  /** недавние эмодзи вкладки эмодзи-дропдауна (tweb `recentEmoji`, `lib/appManagers/appEmojiManager.ts`) */
  recentEmoji: string[]
  /** недавние свои эмодзи — id документов (tweb `recentCustomEmoji`) */
  recentCustomEmoji: DocId[]
  /** выбранный тон кожи по базовому эмодзи (tweb `emojiVariants`) */
  emojiVariants: { [emoji: string]: 0 | 1 | 2 | 3 | 4 | 5 }
  /** плашка заявок на вступление скрыта крестиком: ключ пира → когда (мс);
   *  через сутки она показывается снова, кадр заявок снимает скрытие сразу
   *  (tweb `hideChatJoinRequests`, `config/state.ts:254`) */
  hideChatJoinRequests: { [peerId: PeerId]: number }
}

// 2 — черновик переехал в САМ ДИАЛОГ (`dialog.draft`), ключа `drafts` в State
// больше нет. Старое состояние отбрасывается целиком, как у оригинала при
// несовпадении версии: список чатов и папки приедут с сервера, а черновики —
// вместе с диалогами.
export const STATE_VERSION = 2

/** tweb `STATE_INIT` — дефолты и одновременно источник списка ключей. */
export const STATE_INIT: AppState = {
  version: STATE_VERSION,
  folders: [],
  hiddenPinnedMessages: {},
  recentSearch: [],
  recentlyClosedChats: [],
  pinnedOrders: {},
  allDialogsLoaded: {},
  starsBalance: null,
  dontShowPaidMessageWarningFor: [],
  recentEmoji: [],
  recentCustomEmoji: [],
  emojiVariants: {},
  hideChatJoinRequests: {},
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
