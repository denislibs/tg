/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/topbarGroupCall/topbarGroupCall.tsx` (812502980, 47 строк) —
// содержимое плашки идущего видеочата. Стили — `styles/tweb/_topbarGroupCall.scss`.
//
// РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. `StackedAvatarsTsx` (Solid-обёртка `StackedAvatars`) у нас не заведён — класс
//     `components/stackedAvatars.ts` берётся здесь тем же способом: свой `middleware`,
//     `render` на каждое изменение списка. Нашему классу нужны `managers` (пробел карточки).
//  2. У нашего видеочата нет названия (`groupCall.title`) — заголовок всегда
//     `PeerInfo.Action.VoiceChat`, ветка оригинала без названия.
import { createEffect, on, onCleanup, type JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'
import Button from '@components/buttonTsx.solid'
import StackedAvatars from '@components/stackedAvatars'
import type { AvatarManagers } from '@components/avatar'
import { i18n } from '@lib/langPack'
import { getMiddleware } from '@helpers/middleware'
import { cnTopbarGroupCall } from './topbarGroupCall.cn'

const AVATAR_SIZE = 36

/** расхождение 1 — tweb `stackedAvatars.ts` `StackedAvatarsTsx` (:82-101). */
function StackedAvatarsTsx(props: { peerIds: PeerId[], avatarSize: number, managers: AvatarManagers }) {
  const middleware = getMiddleware()
  const stackedAvatars = new StackedAvatars({
    avatarSize: props.avatarSize,
    middleware: middleware.get(),
    managers: props.managers,
  })

  onCleanup(() => middleware.destroy())

  createEffect(on(() => props.peerIds, (peerIds) => {
    void stackedAvatars.render(peerIds)
  }))

  return stackedAvatars.container
}

/**
 * Layout follows the group-call bar of the other clients: icon + title on one
 * side, the join button on the other, and a preview of who is already in the
 * call sitting on the plate's horizontal centre.
 */
export const TopbarGroupCall = (props: {
  participantsCount: number
  participantPeerIds: PeerId[]
  managers: AvatarManagers
  actionButton: JSX.Element
}) => {
  return (
    <>
      <div class={cnTopbarGroupCall('-side')}>
        <Button.Icon icon="videochat" class="primary disable-hover" />
        <div class={cnTopbarGroupCall('-content')}>
          <div class={classNames(cnTopbarGroupCall('-title'), 'primary', 'text-bold', 'text-overflow-no-wrap')}>
            {i18n('PeerInfo.Action.VoiceChat')}
          </div>
          <div class={classNames(cnTopbarGroupCall('-subtitle'), 'secondary', 'text-overflow-no-wrap')}>
            {i18n('VoiceChat.Status.Members', [props.participantsCount])}
          </div>
        </div>
      </div>
      <StackedAvatarsTsx peerIds={props.participantPeerIds} avatarSize={AVATAR_SIZE} managers={props.managers} />
      <div class={classNames(cnTopbarGroupCall('-side'), 'is-end')}>
        {props.actionButton}
      </div>
    </>
  )
}
