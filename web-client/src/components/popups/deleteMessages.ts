/**
 * Порт tweb `src/components/popups/deleteMessages.ts` (`showDeleteMessagesPopup`,
 * 812502980, 197 строк) — подтверждение удаления сообщений. Зовут: пункт
 * «Удалить» меню сообщения (`chat/contextMenu.ts`, tweb contextMenu.ts:2269-2287)
 * и кнопка удаления панели выделения (`chat/selection.ts`, tweb selection.ts
 * :1225-1235).
 *
 * ВРЕМЕННО до 2C-6/2C-8: попап строит наш vanilla `PopupPeer`
 * (`createPopup(PopupPeer, …)`), а не `showPeerPopup` оригинала — Solid-оболочку
 * `popups/peer.tsx` портирует задача 6 плана 2C, перевод этого файла на неё —
 * задача 8. Логика выбора заголовка, описания и чекбоксов — 1:1.
 *
 * Расхождения (у каждого — предмет):
 *  1. ветка «чужие сообщения в мегагруппе, автор не админ»
 *     (`showDeleteMegagroupMessagesPopup` — забанить / пожаловаться / удалить всё
 *     от участника, :40-55) не портирована: попапа нет, а список админов
 *     (`getParticipants({filter: admins})`) у главного потока не живёт. Такое
 *     удаление идёт обычным попапом ниже — сообщения удаляются для всех, как
 *     у оригинала в канале. Бэклог Б-94;
 *  2. `ChatType.Welcome` (:32-34, :68-69): приветственных сообщений нет вовсе;
 *     эфемерных сообщений (`isEphemeralMessage`, :38-39) в нашей модели нет.
 *     Ветка `ChatType.Scheduled` (:66-67, :108) портирована: отложенные — своё
 *     хранилище, удаляются `deleteScheduledMessages`, без «удалить у собеседника»;
 *  3. игральных костей (`messageMediaDice`, :127-130) в модели нет, поэтому в
 *     личке отозвать можно ВСЁ выбранное: ветки «только у меня» и «частично»
 *     (`canRevoke` короче `mids` — `AreYouSure…OnlyMe`/`…Mixed`,
 *     `DeleteMessagesOption`, :115-135, и раздельное удаление в колбэке,
 *     :62-65) недостижимы и не портированы;
 *  4. сообщения берутся из окна зеркала (`chat.getMessage`, tweb
 *     `appMessagesManager.getMessageByPeer`), а не запросом: вне окна удалять
 *     нечего — номера приходят только от узлов ленты;
 *  5. имя собеседника в чекбоксе и описании — строка из зеркала карточек
 *     (`peerTitle(…, {onlyFirstName: true})`), а не узел `wrapPeerTitle`;
 *  6. ветка базовой группы (`chat._ === 'chat'`, :140-160: «удалить у всех» по
 *     праву `delete_messages` или только своё) не портирована — такого
 *     конструктора бэкенд не производит (`core/messages/canDeleteMessage.ts`),
 *     любая группа у нас — мегагруппа.
 */
import PopupElement from './popupElement'
import PopupPeer, { type PopupPeerButton, type PopupPeerOptions } from './popupPeer'
import rootScope from '@lib/rootScope'
import { startClient } from '@/client/bootstrap'
import { i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import { formatFullSentTime } from '@helpers/date'
import { ChatType } from '@components/chat/chatType'
import { cachedUser, isMegagroupPeer, peerTitle } from '@core/peerCache'
import { isUser } from '@core/peers/peerId'
import type { MyMessage } from '@core/models'

export default function showDeleteMessagesPopup(
  peerId: PeerId,
  mids: number[],
  type: ChatType,
  onConfirm?: () => void,
  /** окно, откуда берутся сообщения (расхождение 4) — `chat.getMessage` */
  getMessage?: (mid: number) => MyMessage | undefined,
) {
  mids = mids.slice()

  const { managers } = startClient()

  // :26-36 — расхождения 4 и 5
  const user = isUser(peerId) ? cachedUser(peerId) : undefined
  const isBot = user?._ === 'user' && !!user.pFlags?.bot
  const peerTitleElement = peerTitle(peerId, { onlyFirstName: true })
  const messages = mids.map((mid) => getMessage?.(mid))

  // :40-55 — расхождение 1
  const isMegagroup = isMegagroupPeer(peerId)

  // :57-73; ветки Scheduled/Welcome — расхождение 2
  const callback = (checked?: Set<LangPackKey>, revoke?: boolean) => {
    onConfirm?.()
    // :66-67 — номера отложенных — ключи очереди, а не номера истории
    if(type === ChatType.Scheduled) {
      void managers.messages.deleteScheduledMessages(peerId, mids)
      return
    }

    const needRevoke = !!checked?.size || !!revoke
    // :62-65 — расхождение 3
    void managers.messages.deleteMessages(peerId, mids, needRevoke)
  }

  const buttons: PopupPeerButton[] = [{
    langKey: 'Delete',
    isDanger: true,
    callback: (checked) => callback(checked),
  }]
  const checkboxes: NonNullable<PopupPeerOptions['checkboxes']> = []
  let title: LangPackKey, titleArgs: FormatterArguments | undefined,
    description: LangPackKey, descriptionArgs: FormatterArguments | undefined
  const isSingleMessage = mids.length === 1
  if(isSingleMessage) {
    title = 'DeleteSingleMessagesTitle'
  } else {
    title = 'DeleteMessagesTitle'
    titleArgs = [i18n('messages', [mids.length])]
  }

  // :93-101; `isEphemeral` — расхождение 2
  if(isMegagroup) {
    description = isSingleMessage ? 'AreYouSureDeleteSingleMessageMega' : 'AreYouSureDeleteFewMessagesMega'
  } else if(isBot) {
    description = isSingleMessage ? 'AreYouSureDeleteSingleMessageBot' : 'AreYouSureDeleteFewMessagesBot'
  } else {
    description = isSingleMessage ? 'AreYouSureDeleteSingleMessage' : 'AreYouSureDeleteFewMessages'
  }

  if(peerId === rootScope.myId || type === ChatType.Scheduled || isBot) {
    // :105-107
  } else if(isUser(peerId)) {
    // :108-136 — расхождение 3
    checkboxes.push({
      text: 'DeleteMessagesOptionAlso',
      textArgs: [peerTitleElement],
    })
  } else {
    // :161-177 — канал и мегагруппа: всегда «для всех»; базовая группа
    // (:140-160) — расхождение 6
    let foundGiveaway: { until_date: number } | undefined
    messages.find((message) => {
      if(message?._ !== 'message') return false
      const media = message.media
      if(media?._ === 'messageMediaGiveaway' && !message.fwd_from) {
        foundGiveaway = media
        return true
      }

      return false
    })

    if(foundGiveaway && foundGiveaway.until_date >= Math.floor(Date.now() / 1000)) {
      title = 'BoostingGiveawayDeleteMsgTitle'
      description = 'BoostingGiveawayDeleteMsgText'
      descriptionArgs = [formatFullSentTime(foundGiveaway.until_date, undefined, true)]
    }

    buttons[0].callback = (checked) => callback(checked, true)
  }

  // :180 `addCancelButton(buttons)` — добавляет сам `PopupPeer`
  const popup = PopupElement.createPopup(PopupPeer, 'popup-delete-chat', { // :182-193
    peerId,
    managers,
    titleLangKey: title,
    titleLangArgs: titleArgs,
    descriptionLangKey: description,
    descriptionLangArgs: descriptionArgs,
    buttons,
    checkboxes,
  })
  popup.show()
  return popup
}
