// group/screens/DiscussionScreen.tsx
// Обсуждение канала (tweb chatDiscussion): привязка/отвязка группы-обсуждения.
import { useEffect, useState } from 'react'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import Avatar from '../../../shared/ui/Avatar'
import TgIcon from '../../TgIcon'
import ConfirmDialog from '../../settings/ConfirmDialog'
import { useT, useTArgs } from '../../../i18n'
import type { GroupEdit, DiscussionGroup } from '../../../core/hooks/useGroupEdit'
import type { DiscussionCandidate } from '../../../core/managers/channelsManager'
import { gradientFor } from '../../../core/dialogToChat'
import { initials } from './shared'
import { getLinkedChatPeerId } from '../../../core/peers/peer'

export function DiscussionScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
  const tArgs = useTArgs()
  // Ключ обсуждения: `linked_chat_id` конструктора — СЫРОЙ положительный id,
  // знаковый вид делает одна функция (`getLinkedChatPeerId`).
  const linkedId = getLinkedChatPeerId(g.card?.fullChat)
  const [linked, setLinked] = useState<DiscussionGroup | null>(null)
  const [candidates, setCandidates] = useState<DiscussionCandidate[]>([])
  const [confirming, setConfirming] = useState<DiscussionCandidate | null>(null)
  const [unlinking, setUnlinking] = useState(false)

  useEffect(() => {
    let alive = true
    if (linkedId) {
      void g.loadDiscussionGroup().then((x) => { if (alive) setLinked(x) })
    } else {
      setLinked(null)
      void g.loadDiscussionCandidates().then((c) => { if (alive) setCandidates(c) })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedId])

  return (
    <SettingsScreen title="PeerInfo.Discussion" onBack={onBack} zIndex={70}>
      {/* Пояснение экрана — вендорная подпись секции
          (`sidebar-left-section-caption`), а не свой текстовый блок. */}
      <div className="sidebar-left-section-container">
        <div className="sidebar-left-section no-delimiter">
          <div className="sidebar-left-section-content sidebar-left-section-caption">
            {linkedId
              ? t('Discussion.Linked')
              : t('DiscussionChannelHelp3')}
          </div>
        </div>
      </div>

      {linkedId ? (
        <>
          {linked && (
            <Section>
              {/* Привязанная группа — вендорная строка чата (`chatlist-chat`,
                  дамп 15-right-11), а не своя карточка. */}
              <Row
                icon={<Avatar size="md" background={gradientFor(linked.peerId)} text={initials(linked.title)} />}
                label={linked.title}
                sublabel={linked.username ? `@${linked.username}` : tArgs('Members', [linked.memberCount])}
                translate={false}
              />
            </Section>
          )}
          <Section>
            <Row icon={<TgIcon name="delete" size={22} color="#ff595a" />} label="DiscussionUnlinkGroup" danger onClick={() => setUnlinking(true)} />
          </Section>
        </>
      ) : (
        <Section>
          <Row icon={<TgIcon name="newgroup" size={22} color="var(--primary-color)" />} label="DiscussionCreateGroup" accent onClick={() => void g.enableDiscussion()} />
          {candidates.map((c) => (
            <Row
              key={c.peerId}
              icon={<Avatar size="md" background={gradientFor(c.peerId)} text={initials(c.title)} />}
              label={c.title}
              sublabel={c.username ? `@${c.username}` : tArgs('Members', [c.memberCount])}
              translate={false}
              onClick={() => setConfirming(c)}
            />
          ))}
        </Section>
      )}

      {confirming && (
        <ConfirmDialog
          title="PeerInfo.Discussion"
          text="Discussion.Link.Question"
          textArgs={[confirming.title]}
          action="DiscussionLinkGroup"
          zIndex={90}
          onConfirm={() => void g.linkDiscussion(confirming.peerId)}
          onClose={() => setConfirming(null)}
        />
      )}
      {unlinking && (
        <ConfirmDialog
          title="DiscussionUnlinkGroup"
          text="Discussion.Unlink.Text"
          action="DiscussionUnlink"
          danger
          zIndex={90}
          onConfirm={() => void g.unlinkDiscussion()}
          onClose={() => setUnlinking(false)}
        />
      )}
    </SettingsScreen>
  )
}
