/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/topbarLive/container.tsx` (812502980, 122 строки) —
// плашка идущей RTMP-трансляции канала под шапкой. Пачка П-5 волны 7 (Б-21).
//
// РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Источник «эфир идёт» — не флаги `call_active`/`call_not_empty` канала и
//     `getGroupCallFull(...).pFlags.rtmp_stream` (у нас их нет: трансляции — своя
//     подсистема REST `/chats/{id}/livestream`), а `livestreamStore.activeByChat`
//     (живёт кадром `livestream_update`, `core/calls/livestreamEngine.ts`) со снимком
//     `livestream.status(peerId)` на смене пира — тот же источник, что у прежнего
//     React-баннера `Chat.tsx`. Число зрителей — `viewers` того же снимка (у tweb —
//     `participants_count` звонка и `group_call_update`); живого счётчика зрителей на
//     плашке у нас нет, кадр трансляции несёт `viewers` только в ответе статуса.
//  2. «Текущий эфир» (`useCurrentRtmpCall`) — `livestreamStore.watchingPeerId`.
//  3. «Смотреть» — `livestreamEngine.watchLivestream(peerId)`; у tweb
//     `appImManager.joinLiveStream` (П-4 заводит его, при влитии вызов переедет туда).
import { Show, createEffect, createMemo, createSignal, type Accessor } from 'solid-js'
import type Chat from '@components/chat/chat'
import type ChatTopbar from '@components/chat/topbar'
import { NULL_PEER_ID } from '@core/peers/peerId'
import { isBroadcastPeer } from '@core/peerCache'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import { i18n } from '@lib/langPack'
import { useLivestreamStore } from '@stores/livestreamStore'
import { watchLivestream } from '@core/calls/livestreamEngine'
import TopbarPlate, { createTopbarPlate, type TopbarPlateController } from '@components/chat/topbarPlate.solid'
import { TopbarLive } from './topbarLive.solid'

export type ChatLivePlate = TopbarPlateController & {
  setPeerId: (peerId: PeerId) => void
}

function LivePlateBody(props: {
  peerId: Accessor<PeerId>
  watching: Accessor<number | undefined>
  setHidden: (hidden: boolean) => void
}) {
  const state = subscribeExternal(useLivestreamStore.subscribe, useLivestreamStore.getState)
  // расхождение 1
  const isCallActive = createMemo(() => !!(props.peerId() && isBroadcastPeer(props.peerId()) && state().activeByChat[props.peerId()]))
  const shouldShow = createMemo(() => isCallActive() && state().watchingPeerId !== props.peerId())

  createEffect(() => props.setHidden(!shouldShow()))

  return (
    <Show when={shouldShow()}>
      <TopbarLive
        watching={props.watching()}
        actionButton={
          <TopbarPlate.ActionButton
            onClick={() => watchLivestream(props.peerId())} // расхождение 3
          >
            {i18n('Rtmp.Topbar.Join')}
          </TopbarPlate.ActionButton>
        }
      />
    </Show>
  )
}

export default function createChatLivePlate(
  topbar: ChatTopbar,
  chat: Chat,
): ChatLivePlate {
  const [peerId, setPeerIdSignal] = createSignal<PeerId>(NULL_PEER_ID)
  const [watching, setWatching] = createSignal<number>()

  const plate = createTopbarPlate({
    modifier: 'live',
    height: 48,
    onVisibilityChange: () => topbar.setFloating(),
    render: ({ setHidden }) => <LivePlateBody peerId={peerId} watching={watching} setHidden={setHidden} />,
  })

  return {
    ...plate,
    setPeerId: (next) => {
      if(next !== peerId()) setWatching()
      setPeerIdSignal(next)
      // расхождение 1: снимок статуса на смене пира
      if(next && isBroadcastPeer(next)) {
        void chat.managers.livestream.status(next).then((status) => {
          useLivestreamStore.getState().setActive(next, status.active)
          if(peerId() === next) setWatching(status.viewers)
        }, () => {})
      }
    },
  }
}
