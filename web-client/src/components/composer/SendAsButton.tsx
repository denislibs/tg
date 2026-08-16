// composer/SendAsButton.tsx
// «Отправить от имени» — узлы tweb (_chat.scss:926-975, input.ts:2628-2644):
//
//   div.new-message-send-as-container      ← абсолютный, transform: scale(0)
//     div.new-message-send-as-avatar[.is-visible.forwards]
//
// Сам сдвиг инпута под аватар делает `.new-message-wrapper.has-offset[data-offset="as"]`
// — его ставит Composer. Появление аватара — пара классов `is-visible` + `forwards`
// от SetTransition (singleTransition.ts), а не своя анимация.
import { useState } from 'react'
import Text from '../../shared/ui/Text'
import Avatar from '../../shared/ui/Avatar'
import Menu from '../../shared/ui/Menu'
import { useT } from '../../i18n'
import { useAvatarSrc } from '../useAvatarSrc'
import { peerColor } from '../peerColor'
import { useSetTransition } from '../../core/hooks/useSetTransition'
import classNames from '../../shared/lib/classNames'
import type { SendAsPeer } from '../../core/managers/chatsManager'
import s from './extras.module.scss'

// _chat.scss:853 — `--send-as-size: 2.5rem`.
const AVATAR_SIZE = 40

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
  // input.ts:2639-2644 — появление идёт через SetTransition, duration 300.
  const visible = useSetTransition(true, 'is-visible', 300)
  return (
    <>
      <div
        className="new-message-send-as-container"
        title={t('Send As…')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setPos({ left: r.left, bottom: window.innerHeight - r.top + 8 })
          setOpen(true)
        }}
      >
        <Avatar
          className={classNames('new-message-send-as-avatar', visible)}
          background={peerColor(current.title)}
          text={current.title[0] ?? '#'}
          src={curSrc || undefined}
          size={AVATAR_SIZE}
        />
      </div>
      {pos && (
        <Menu
          open={open}
          onClose={() => setOpen(false)}
          onExitComplete={() => setPos(null)}
          corner="top-right"
          style={{ left: pos.left, bottom: pos.bottom, minWidth: 220 }}
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
        <Text size={12} color="var(--secondary-text-color)">{subtitle}</Text>
      </div>
    </button>
  )
}
