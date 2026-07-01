import { useState } from 'react'
import type { ReactNode } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import Input from '../shared/ui/Input'
import { motion } from 'framer-motion'
import { slideInRight } from '../motion'
import TgIcon from './TgIcon'
import { Section, Row } from './settings/kit'
import type { Chat } from '../data'
import { useT } from '../i18n'
import s from './EditView.module.scss'

export default function EditView({ chat, onBack }: { chat: Chat; onBack: () => void }) {
  const t = useT()
  const isChannel = chat.type === 'channel'
  const [name, setName] = useState(chat.name)
  const [desc, setDesc] = useState(chat.description ?? '')

  const rows: { icon: ReactNode; label: string; value: string }[] = [
    { icon: <TgIcon name="lock" size={24} />, label: t(isChannel ? 'Channel Type' : 'Group Type'), value: t('Private') },
    { icon: <TgIcon name="link" size={24} />, label: t('Invite Links'), value: '1' },
    { icon: <TgIcon name="reactions" size={24} />, label: t('Reactions'), value: t('All') },
    { icon: <TgIcon name="message" size={24} />, label: t('Direct Messages'), value: t('Off') },
    { icon: <TgIcon name="comments" size={24} />, label: t('Discussion'), value: t('Add') },
    { icon: <TgIcon name="list" size={24} />, label: t('Recent Actions'), value: '' },
  ]
  const bottom: { icon: React.ReactNode; label: string; value: string }[] = [
    { icon: <TgIcon name="admin" size={24} />, label: t('Administrators'), value: '1' },
    { icon: <TgIcon name="group" size={24} />, label: t(isChannel ? 'Subscribers' : 'Members'), value: '1' },
  ]

  return (
    <motion.div
      className={s.screen}
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* Header */}
      <div className={s.header}>
        <IconButton onClick={onBack} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)">{t('Edit')}</Text>
      </div>

      <div className={s.body}>
        {/* Avatar + name/desc */}
        <div className={s.card}>
          <div className={s.avatarRow}>
            <motion.div
              className={s.avatar}
              whileTap={{ scale: 0.96 }}
              style={{ background: chat.avatar }}
            >
              <TgIcon name="cameraadd" size={36} />
            </motion.div>
          </div>
          <Input
            wrapClassName={s.field}
            label={t(isChannel ? 'Channel name' : 'Group name')}
            value={name}
            onChange={setName}
          />
          <Input
            wrapClassName={s.field}
            label={t('Description')}
            value={desc}
            onChange={setDesc}
          />
        </div>
        <Text size={14} color="var(--tg-textSecondary)" className={s.hint}>
          {t('You can provide an optional description for your')} {t(isChannel ? 'channel' : 'group')}.
        </Text>

        {/* Settings list */}
        <Section>
          {rows.map((r) => (
            <Row key={r.label} icon={r.icon} label={r.label} translate={false} sublabel={r.value || undefined} onClick={() => {}} />
          ))}
        </Section>

        <Text size={14} color="var(--tg-textSecondary)" className={s.hint}>
          {t('Add a group chat for comments')}
        </Text>

        <Section>
          {bottom.map((r) => (
            <Row key={r.label} icon={r.icon} label={r.label} translate={false} sublabel={r.value || undefined} onClick={() => {}} />
          ))}
        </Section>
      </div>
    </motion.div>
  )
}
