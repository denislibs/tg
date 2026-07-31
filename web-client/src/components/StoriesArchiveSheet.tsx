import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useT } from '../i18n'
import { useStoriesArchive } from '../core/hooks/useStoriesArchive'
import { useMediaThumb } from '../core/hooks/useMediaThumb'
import StoryReadOnlyPreview from './StoryReadOnlyPreview'
import type { StoryItem } from '../core/managers/storiesManager'
import s from './AddStorySheet.module.scss'

// Плитка архива: грузит превью медиа истории (thumbUrl) и показывает бейджи
// pinned/edited поверх.
function ArchiveTile({ story, onClick }: { story: StoryItem; onClick: () => void }) {
  const url = useMediaThumb(story.mediaId)
  return (
    <div
      onClick={onClick}
      role="button"
      style={{ position: 'relative', aspectRatio: '9 / 16', borderRadius: 10, overflow: 'hidden', background: 'var(--tg-inputSearchBg)', cursor: 'pointer' }}
    >
      {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      {story.pinned && (
        <div style={{ position: 'absolute', top: 4, right: 4, color: '#fff', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))' }}>
          <TgIcon name="pinnedchat" size={16} />
        </div>
      )}
    </div>
  )
}

/**
 * «Мои истории → Архив» (постинг-сторона, минималистично «по мотивам» TG):
 * грид своих истёкших историй (useStoriesArchive). Клик по плитке
 * открывает read-only превью (медиа + подпись), без реакций/ответа/навигации —
 * архивная история уже недоступна зрителям.
 */
export default function StoriesArchiveSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const items = useStoriesArchive()
  const [openId, setOpenId] = useState<number | null>(null)

  const open = items?.find((i) => i.id === openId) ?? null

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      style={{ position: 'absolute', inset: 0, zIndex: 42, background: 'var(--tg-sidebarBg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <div className={s.header}>
        <IconButton onClick={onClose} aria-label={t('Back')} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)">
          {t('Stories Archive')}
        </Text>
      </div>

      <div className={s.body} style={{ padding: '4px 12px 24px' }}>
        {items == null ? (
          <Text size={15} color="var(--tg-textSecondary)" style={{ padding: 16 }}>{t('Loading')}</Text>
        ) : items.length === 0 ? (
          <Text size={15} color="var(--tg-textSecondary)" style={{ padding: 16 }}>{t('No archived stories')}</Text>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {items.map((it) => (
              <ArchiveTile key={it.id} story={it} onClick={() => setOpenId(it.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Read-only просмотр архивной истории */}
      <AnimatePresence>
        {open && <StoryReadOnlyPreview key={open.id} story={open} onClose={() => setOpenId(null)} />}
      </AnimatePresence>
    </motion.div>
  )
}
