// ВРЕМЕННО до 2C-15 — мост вместо `showStickersPopup` из tweb
// `src/components/popups/stickers.tsx` (812502980): Solid-попап набора портирует задача 2C-15,
// до неё набор открывает React `StickerSetModal` (остров оверлеев). Вызывающие — эмодзи-дропдаун
// (`emoticonsDropdown/tabs/{emoji,stickers}.ts`, меню `helpers/dom/createStickersContextMenu.ts`).
// Выбор стикера в попапе шлёт его в чат строки ввода (`chatInput.sendMessageWithDocument`, как
// у оригинала, `stickers.tsx:276-283`). Признак `isEmojis` попапу не нужен — он сам видит вид набора.
import type { InputStickerSetAddress, Sticker } from '@core/managers/stickersManager'
import type ChatInput from '@components/chat/input'

export default function showStickersPopup(input: InputStickerSetAddress, _isEmojis?: boolean, chatInput?: ChatInput) {
  const onPick = chatInput ? (doc: Sticker) => { void chatInput.sendMessageWithDocument({ document: doc }) } : undefined
  void import('@components/stickers/StickerSetModal').then((m) => { m.openStickerSetModal(input, onPick) })
}
