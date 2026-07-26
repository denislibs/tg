import { useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import Input from '../shared/ui/Input'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { useT } from '../i18n'
import s from './NewChannelFlow.module.scss'

interface Props {
  onClose: () => void
  onCreate: (name: string, description: string) => void
}

export default function NewChannelFlow({ onClose, onCreate }: Props) {
  const t = useT()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const canNext = name.trim().length > 0

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 41,
        background: 'var(--tg-sidebarBg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div className={s.header}>
        <IconButton onClick={onClose} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)">
          {t('New Channel')}
        </Text>
      </div>

      <div className={s.body}>
        <div className={s.card}>
          <div className={s.avatarWrap}>
            <motion.div className={s.avatarBtn} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
              <TgIcon name="cameraadd" size={44} />
            </motion.div>
          </div>
          <Input
            autoFocus
            label={t('Channel name')}
            value={name}
            onChange={setName}
            wrapClassName={`${s.field} ${s.fieldGap}`}
          />
          <Input
            label={t('Description (optional)')}
            value={desc}
            onChange={setDesc}
            wrapClassName={s.field}
          />
        </div>
        <Text size={14.5} color="var(--tg-textSecondary)" className={s.hint}>
          {t('You can provide an optional description for your channel.')}
        </Text>
      </div>

      <motion.div
        onClick={() => canNext && onCreate(name.trim(), desc.trim())}
        whileHover={{ scale: canNext ? 1.06 : 1 }}
        whileTap={{ scale: canNext ? 0.92 : 1 }}
        className={s.fab}
        style={{ cursor: canNext ? 'pointer' : 'default', opacity: canNext ? 1 : 0.45 }}
      >
        <TgIcon name="arrow_next" />
      </motion.div>
    </motion.div>
  )
}
