/**
 * ВРЕМЕННО до Э4-3 — мост вкладок «Поиск стикеров» и «Поиск GIF»
 * (`stickers.solid.tsx`, `gifs.solid.tsx`) к `appImManager.chat` tweb
 * (`stickers.tsx:22`, `gifs.tsx:18` — `useHotReloadGuard()`). Класса
 * `AppImManager` ещё нет: активный инстанс чата (React `Chat.tsx`) кладёт сюда
 * собеседника и отправку документа своим композером (tweb
 * `chat.peerId`, `chat.input.sendMessageWithDocument`, `input.ts:4341`) и
 * снимает, когда перестаёт быть активным. С `ChatFacade` (Э4-3) вкладки
 * импортируют настоящий `appImManager`; имя экспорта и полей — имена tweb,
 * поэтому снятие моста — замена строки импорта.
 */
import type { GifItem } from '@core/gifs'
import type { Sticker } from '@core/managers/stickersManager'

/**
 * То, что вкладкам нужно от инстанса чата. Документ — сам объект, а не id
 * (tweb отдаёт `docId` и достаёт документ `appDocsManager.getDoc`): стикер у нас
 * приезжает документом в выдаче набора, GIF поиска — элементом Tenor (О-27).
 * Ответ — «ушло ли» (tweb `Promise<boolean>`): без прав отправки — `false`.
 */
export type EmoticonsSearchChat = {
  peerId: PeerId
  input: {
    sendMessageWithDocument(options: { document: Sticker | GifItem, target?: HTMLElement }): boolean | Promise<boolean>
  }
}

export const appImManager: { chat?: EmoticonsSearchChat } = {}
