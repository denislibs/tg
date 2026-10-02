// ВРЕМЕННО до 2C-24 — мост вместо `shareUrlToPeers` из tweb
// `src/components/popups/shareUrl.ts:40-110` (812502980). Solid-попап выбора
// получателей (`showSharingPickerPopup` над `pickUser`) портируют задачи 16 и 24
// плана 2C; до них получателя выбирает текущий React `ForwardPicker`
// (`messages/ChatDialogs.tsx`), открытый ФУНКЦИЕЙ через `popupStore` — тот же
// приём, что у `popups/birthday.bridge.tsx`. Задача 2C-24 заменяет импорт у
// вызывающих на `@components/popups/shareUrl` и удаляет этот файл:
// `git grep -n "ВРЕМЕННО до 2C-24"` → пусто.
//
// Сигнатура — оригинала в объёме, который просит потребитель (виджет ссылки
// `sidebarLeft/tabs/inviteLink.ts::shareLink` — `{url, openAfter: true}`):
// адрес уходит текстом (`sendText`) каждому выбранному, один получатель при
// `openAfter` — открыть его чат (`appImManager.setInnerPeer`). Чего мост не
// умеет (отличия закроет 2C-24):
//  1. подвал «Копировать ссылку / Отправить» мультивыбора (`createCopyLinkFooter`,
//     :40-49) и тосты `toastKey*` (:88-108) — у вызывающего их нет;
//  2. платные сообщения (`PaidMessagesInterceptor.prepareStarsForPayment`, :55-60)
//     и треды/монофорумы получателя (`threadId`, `monoforumThreadId`) — у
//     `ForwardPicker` выбор только чатами;
//  3. мультивыбор у `ForwardPicker` есть всегда (у оригинала — по `multiSelect`).
import { createElement } from 'react'
import { ForwardPicker } from '@components/messages/ChatDialogs'
import { openPopup } from '@stores/popupStore'
import { useChatsStore } from '@stores/chatsStore'
import { startClient } from '@/client/bootstrap'
import { openPeer } from '@core/navigation/openPeer'
import { peerTitle } from '@core/peerCache'

export type ShareUrlOptions = {
  url: string,
  // Single-recipient only: open the chat after sending. Ignored for multi.
  openAfter?: boolean
}

export default function shareUrlToPeers(options: ShareUrlOptions): void {
  openPopup((p) => createElement(SharePicker, { options, onClose: p.destroy }))
}

function SharePicker({ options, onClose }: { options: ShareUrlOptions, onClose: () => void }) {
  const dialogs = useChatsStore((st) => st.dialogs)
  return createElement(ForwardPicker, {
    dialogs,
    onClose,
    onPick: (peerIds: number[]) => {
      onClose()
      if(!peerIds.length) return
      const { managers } = startClient()
      const senderId = useChatsStore.getState().meId
      peerIds.forEach((peerId, idx) => {
        void managers.messages.sendText({
          peerId,
          text: options.url,
          clientMsgId: `share-${peerId}-${performance.now()}-${idx}-${Math.random().toString(36).slice(2)}`,
          optimistic: senderId != null ? { senderId } : undefined,
        })
      })

      if(peerIds.length === 1 && options.openAfter) {
        openPeer(managers, { id: peerIds[0], title: peerTitle(peerIds[0]) })
      }
    },
  })
}
