import { createPortal } from 'react-dom'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useT } from '../i18n'
import { useStoryStats } from '../core/hooks/useStoryStats'
import StatChart from './StatChart'

// Экран «Статистика истории» (аналог tweb storyStatistics). Full-screen оверлей
// над просмотрщиком: карточка просмотров + график просмотров по дням. Данные —
// реальные (story_views), ряд считает бэкенд. Доступ — только у автора.

const nf = new Intl.NumberFormat(undefined)

export default function StoryStats({ authorId, storyId, onClose }: { authorId: number; storyId: number; onClose: () => void }) {
  const t = useT()
  const { stats, loading, error } = useStoryStats(authorId, storyId)

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000 }}>
      <div className="tabs-tab sidebar-slider-item scrollable-y-bordered statistics-container active">
        <div className="sidebar-header">
          <button type="button" className="btn-icon sidebar-close-button" onClick={onClose} aria-label={t('Back')}>
            <TgIcon name="back" />
          </button>
          <div className="sidebar-header__title">{t('Story statistics')}</div>
        </div>

        <div className="sidebar-content">
        <div className="scrollable scrollable-y">
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
              <div className="sidebar-left-section-container">
                <div className="sidebar-left-section">
                  <div className="sidebar-left-section-name">{t('Overview')}</div>
                  {/* Сводка — вендорная сетка `.statistics-overview` */}
                  <div className="statistics-overview">
                    <div className="statistics-overview-item">
                      <div className="statistics-overview-item-value">{nf.format(stats.views)}</div>
                      <div className="statistics-overview-item-value-description">{t('Views')}</div>
                    </div>
                  </div>
                </div>
              </div>

              {stats.viewsByDay.length > 0 && (
                <div className="sidebar-left-section-container">
                  <div className="sidebar-left-section">
                    <div className="sidebar-left-section-name">{t('Views by day')}</div>
                    <div className="sidebar-left-section-content">
                    <StatChart points={stats.viewsByDay} variant="line" color="var(--green-color, #4dcd5e)" />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
