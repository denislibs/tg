// composer/SendAsButton.tsx
// Аватар текущей «личности отправителя» + попап выбора (tweb new-message-send-as).
// Показывается только когда доступных личностей больше одной.
import { useState } from 'react'
import Text from '../../shared/ui/Text'
import Avatar from '../../shared/ui/Avatar'
import Menu from '../../shared/ui/Menu'
import { useT } from '../../i18n'
import { useAvatarSrc } from '../useAvatarSrc'
import { peerColor } from '../peerColor'
import type { SendAsPeer } from '../../core/managers/chatsManager'
import s from '../Composer.module.scss'

export interface SendAsProps {
  peers: SendAsPeer[]
  currentId: number
  onSelect: (peerId: number) => void
}

export default function SendAsButton({ peers, currentId, onSelect }: SendAsProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const current = peers.find((p) => p.peerId === currentId) ?? peers[0]
  const curSrc = useAvatarSrc(current.avatarUrl)
  return (
    <>
      <button
        type="button"
        className={s.sendAsBtn}
        title={t('Send As…')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setPos({ left: r.left, bottom: window.innerHeight - r.top + 8 })
          setOpen(true)
        }}
      >
        <Avatar background={peerColor(current.title)} text={current.title[0] ?? '#'} src={curSrc || undefined} size={30} />
      </button>
      {pos && (
        <Menu
          open={open}
          onClose={() => setOpen(false)}
          onExitComplete={() => setPos(null)}
          style={{ left: pos.left, bottom: pos.bottom, transformOrigin: 'bottom left', minWidth: 220 }}
        >
          <div className={s.sendAsHeader}>{t('Send As…')}</div>
          {peers.map((p) => (
            <SendAsRow
              key={p.peerId}
              peer={p}
              active={p.peerId === currentId}
              subtitle={p.kind === 'user' ? t('Personal account') : p.kind === 'group' ? t('Anonymously') : t('Your channels')}
              onClick={() => { onSelect(p.peerId); setOpen(false) }}
            />
          ))}
        </Menu>
      )}
    </>
  )
}

function SendAsRow({ peer, active, subtitle, onClick }: { peer: SendAsPeer; active: boolean; subtitle: string; onClick: () => void }) {
  const src = useAvatarSrc(peer.avatarUrl)
  return (
    <button type="button" className={s.sendAsRow} data-active={active || undefined} onClick={onClick}>
      <Avatar background={peerColor(peer.title)} text={peer.title[0] ?? '#'} src={src || undefined} size={32} />
      <div className={s.sendAsRowText}>
        <Text size={14} weight={600}>{peer.title}</Text>
        <Text size={12} color="var(--tg-textSecondary)">{subtitle}</Text>
      </div>
    </button>
  )
}
