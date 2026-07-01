import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import type { ReactNode } from 'react'
import classNames from '../shared/lib/classNames'
import { useT } from '../i18n'
import s from './PremiumModal.module.scss'

// tweb's premium feature colour ramp (orange -> green), sampled across the list.
const FEATURES: { icon: ReactNode; title: string; subtitle: string; color: string }[] = [
  { icon: <TgIcon name="stories" size={24} />, title: 'Stories', subtitle: 'Posting without limits, priority order, stealth mode, saved view history and more.', color: '#ef6922' },
  { icon: <TgIcon name="document" size={24} />, title: 'Unlimited Cloud Storage', subtitle: 'Upload files of any size, with unlimited cloud storage.', color: '#e74e33' },
  { icon: <TgIcon name="statistics" size={24} />, title: 'Doubled Limits', subtitle: 'Up to 1000 channels, 20 folders, 10 pinned chats and 20 public links.', color: '#db374b' },
  { icon: <TgIcon name="microphone" size={24} />, title: 'Voice-to-Text', subtitle: 'Convert voice messages into text.', color: '#bc4395' },
  { icon: <TgIcon name="premium_speed" size={24} />, title: 'Faster Downloads', subtitle: 'Download media and files at the maximum speed.', color: '#9b4fed' },
  { icon: <TgIcon name="restrict" size={24} />, title: 'No Ads', subtitle: 'Get rid of ads in public channels.', color: '#676bff' },
  { icon: <TgIcon name="reactions_filled" size={24} />, title: 'Unique Reactions', subtitle: 'React with a vastly expanded set of emoji.', color: '#4492ff' },
  { icon: <TgIcon name="smile" size={24} />, title: 'Premium Stickers', subtitle: 'Unlock exclusive animated stickers.', color: '#41a6a5' },
  { icon: <TgIcon name="message" size={24} />, title: 'Chat Management', subtitle: 'Change default chat folder, archive and mute new chats.', color: '#3dbd4a' },
]

const PLANS = [
  { id: '24m', label: '24 Months', discount: '-58%', perMonth: '124,58', total: '2 990,00' },
  { id: '12m', label: 'Annual', discount: '-45%', perMonth: '165,83', total: '1 990,00' },
  { id: '1m', label: 'Monthly', discount: null, perMonth: '299,00', total: '299,00' },
] as const

// Telegram-style gradient premium star.
function PremiumStar() {
  return (
    <div className={s.star}>
      <svg viewBox="0 0 100 100" width="96" height="96">
        <defs>
          <linearGradient id="prem-star" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9aa0ff" />
            <stop offset="55%" stopColor="#8d6bff" />
            <stop offset="100%" stopColor="#a45ee6" />
          </linearGradient>
        </defs>
        <path
          fill="url(#prem-star)"
          d="M50 8c2 0 3.8 1.2 4.7 3l9.5 19.2 21.2 3.1c4.4.6 6.2 6 3 9.1L73 54.5l3.6 21.1c.8 4.4-3.8 7.7-7.7 5.6L50 71.3 31.1 81.2c-3.9 2.1-8.5-1.2-7.7-5.6L27 54.5 11.6 42.4c-3.2-3.1-1.4-8.5 3-9.1l21.2-3.1L45.3 11C46.2 9.2 48 8 50 8z"
        />
        {/* sparkles */}
        <circle cx="78" cy="20" r="2.6" fill="#b9a8ff" />
        <circle cx="24" cy="30" r="1.8" fill="#b9a8ff" />
        <circle cx="84" cy="44" r="1.6" fill="#b9a8ff" />
      </svg>
    </div>
  )
}

export default function PremiumModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const [plan, setPlan] = useState<string>('24m')
  const selected = PLANS.find((p) => p.id === plan) ?? PLANS[0]

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={s.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className={s.dialog}
            initial={{ scale: 0.92, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {/* scrollable content */}
            <div className={s.content}>
              {/* header */}
              <div className={s.header}>
                <div className={s.close} onClick={onClose}>
                  <TgIcon name="close" />
                </div>
                <PremiumStar />
                <Text size={26} weight={700} color="var(--tg-textPrimary)" className={s.title}>
                  Telegram Premium
                </Text>
                <Text size={15.5} color="var(--tg-textSecondary)" className={s.subtitle}>
                  {t('More freedom and dozens of exclusive features with a Telegram Premium subscription.')}
                </Text>
              </div>

              {/* plans */}
              <div className={s.plans}>
                {PLANS.map((p) => {
                  const active = p.id === plan
                  return (
                    <div
                      key={p.id}
                      onClick={() => setPlan(p.id)}
                      className={classNames(s.plan, active ? s.planSelected : '')}
                    >
                      {/* radio — empty ring with the filled check scaling in (tweb-style) */}
                      <div className={classNames(s.radio, active ? s.radioOn : '')}>
                        <motion.div
                          className={s.radioFill}
                          initial={false}
                          animate={{ scale: active ? 1 : 0, opacity: active ? 1 : 0 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        >
                          <TgIcon name="check" size={17} color="#fff" />
                        </motion.div>
                      </div>
                      <div className={s.planBody}>
                        <Text size={17} weight={500} color="var(--tg-textPrimary)">
                          {t(p.label)}
                        </Text>
                        <div className={s.planMeta}>
                          {p.discount && <span className={s.discount}>{p.discount}</span>}
                          {p.discount && (
                            <Text size={15} color="var(--tg-textSecondary)">
                              {p.perMonth} ₽ {t('per month')}
                            </Text>
                          )}
                        </div>
                      </div>
                      <Text size={16} color="var(--tg-textPrimary)" className={s.planTotal}>
                        {p.total} ₽
                      </Text>
                    </div>
                  )
                })}
              </div>

              {/* features */}
              <div className={s.features}>
                {FEATURES.map((f) => (
                  <div key={f.title} className={s.feature}>
                    <div className={s.featureIcon} style={{ background: f.color }}>
                      {f.icon}
                    </div>
                    <div className={s.featureBody}>
                      <Text size={16} weight={500} color="var(--tg-textPrimary)">
                        {t(f.title)}
                      </Text>
                      <Text size={14.5} color="var(--tg-textSecondary)" style={{ lineHeight: 1.35 }}>
                        {t(f.subtitle)}
                      </Text>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* sticky CTA */}
            <div className={s.ctaWrap}>
              <motion.div
                className={s.cta}
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                onClick={onClose}
              >
                {t('Subscribe for')} {selected.perMonth} ₽ {t('per month')}
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
