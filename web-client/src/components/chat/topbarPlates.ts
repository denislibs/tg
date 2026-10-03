// Порт tweb `src/components/chat/topbarPlates.ts` (812502980, 71 строка) — единственное
// место, где плашки под шапкой (кроме закрепа — у него свой цикл `setupPinnedMessageForPeer`)
// создаются, монтируются и снимаются. Пачка П-5 волны 7 (Б-21).
//
// РАСХОЖДЕНИЯ С ОРИГИНАЛОМ (плашки без предмета — строки бэклога Б-86 плана)
//  1. `requests` (заявки на вступление, `chat/requests.tsx`): у `channelFull` на проводе нет
//     `requests_pending`/`recent_requesters`, вкладки заявок `AppChatRequestsTab` нет (Б-41).
//  2. `actions` (настройки пира: «добавить в контакты», «заблокировать», «спам»,
//     `chat/actions.tsx`): `PeerSettings` бэкенд не производит (`mtpeer_schema_test.go`,
//     «нет предмета»), события `peer_settings` нет.
//  3. `automation` (бизнес-бот), `removeFee` (платные сообщения монофорума), `translation`
//     (перевод чата), `sponsored` (спонсорские) — предметов нет.
//  4. `IS_LIVE_STREAM_SUPPORTED`/`IS_GROUP_CALL_SUPPORTED` — у нас видеочат и эфир есть
//     всегда (`core/calls/*`), флагов окружения нет.
import type Chat from '@components/chat/chat'
import type ChatTopbar from '@components/chat/topbar'
import createChatLivePlate, { type ChatLivePlate } from '@components/chat/topbarLive/container.solid'
import createChatGroupCallPlate, { type ChatGroupCallPlate } from '@components/chat/topbarGroupCall/container.solid'
import type { TopbarPlateController } from '@components/chat/topbarPlate.solid'

export type TopbarPlates = {
  live: ChatLivePlate | undefined
  groupCall: ChatGroupCallPlate | undefined
  /** Ordered list of all constructed plates. Used by `topbar.setFloating`. */
  all: TopbarPlateController[]
  /** Mount every plate's container into the given host. */
  mount: (host: HTMLElement) => void
  destroy: () => void
}

export function createTopbarPlates(
  topbar: ChatTopbar,
  chat: Chat,
): TopbarPlates {
  const live = createChatLivePlate(topbar, chat)
  const groupCall = createChatGroupCallPlate(topbar, chat)

  // Order matches the visual stack inside `floatingPlatesWrapper`.
  const all = [live, groupCall].filter(Boolean)

  return {
    live,
    groupCall,
    all,
    mount: (host) => host.append(...all.map((plate) => plate.container)),
    destroy: () => all.forEach((plate) => plate.destroy()),
  }
}
