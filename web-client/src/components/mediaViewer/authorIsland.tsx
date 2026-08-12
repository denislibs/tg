// React-остров аватарки автора вьювера (Task 13): vanilla-ядро (base.ts,
// setAuthorInfo) монтирует его через createRoot. Замена tweb avatarNew
// (base.ts:2036-2042: size 44, класс media-viewer-userpic) — наш
// shared/ui/Avatar: превью — stripped `avatar_preview` (Task 9, у аватарок
// БЕЗ блюра — avatarNew.tsx:574-590), фон/инициал — как у остальных аватарок
// приложения (peerColor). Полная фотография аватара приедет с проводкой
// message-варианта в Task 14 (пропом src нашего Avatar).
import Avatar from '@shared/ui/Avatar'
import { peerColor } from '../peerColor'

export default function ViewerAuthorAvatar({ name, avatarPreview, peerId }: {
  name: string
  avatarPreview?: string
  peerId?: string | number
}) {
  return (
    <Avatar
      className="media-viewer-userpic"
      size={44}
      background={peerColor(name)}
      text={name.charAt(0)}
      preview={avatarPreview}
      peerId={peerId}
    />
  )
}
