import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useT } from '../i18n'
import { useStoryPreviewMedia } from '../core/hooks/useStoryPreviewMedia'
import s from './StoryReadOnlyPreview.module.scss'
import type { StoryItem } from '../core/stories/story'
import { isStoryEdited, realStory, storyCaption } from '../core/stories/story'

/**
 * Полноэкранный read-only просмотр одной истории (архив/закреплённые в профиле):
 * медиа + подпись + пометка edited, без прогресса/реакций/ответа/навигации.
 * Общий для StoriesArchiveSheet и PinnedStoriesSection.
 */
export default function StoryReadOnlyPreview({ story, onClose }: { story: StoryItem; onClose: () => void }) {
  const t = useT()
  const { url, isVideo } = useStoryPreviewMedia(realStory(story)?.media)

  return (
    <div className={s.overlay}>
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 2 }}>
        <IconButton onClick={onClose} color="#fff" size="small"><TgIcon name="close" /></IconButton>
      </div>
      {url && (isVideo
        ? <video src={url} autoPlay muted playsInline loop style={{ maxWidth: '100%', maxHeight: '100%' }} />
        : <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />)}
      {(storyCaption(story) || isStoryEdited(story)) && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, background: 'linear-gradient(to top, rgba(0,0,0,.6), transparent)' }}>
          {storyCaption(story) && <Text color="#fff" size={15}>{storyCaption(story)}</Text>}
          {isStoryEdited(story) && <Text color="rgba(255,255,255,0.6)" size={12}>{t('EditedMessage')}</Text>}
        </div>
      )}
    </div>
  )
}
