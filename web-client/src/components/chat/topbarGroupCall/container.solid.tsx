/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/topbarGroupCall/container.tsx` (812502980, 126 строк) —
// плашка идущего видеочата чата под шапкой: «Видеочат · N участников» и «Войти».
// Пачка П-5 волны 7 (Б-21).
//
// РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Источник «звонок идёт» — не флаги `call_active`/`call_not_empty` карточки чата и
//     `appGroupCallsManager.getGroupCallPreview` (у нас их нет: `chat` без `call_active`,
//     `channelFull` без `call`), а участники видеочата по чатам `groupCallStore.activeByChat`
//     (живут кадром `group_call_update`, `core/calls/groupCallEngine.ts::handleGroupCallFrame`)
//     со снимком `messages.groupCallParticipants(peerId)` на смене пира — тот же источник,
//     что у прежнего React-баннера `Chat.tsx`. Число участников — длина списка, превью —
//     первые три (`PREVIEW_AVATARS_COUNT`). Отличать RTMP-эфир от видеочата не нужно:
//     эфир у нас — отдельная подсистема (`livestreamStore`, плашка `topbarLive`).
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
import { useGroupCallStore } from '@stores/groupCallStore'
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

  // расхождение 1
  const participants = createMemo(() => props.peerId() ? state().activeByChat[props.peerId()] ?? [] : [])

  const shouldShow = createMemo(() => !!(
    participants().length &&
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
