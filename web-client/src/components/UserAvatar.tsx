// UserAvatar — аватар пользователя по сырым данным пира: id медиа фото
// (`photo.photo_id`) резолвится воркерным конвейером (useMediaUrl →
// downloadMediaURL), фолбэк — градиент по id (или цвет по имени) с инициалом.
//
// Прежний проп `avatarUrl` был строкой `/media/N/content`, из которой тот же
// номер выпарсивался обратно регуляркой (хук `useAvatarSrc`, удалён). После
// перевода пиров на модель схемы номер приезжает готовым — ровно тем, чего
// ждёт `downloadMediaURL`, и промежуточной строки больше нет.
import Avatar from '../shared/ui/Avatar'
import type { AvatarSize } from '../shared/ui/Avatar'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import { gradientFor } from '../core/dialogToChat'
import { peerColor } from './peerColor'

export default function UserAvatar({
  id,
  name,
  photoId,
  size = 'md',
  online,
  className,
  background,
  emoji,
}: {
  id?: number
  name: string
  /** id медиа аватарки (`photo.photo_id`); 0/undefined — фото нет */
  photoId?: number
  size?: AvatarSize | number
  online?: boolean
  /** классы-модификаторы слота tweb (`dialog-avatar row-media`, `selector-user-avatar`) */
  className?: string
  /** фон вместо градиента по id — у «Избранного» свой (`SAVED_GRADIENT`) */
  background?: string
  /** глиф вместо инициала (`Avatar.emoji`: `saved` — иконка закладки «Избранного») */
  emoji?: string
}) {
  const src = useMediaUrl(photoId || null)
  return (
    <Avatar
      size={size}
      background={background ?? (id != null ? gradientFor(id) : peerColor(name))}
      src={src || undefined}
      text={name.charAt(0).toUpperCase() || '?'}
      emoji={emoji}
      online={online}
      className={className}
    />
  )
}
