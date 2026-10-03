// ВРЕМЕННО до К-4: шов попапа отправки медиа. У tweb на этом месте
// `components/popups/newMedia.tsx` (2328 строк, попап «Отправить фото/файл»);
// у нас попап — React `components/messages/SendMediaPopup.tsx`, и до К-4 его
// рисует остров композера (`components/chat/reactChatInputView.tsx`, состояние
// `pendingMedia` в `useChatSend`). Здесь — ровно две точки входа оригинала,
// которые зовёт блок K `lib/appImManager.ts` (вставка и сброс файлов):
//  - `showNewMediaPopup` (tweb `:185`) — открыть попап с файлами;
//  - `getCurrentNewMediaPopup` (tweb `:156`) — открытый попап, чтобы дописать в
//    него файлы (`addFiles`, tweb `newMedia.tsx` `addFiles`).
// К-4 заменяет тела (попап через `popupStore`, остров оверлеев), сигнатуры
// остаются — контракт К-4.
//
// Расхождения с оригиналом:
//  1. Аргументы `ignoreInputValue`, `gifDocument`, `ephemeralSnapshot` — без
//     предмета (подпись из поля ввода попап не берёт, GIF из стикер-меню и
//     эфемерного композера нет).
//  2. У открытого попапа только `addFiles`: зон сброса внутри попапа
//     (`appendDrops`, `Preview.Dragging.AddItems`) у `SendMediaPopup` нет — бэклог Б-83.
import type Chat from '@components/chat/chat'

/** tweb `newMedia.tsx` `WillAttachType` в объёме вложений из буфера и сброса. */
export type WillAttachType = 'media' | 'document'

/** Открытый попап — то, что у него зовёт блок K. */
export type NewMediaPopup = {
  addFiles(files: File[]): void
}

let currentPopup: NewMediaPopup | undefined

/** tweb `newMedia.tsx:156` */
export function getCurrentNewMediaPopup() {
  return currentPopup
}

/** Писатель — дерево острова композера: попап открыт ↔ `popup` задан. */
export function setCurrentNewMediaPopup(popup: NewMediaPopup | undefined) {
  currentPopup = popup
}

/** tweb `newMedia.tsx:185` — до К-4 попап открывает остров композера чата. */
export default function showNewMediaPopup(chat: Chat, inputFiles: File[], willAttachType: WillAttachType) {
  chat.input.showNewMediaPopup(inputFiles, willAttachType)
}
