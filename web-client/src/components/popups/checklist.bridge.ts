// ВРЕМЕННО до порта popups/checklist — мост вместо `showChecklistPopup` из tweb
// `src/components/popups/checklist.tsx:32-230` (812502980). До порта
// Solid-попапа чек-лист собирает текущий React `CreateChecklistPopup.tsx`,
// открытый ФУНКЦИЕЙ через `popupStore` (остров оверлеев) — тот же приём, что у
// `popups/datePicker.bridge.ts`. Порт заменяет импорт у вызывающего (пункт
// «Чек-лист» меню вложений, `ChatInput.attachMenuButtons`, tweb `input.ts:1273-1300`)
// и удаляет этот файл: `git grep -n "ВРЕМЕННО до порта popups/checklist"` → пусто.
//
// Сигнатура — оригинала в объёме создания (`{chat}`): правки и дописывания
// пунктов (`editMessage`, `appending`, `focusItemId`) React-попап не умеет.
// Отправку, как у tweb (:199-218), делает сам попап. Расхождение: пакет
// параметров (`chat.getMessageSendingParams()` — ответ, тред) не уезжает —
// у `messages.sendChecklist` его нет (ручка `/chats/{id}/checklists`); плашку
// ответа поэтому не гасим.
import { createElement } from 'react'
import CreateChecklistPopup, { type NewChecklistData } from '@components/CreateChecklistPopup'
import { openPopup } from '@stores/popupStore'
import type { Managers } from '@/client/bootstrap'

export default function showChecklistPopup(options: {
  chat: { peerId: PeerId, managers: Managers },
}) {
  const { chat } = options
  openPopup((p) => createElement(CreateChecklistPopup, {
    onClose: p.destroy,
    onCreate: (c: NewChecklistData) => {
      p.destroy()
      void chat.managers.messages.sendChecklist(chat.peerId, { ...c, clientMsgId: crypto.randomUUID() })
    },
  }))
}
