import { useState } from 'react'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import Input from '../shared/ui/Input'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { useT } from '../i18n'
import s from './NewGroupFlow.module.scss'

interface Props {
  onClose: () => void
  onCreate: (name: string) => void
}

export default function NewGroupFlow({ onClose, onCreate }: Props) {
  const t = useT()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')

  const next = () => {
    if (step === 0) {
      if (name.trim()) setStep(1)
    } else {
      onCreate(name.trim())
    }
  }
  const back = () => (step === 0 ? onClose() : setStep(0))
  const canNext = step === 0 ? name.trim().length > 0 : true

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
      {/* Header */}
      <div className={s.header}>
        <IconButton onClick={back} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)">
          {step === 0 ? t('New Group') : t('Add Members')}
        </Text>
      </div>

      <div className={s.stepArea}>
        <AnimatePresence mode="wait" initial={false}>
          {step === 0 ? (
            <motion.div
              key="step0"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.13, ease: [0.3, 0, 0.2, 1] }}
            >
              <div className={s.card}>
                <div className={s.avatarWrap}>
                  <motion.div className={s.avatarBtn} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                    <TgIcon name="cameraadd" size={44} />
                  </motion.div>
                </div>
                <Input
                  autoFocus
                  label={t('Group Name')}
                  value={name}
                  onChange={setName}
                  onKeyDown={(e) => e.key === 'Enter' && next()}
                  wrapClassName={s.field}
                />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.13, ease: [0.3, 0, 0.2, 1] }}
              className={s.step1}
            >
              <div className={s.searchBar}>
                <TgIcon name="search" size={22} color="var(--tg-textFaint)" />
                <input
                  autoFocus
                  className={s.searchInput}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Search')}
                />
              </div>

              <div className={s.empty}>
                <div className={s.emoji}>🐤</div>
                <Text size={19} weight={600} color="var(--tg-textPrimary)">{t('No Results')}</Text>
                <Text size={15} color="var(--tg-textSecondary)">{t('Try searching.')}</Text>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Next FAB */}
      <motion.div
        onClick={next}
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
