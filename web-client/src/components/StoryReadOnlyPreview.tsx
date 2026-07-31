import { motion } from 'framer-motion'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useT } from '../i18n'
import { useStoryPreviewMedia } from '../core/hooks/useStoryPreviewMedia'
import { EASE } from '../motion'
import type { StoryItem } from '../core/managers/storiesManager'

/**
 * Полноэкранный read-only просмотр одной истории (архив/закреплённые в профиле):
 * медиа + подпись + пометка edited, без прогресса/реакций/ответа/навигации.
 * Общий для StoriesArchiveSheet и PinnedStoriesSection.
 */
export default function StoryReadOnlyPreview({ story, onClose }: { story: StoryItem; onClose: () => void }) {
  const t = useT()
  const { url, isVideo } = useStoryPreviewMedia(story.mediaId)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: EASE }}
      style={{ position: 'fixed', inset: 0, zIndex: 3300, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 2 }}>
        <IconButton onClick={onClose} color="#fff" size="small"><TgIcon name="close" /></IconButton>
      </div>
      {url && (isVideo
        ? <video src={url} autoPlay muted playsInline loop style={{ maxWidth: '100%', maxHeight: '100%' }} />
        : <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />)}
      {(story.caption || story.edited) && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, background: 'linear-gradient(to top, rgba(0,0,0,.6), transparent)' }}>
          {story.caption && <Text color="#fff" size={15}>{story.caption}</Text>}
          {story.edited && <Text color="rgba(255,255,255,0.6)" size={12}>{t('edited')}</Text>}
        </div>
      )}
    </motion.div>
  )
}
