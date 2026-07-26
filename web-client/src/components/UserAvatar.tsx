// UserAvatar — аватар пользователя по сырым данным пира: токенизирует
// "/media/N/content" через useAvatarSrc (иначе <img> получает 401 и фото
// «не работает»), фолбэк — градиент по id (или цвет по имени) с инициалом.
import Avatar from '../shared/ui/Avatar'
import type { AvatarSize } from '../shared/ui/Avatar'
import { useAvatarSrc } from './useAvatarSrc'
import { gradientFor } from '../core/dialogToChat'
import { peerColor } from './peerColor'

export default function UserAvatar({
  id,
  name,
  avatarUrl,
  size = 'md',
  online,
}: {
  id?: number
  name: string
  avatarUrl?: string
  size?: AvatarSize | number
  online?: boolean
}) {
  const src = useAvatarSrc(avatarUrl)
  return (
    <Avatar
      size={size}
      background={id != null ? gradientFor(id) : peerColor(name)}
      src={src || undefined}
      text={name.charAt(0).toUpperCase() || '?'}
      online={online}
    />
  )
}
