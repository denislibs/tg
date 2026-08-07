import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { slideInRight } from '../motion'
import { useT } from '../i18n'
import { useStoryStats } from '../core/hooks/useStoryStats'
import StatChart from './StatChart'
import s from './UserInfoPanel.module.scss'

// Экран «Статистика истории» (аналог tweb storyStatistics). Full-screen оверлей
// над просмотрщиком: карточка просмотров + график просмотров по дням. Данные —
// реальные (story_views), ряд считает бэкенд. Доступ — только у автора.

const nf = new Intl.NumberFormat(undefined)

export default function StoryStats({ storyId, onClose }: { storyId: number; onClose: () => void }) {
  const t = useT()
  const { stats, loading, error } = useStoryStats(storyId)

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000 }}>
      <motion.div variants={slideInRight} initial="initial" animate="animate" exit="exit" className={s.rights}>
        <div className={s.rightsHeader}>
          <IconButton onClick={onClose} color="var(--secondary-text-color)">
            <TgIcon name="back" />
          </IconButton>
          <Text noWrap size={19} weight={600} color="var(--primary-text-color)" style={{ flex: 1 }}>
            {t('Story statistics')}
          </Text>
        </div>

        <div className={s.body}>
          {loading && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Text size={15} color="var(--secondary-text-color)">{t('Loading statistics…')}</Text>
            </div>
          )}
          {error && !loading && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Text size={15} color="var(--secondary-text-color)">{t('Statistics are not available.')}</Text>
            </div>
          )}

          {stats && !loading && (
            <>
              <div className={s.section} style={{ marginTop: 8 }}>
                <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionTitle}>
                  {t('Overview')}
                </Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <div
                    style={{
                      flex: '1 1 40%',
                      minWidth: 0,
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: 'var(--surface-color)',
                    }}
                  >
                    <Text size={19} weight={600} color="var(--primary-color)">{nf.format(stats.views)}</Text>
                    <Text noWrap size={13} color="var(--secondary-text-color)">{t('Views')}</Text>
                  </div>
                </div>
              </div>

              {stats.viewsByDay.length > 0 && (
                <div className={s.section}>
                  <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionTitle}>
                    {t('Views by day')}
                  </Text>
                  <div className={s.cardPlain} style={{ padding: '12px 12px 8px' }}>
                    <StatChart points={stats.viewsByDay} variant="line" color="var(--green-color, #4dcd5e)" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
