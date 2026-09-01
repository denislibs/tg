// group/screens/shared.tsx
// Общие для экранов редактирования группы/канала примитивы: список эмодзи-реакций,
// инициал для аватара-плейсхолдера и универсальный пикер участника
// (добавить админа/участника/в чёрный список — tweb).
import type { LangPackKey } from '@/lang'
import { useMemo, type ReactNode } from 'react'
import { SettingsScreen } from '../../settings/kit'
import PeerSelector, { type SelectorPeer } from '../../../shared/ui/PeerSelector'
import type { EditMember } from '../../../core/hooks/useGroupEdit'

export const EMOJIS = ['👍', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🎉', '😱', '👎', '💯', '🙏']

export const initials = (name: string): string => name.trim().charAt(0).toUpperCase() || '?'

/** Строка участника → пир селектора (`shared/ui/PeerSelector`). */
export function memberToPeer(m: { userId: number; name: string; photoId?: number }, extra?: {
  subtitle?: ReactNode
  disabled?: boolean
  actions?: ReactNode
}): SelectorPeer {
  return { id: m.userId, name: m.name, photoId: m.photoId, ...extra }
}

// ── общий пикер участника (для «добавить админа/участника/в чёрный список») ──
// tweb: `showPickUserPopup({peerType: ['channelParticipants']})` — тот же
// `AppSelectPeers` в варианте single-select (`selector-round selector-right`).
export function MemberPicker({
  title, members, onBack, onPick,
}: {
  title: LangPackKey
  members: EditMember[]
  onBack: () => void
  onPick: (m: EditMember) => void
}) {
  const peers = useMemo(() => members.map((m) => memberToPeer(m)), [members])
  return (
    <SettingsScreen title={title} onBack={onBack} zIndex={80}>
      <PeerSelector
        peers={peers}
        onPick={(p) => {
          const m = members.find((x) => x.userId === p.id)
          if (m) onPick(m)
        }}
        empty={{ title: 'SearchEmptyViewTitle' }}
      />
    </SettingsScreen>
  )
}
