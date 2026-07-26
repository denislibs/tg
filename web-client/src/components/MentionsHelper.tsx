// Автокомплит @упоминаний над композером — порт tweb MentionsHelper /
// AutocompletePeerHelper (_autocompletePeerHelper.scss): вертикальный список
// участников (аватар 30 + жирное имя + серый @username), max-height 232px,
// стрелки/Enter/Tab из Composer.
import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import Avatar from '../shared/ui/Avatar'
import Text from '../shared/ui/Text'
import classNames from '../shared/lib/classNames'
import { useAvatarSrc } from './useAvatarSrc'
import { gradientFor } from '../core/dialogToChat'
import type { Peer } from '../core/managers/peersManager'
import s from './MentionsHelper.module.scss'

function Row({ peer, active, onPick }: { peer: Peer; active: boolean; onPick: (p: Peer) => void }) {
  const avatarSrc = useAvatarSrc(peer.avatarUrl)
  const name = peer.displayName || peer.username || `#${peer.id}`
  return (
    <div className={classNames(s.row, active ? s.active : '')} onClick={() => onPick(peer)}>
      <Avatar background={gradientFor(peer.id)} src={avatarSrc} text={name.charAt(0).toUpperCase()} size="xs" />
      <Text noWrap size={15} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
        {name}
      </Text>
      {peer.username && (
        <Text noWrap size={14} color="var(--tg-textSecondary)">
          @{peer.username}
        </Text>
      )}
    </div>
  )
}

export default function MentionsHelper({
  peers,
  activeIdx,
  onPick,
}: {
  peers: Peer[]
  activeIdx: number
  onPick: (p: Peer) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (activeIdx < 0) return
    const el = scrollRef.current?.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIdx])
  return (
    <motion.div
      className={s.helper}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      // не отдавать фокус из contenteditable
      onMouseDown={(e) => e.preventDefault()}
    >
      <div ref={scrollRef} className={s.scroll}>
        {peers.map((p, i) => (
          <Row key={p.id} peer={p} active={i === activeIdx} onPick={onPick} />
        ))}
      </div>
    </motion.div>
  )
}
