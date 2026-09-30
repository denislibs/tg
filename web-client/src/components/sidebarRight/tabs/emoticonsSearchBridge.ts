/**
 * ВРЕМЕННЫЙ мост вкладок «Поиск стикеров» и «Поиск GIF» (`stickers.solid.tsx`,
 * `gifs.solid.tsx`) к двум синглтонам tweb, которых у нас ещё нет. Оригинал
 * берёт их `useHotReloadGuard()` (tweb `stickers.tsx:22`, `gifs.tsx:18`); HMR-
 * охранника у нас нет (шапка `solidJsTabs/scaffoldSolidJSTab.solid.tsx`), и
 * синглтоны вкладки импортируют напрямую — там, где они есть.
 *
 *  • `appSidebarRight` — ВРЕМЕННО до 0б-11 (врезка): класс колонки
 *    (`components/sidebarRight/index.ts`) пишет задача 0б-0; на врезке вкладки
 *    импортируют его синглтон, поле уходит.
 *  • `appImManager.chat` — ВРЕМЕННО до Э4-3: активный инстанс чата (React
 *    `Chat.tsx`) кладёт сюда собеседника и отправку документа своим композером
 *    (tweb `appImManager.chat.peerId`, `chat.input.sendMessageWithDocument`,
 *    `input.ts:4341`); с `ChatFacade` (Э4-3) вкладки читают `appImManager.chat`.
 *
 * Имена полей — имена tweb, чтобы снятие моста было заменой импорта, а не
 * переписыванием вызовов.
 */
import type SidebarSlider from '@components/slider'
import type { GifItem } from '@core/gifs'
import type { Sticker } from '@core/managers/stickersManager'

/** То, что вкладкам нужно от `AppSidebarRight` (tweb `sidebarRight/index.ts:104`). */
export type EmoticonsSearchSidebar = SidebarSlider & {
  toggleSidebar(enable?: boolean): Promise<void>
}

/**
 * То, что вкладкам нужно от инстанса чата. Документ — сам объект, а не id
 * (tweb отдаёт `docId` и достаёт документ `appDocsManager.getDoc`): стикер у нас
 * приезжает документом в выдаче набора, GIF поиска — элементом Tenor.
 */
export type EmoticonsSearchChat = {
  peerId: PeerId
  input: {
    sendMessageWithDocument(options: { document: Sticker | GifItem, target?: HTMLElement }): boolean | Promise<boolean>
  }
}

export const emoticonsSearchBridge: {
  appSidebarRight?: EmoticonsSearchSidebar
  appImManager: { chat?: EmoticonsSearchChat }
} = {
  appImManager: {},
}
