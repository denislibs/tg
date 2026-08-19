// StackedAvatars — стек аватаров реагировавших внутри чипа реакции (tweb
// StackedAvatars, _reaction.scss:157-163). Аватары наложены друг на друга
// (свежие сверху/справа), с рамкой цвета подложки чипа. Показывается вместо
// числа при count<4 (см. ReactionChip).
//
// Принимает КЛЮЧИ ПИРОВ, а не мини-карточки — порт `StackedAvatars.render
// (peerIds: PeerId[])` (`components/stackedAvatars.ts:36`), которому вызывающий
// отдаёт ровно `recentReactions.map((r) => getPeerId(r.peer_id))`
// (`chat/reaction.ts:1083`). Имя и фото берутся из зеркала пиров: на проводе их
// больше нет (`display_name` убран, аватарка — `photo.photo_id`).
import type { CSSProperties } from 'react'
import Avatar from '../../shared/ui/Avatar'
import classNames from '../../shared/lib/classNames'
import { usePeers } from '../../core/hooks/usePeers'
import { useMediaUrl } from '../../core/hooks/useMediaUrl'
import { peerTitle } from '../../core/peerCache'
import { getPeerPhotoId } from '../../core/peers/peer'
import type { Chat, User } from '../../core/peers/peer'
import { gradientFor } from '../../core/dialogToChat'
import s from './StackedAvatars.module.scss'

/** Аватарка пира: фото — по `photo.photo_id` через воркерный конвейер медиа
 *  (никаких строк `/media/N/content`), фолбэк — градиент по ключу с инициалом. */
function PeerAvatar({ peerId, peer, size }: { peerId: PeerId; peer: User | Chat | undefined; size: number }) {
  const photo = peer && (peer._ === 'user' || peer._ === 'channel' || peer._ === 'chat') ? peer.photo : undefined
  const src = useMediaUrl(getPeerPhotoId(photo) || null)
  const name = peerTitle(peerId)
  return (
    <Avatar
      size={size}
      background={gradientFor(peerId)}
      src={src || undefined}
      text={name.charAt(0).toUpperCase() || '?'}
    />
  )
}

export default function StackedAvatars({
  peerIds,
  size = 24,
}: {
  peerIds: PeerId[]
  /** размер одного аватара, px (tweb block --reaction avatarSize:24) */
  size?: number
}) {
  // Объявляем зеркалу пробел за всеми ключами разом: без этого имя и фото
  // реагировавшего, за которым никто отдельно не ходил, остались бы пустыми.
  const peers = usePeers(peerIds)
  if (!peerIds.length) return null
  return (
    <div
      className={classNames('stacked-avatars', s.stack)}
      style={{ '--avatar-size': `${size}px` } as CSSProperties}
      data-testid="stacked-avatars"
    >
      {peerIds.map((peerId, i) => (
        <div
          key={peerId}
          className={classNames(
            'stacked-avatars-avatar-container',
            i === 0 ? 'is-first' : '',
            i === peerIds.length - 1 ? 'is-last' : '',
            s.item,
          )}
        >
          <PeerAvatar peerId={peerId} peer={peers.get(peerId)} size={size} />
        </div>
      ))}
    </div>
  )
}
