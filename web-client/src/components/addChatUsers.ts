/**
 * Порт tweb `src/components/addChatUsers.ts` (812502980, `addChatUsers`
 * :135-238) — «добавить участников/подписчиков» в чат: вкладка выбора
 * `AppAddMembersTab` поверх слайдера, подтверждение попапом
 * `popup-peer popup-add-members`, приглашение и закрытие вкладки по ответу.
 * Первый потребитель — вкладка «Новый канал» (`sidebarLeft/tabs/newChannel.solid.tsx`,
 * tweb `newChannel.tsx:66-70`, `skippable: true`).
 *
 * Расхождения с оригиналом:
 *  1. (О-41) `handleMissingInvitees` (:15-133, приглашение ссылкой тех, кого нельзя
 *     добавить, и премиум-ветка) — нет: наш провод не возвращает
 *     `missingInvitees` (`POST /chats/{id}/members` отвечает `boolTrue`).
 *  2. (О-42) Приглашение — по одному запросу на пользователя
 *     (`groups.addMember(peerId, userId)`), а не одним
 *     `inviteToChannel(id, peerIds)`/`addChatUser(id, peerIds, fwdLimit)`:
 *     ручки со списком у бэкенда нет.
 *  3. (О-42) Чекбокс «показать последние 100 сообщений» (`AddMembersForwardMessages`/
 *     `AddOneMemberForwardMessages`, :169-174, :184-190) — нет: у провода нет
 *     `fwd_limit`, флажок ничего бы не менял. Касается только НЕ-каналов.
 *  4. `isBroadcast` — синхронно из зеркала (`core/peerCache.ts`),
 *     а не `await appChatsManager.*`: карточка созданного чата уже в зеркале
 *     (`channels.createChannel` → `saveApiPeers`).
 *  5. Имена в тексте — `PeerTitle` (`chat/peerTitle.ts`) с миддлварью вкладки:
 *     у нас узел имени обязан знать, когда его снять (`wrapPeerTitle` у
 *     оригинала асинхронный и без миддлвари).
 *  6. Менеджеры — с вкладки (`tab.managers`, их кладёт `slider.createTab`), а
 *     не `rootScope.managers`: глобального реестра у нас нет.
 */
import { i18n, join, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import { isBroadcastPeer } from '@core/peerCache'
import PopupElement from '@components/popups/popupElement'
import PopupPeer from '@components/popups/popupPeer'
import PeerTitle from '@components/chat/peerTitle'
import { AppAddMembersTab } from '@components/solidJsTabs/tabs'
import type SidebarSlider from '@components/slider'
import { toastNew } from '@components/toast'
import type { HttpError } from '@core/net/restClient'

export default function addChatUsers({
  peerId,
  slider,
  skippable = false,
}: {
  peerId: PeerId,
  slider: SidebarSlider,
  skippable?: boolean
}) {
  // :144-146 (расхождение 4). `isChannel` (:144) у оригинала выбирает ручку
  // (:227-229) и чекбоксы (:169, :184); у нас ручка одна, чекбоксов нет
  // (расхождения 2, 3) — признак не нужен.
  const isBroadcast = isBroadcastPeer(peerId)

  const tab = slider.createTab(AppAddMembersTab)
  const managers = tab.managers!

  // расхождение 5
  const wrapPeerTitle = (peerId: PeerId) => new PeerTitle({ peerId, middleware: tab.middlewareHelper.get(), managers }).element

  // :148-209 (без чекбоксов — расхождение 3, О-42 волна 7)
  const showConfirmation = (peerIds: PeerId[], callback: () => void) => {
    let titleLangKey: LangPackKey, titleLangArgs: FormatterArguments | undefined,
      descriptionLangKey: LangPackKey, descriptionLangArgs: FormatterArguments

    if(peerIds.length > 1) {
      const titles = peerIds.map((peerId) => {
        const b = document.createElement('b')
        b.append(wrapPeerTitle(peerId))
        return b
      })
      titleLangKey = 'AddMembersAlertTitle'
      titleLangArgs = [i18n(isBroadcast ? 'Subscribers' : 'Members', [peerIds.length])]
      descriptionLangKey = 'AddMembersAlertCountText'
      descriptionLangArgs = [
        join(titles),
      ]
    } else {
      titleLangKey = 'AddOneMemberAlertTitle'
      descriptionLangKey = 'AddMembersAlertNamesText'
      const b = document.createElement('b')
      b.append(wrapPeerTitle(peerIds[0]))
      descriptionLangArgs = [b]
    }

    descriptionLangArgs.push(wrapPeerTitle(peerId))

    PopupElement.createPopup(PopupPeer, 'popup-add-members', {
      peerId,
      managers,
      titleLangKey,
      titleLangArgs,
      descriptionLangKey,
      descriptionLangArgs,
      buttons: [{
        langKey: 'Add',
        callback,
      }],
    }).show()
  }

  // :211-220. О-43 волна 7: бэкенд отдаёт `privacy`, ветка тоста пока не срабатывает
  const onError = (err: HttpError) => {
    if(err.type === 'USER_PRIVACY_RESTRICTED') {
      toastNew({ langPackKey: 'InviteToGroupError' })
    } else {
      throw err
    }
  }

  // :222-237
  void tab.open({
    type: 'channel',
    skippable,
    takeOut: (peerIds) => {
      showConfirmation(peerIds, () => {
        // О-42 волна 7 — расхождение 2 (оба пути оригинала — одна ручка у нас)
        const promise = Promise.all(peerIds.map((userId) => managers.groups.addMember(peerId, userId)))
        promise.then(undefined, onError)
        tab.payload.attachToPromise!(promise)
      })

      return false
    },
    title: isBroadcast ? 'ChannelAddSubscribers' : 'GroupAddMembers',
    placeholder: 'SendMessageTo',
  })
}
