/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/topbarGroupCall/container.tsx` (812502980, 126 строк) —
// плашка идущего видеочата чата под шапкой: «Видеочат · N участников» и «Войти».
// Пачка П-5 волны 7 (Б-21).
//
// РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. «Звонок идёт» — флаги `call_active && call_not_empty` карточки чата, как у tweb
//     (`:38-42`; их ставит сервер, `channel.pFlags`, f6-call). Дальше расхождение:
//     `channelFull.call` и `appGroupCallsManager.getGroupCallPreview` у нас нет (TL-модели звонка
//     нет, `group_call_*` — транспорт), поэтому число и превью участников — из
//     `groupCallStore.activeByChat` (живёт кадром `group_call_update`,
//     `core/calls/groupCallEngine.ts::handleGroupCallFrame`) со снимком
//     `messages.groupCallParticipants(peerId)` на смене пира. Число — длина списка, превью —
//     первые три (`PREVIEW_AVATARS_COUNT`). Плашка нужна обоим условиям сразу: флаги без
//     участников в сторе (снимок ещё не доехал) и участники без флагов (звонок кончился, а
//     кадр выхода ещё не обработан) её не показывают. RTMP-эфир (`rtmp_stream` звонка у tweb,
//     `:73-74`) у нас — отдельная подсистема (`livestreamStore`, плашка `topbarLive`): в чате с
//     идущим эфиром плашки видеочата нет.
//  2. «Текущий звонок» (`useCurrentGroupCall`) — `groupCallStore.peerId`.
//  3. «Войти» — `groupCallEngine.joinGroupCall(peerId)`; у tweb `appImManager.joinGroupCall`
//     (П-4 заводит его в `lib/appImManager.ts`, при влитии вызов переедет туда).
import { Show, createEffect, createMemo, createSignal, type Accessor } from 'solid-js'
import type Chat from '@components/chat/chat'
import type ChatTopbar from '@components/chat/topbar'
import { ChatType } from '@components/chat/chatType'
import { NULL_PEER_ID, isUser } from '@core/peers/peerId'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import { i18n } from '@lib/langPack'
import { cachedChat, peerMirrorVersion, subscribePeerMirror } from '@core/peerCache'
import { hasCallParticipants } from '@core/peers/predicates'
import { useGroupCallStore } from '@stores/groupCallStore'
import { useLivestreamStore } from '@stores/livestreamStore'
import { joinGroupCall } from '@core/calls/groupCallEngine'
import type { AvatarManagers } from '@components/avatar'
import TopbarPlate, { createTopbarPlate, type TopbarPlateController } from '@components/chat/topbarPlate.solid'
import { TopbarGroupCall } from './topbarGroupCall.solid'

export type ChatGroupCallPlate = TopbarPlateController & {
  setPeerId: (peerId: PeerId) => void
}

/** How many faces the avatar stack previews — the same three as every other client. */
const PREVIEW_AVATARS_COUNT = 3

function GroupCallPlateBody(props: {
  peerId: Accessor<PeerId>
  managers: AvatarManagers
  setHidden: (hidden: boolean) => void
}) {
  const state = subscribeExternal(useGroupCallStore.subscribe, useGroupCallStore.getState)
  const livestream = subscribeExternal(useLivestreamStore.subscribe, useLivestreamStore.getState)
  const mirror = subscribeExternal(subscribePeerMirror, peerMirrorVersion)

  // `call_active` + `call_not_empty` карточки чата — расхождение 1
  const isCallActive = createMemo(() => {
    mirror()
    return !!props.peerId() && hasCallParticipants(cachedChat(props.peerId()))
  })

  const participants = createMemo(() => props.peerId() ? state().activeByChat[props.peerId()] ?? [] : [])

  const shouldShow = createMemo(() => !!(
    isCallActive() &&
    participants().length &&
    !livestream().activeByChat[props.peerId()] && // расхождение 1: эфир — плашка topbarLive
    state().peerId !== props.peerId() // расхождение 2
  ))

  createEffect(() => props.setHidden(!shouldShow()))

  return (
    <Show when={shouldShow()}>
      <TopbarGroupCall
        participantsCount={participants().length}
        participantPeerIds={participants().slice(0, PREVIEW_AVATARS_COUNT)}
        managers={props.managers}
        actionButton={
          <TopbarPlate.ActionButton
            onClick={() => void joinGroupCall(props.peerId())} // расхождение 3
          >
            {i18n('VoiceChat.Topbar.Join')}
          </TopbarPlate.ActionButton>
        }
      />
    </Show>
  )
}

export default function createChatGroupCallPlate(
  topbar: ChatTopbar,
  chat: Chat,
): ChatGroupCallPlate {
  const [peerId, setPeerIdSignal] = createSignal<PeerId>(NULL_PEER_ID)

  const plate = createTopbarPlate({
    modifier: 'group-call',
    height: 48,
    onVisibilityChange: () => topbar.setFloating(),
    render: ({ setHidden }) => <GroupCallPlateBody peerId={peerId} managers={chat.managers} setHidden={setHidden} />,
  })

  return {
    ...plate,
    // Same gate as the topbar's video-chat button: real chats only, no
    // threads, no private peers. Anything else parks the plate on NULL_PEER_ID.
    setPeerId: (next) => {
      const peerId = chat.type === ChatType.Chat && !chat.threadId && !isUser(next) ? next : NULL_PEER_ID
      setPeerIdSignal(peerId)
      // расхождение 1: снимок участников на смене пира (живое — кадр `group_call_update`)
      if(peerId) {
        void chat.managers.messages.groupCallParticipants(peerId).then((userIds) => {
          useGroupCallStore.getState().setActive(peerId, userIds)
        }, () => {})
      }
    },
  }
}
