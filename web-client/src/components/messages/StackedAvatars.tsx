// StackedAvatars — стек аватаров реагировавших внутри чипа реакции (tweb
// StackedAvatars, _reaction.scss:157-163). Аватары наложены друг на друга
// (свежие сверху/справа), с рамкой цвета подложки чипа. Показывается вместо
// числа при count<4 (см. ReactionChip).
import type { CSSProperties } from 'react'
import UserAvatar from '../UserAvatar'
import s from './StackedAvatars.module.scss'

export interface StackedAvatarPeer {
  id: number
  name: string
  avatarUrl?: string
}

export default function StackedAvatars({
  peers,
  size = 24,
}: {
  peers: StackedAvatarPeer[]
  /** размер одного аватара, px (tweb block --reaction avatarSize:24) */
  size?: number
}) {
  if (!peers.length) return null
  return (
    <div className={s.stack} style={{ '--sa-size': `${size}px` } as CSSProperties} data-testid="stacked-avatars">
      {peers.map((p, i) => (
        // z-index убывает вправо, чтобы левый аватар «перекрывал» — как в tweb.
        <div key={p.id} className={s.item} style={{ zIndex: peers.length - i }}>
          <UserAvatar id={p.id} name={p.name} avatarUrl={p.avatarUrl} size={size} />
        </div>
      ))}
    </div>
  )
}
