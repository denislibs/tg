// group/screens/DiscussionScreen.tsx
// Обсуждение канала (tweb chatDiscussion): привязка/отвязка группы-обсуждения.
import { useEffect, useState } from 'react'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import Text from '../../../shared/ui/Text'
import Avatar from '../../../shared/ui/Avatar'
import TgIcon from '../../TgIcon'
import ConfirmDialog from '../../settings/ConfirmDialog'
import { useT } from '../../../i18n'
import type { GroupEdit, DiscussionGroup } from '../../../core/hooks/useGroupEdit'
import type { DiscussionCandidate } from '../../../core/managers/channelsManager'
import { gradientFor } from '../../../core/dialogToChat'
import { initials } from './shared'
import s from '../GroupEditFlow.module.scss'

export function DiscussionScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
  const linkedId = g.card?.discussionChatId ?? 0
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
    <SettingsScreen title="Discussion" onBack={onBack} zIndex={70}>
      <Text size={14.5} color="var(--tg-textSecondary)" className={s.bansCaption}>
        {linkedId
          ? t('Users can now discuss your posts in the linked group.')
          : t('Select a group chat that will host comments from your channel.')}
      </Text>

      {linkedId ? (
        <>
          {linked && (
            <Section>
              <div className={s.memberRow}>
                <Avatar size="md" background={gradientFor(linked.id)} text={initials(linked.title)} />
                <div className={s.memberBody}>
                  <Text noWrap size={16} color="var(--tg-textPrimary)">{linked.title}</Text>
                  <Text noWrap size={14} color="var(--tg-textSecondary)">
                    {linked.username ? `@${linked.username}` : `${linked.memberCount} ${t('members')}`}
                  </Text>
                </div>
              </div>
            </Section>
          )}
          <Section>
            <Row icon={<TgIcon name="delete" size={22} color="#ff595a" />} label="Unlink Group" danger onClick={() => setUnlinking(true)} />
          </Section>
        </>
      ) : (
        <Section>
          <Row icon={<TgIcon name="newgroup" size={22} color="var(--tg-accent)" />} label="Create a New Group" accent onClick={() => void g.enableDiscussion()} />
          {candidates.map((c) => (
            <div key={c.id} className={s.memberRow} onClick={() => setConfirming(c)}>
              <Avatar size="md" background={gradientFor(c.id)} text={initials(c.title)} />
              <div className={s.memberBody}>
                <Text noWrap size={16} color="var(--tg-textPrimary)">{c.title}</Text>
                <Text noWrap size={14} color="var(--tg-textSecondary)">
                  {c.username ? `@${c.username}` : `${c.memberCount} ${t('members')}`}
                </Text>
              </div>
            </div>
          ))}
        </Section>
      )}

      {confirming && (
        <ConfirmDialog
          title={t('Discussion')}
          text={`${t('Do you want to set')} «${confirming.title}» ${t('as the discussion board for this channel?')}`}
          action={t('Link Group')}
          zIndex={90}
          onConfirm={() => void g.linkDiscussion(confirming.id)}
          onClose={() => setConfirming(null)}
        />
      )}
      {unlinking && (
        <ConfirmDialog
          title={t('Unlink Group')}
          text={t('Are you sure you want to unlink this group from the channel?')}
          action={t('Unlink')}
          danger
          zIndex={90}
          onConfirm={() => void g.unlinkDiscussion()}
          onClose={() => setUnlinking(false)}
        />
      )}
    </SettingsScreen>
  )
}
