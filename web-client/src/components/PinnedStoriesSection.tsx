import { useState } from 'react'
import Text from '../shared/ui/Text'
import { useT } from '../i18n'
import { useMediaThumb } from '../core/hooks/useMediaThumb'
import { usePinnedStories } from '../core/hooks/usePinnedStories'
import StoryReadOnlyPreview from './StoryReadOnlyPreview'
import type { StoryItem } from '../core/stories/story'
import { storyMediaId } from '../core/stories/story'

// Плитка закреплённой истории: превью медиа (useMediaThumb).
function Tile({ story, onClick }: { story: StoryItem; onClick: () => void }) {
  const url = useMediaThumb(storyMediaId(story))
  return (
    <div
      onClick={onClick}
      role="button"
      style={{ aspectRatio: '9 / 16', borderRadius: 10, overflow: 'hidden', background: 'var(--input-search-background-color)', cursor: 'pointer' }}
    >
      {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </div>
  )
}

/**
 * Секция «закреплённые в профиле истории» (tweb profile stories) в UserInfoPanel.
 * Тянет managers.stories.pinnedStories(peerID); если закреплённых нет — ничего
 * не рендерит. Клик по плитке открывает read-only просмотр.
 */
export default function PinnedStoriesSection({ peerId }: { peerId: number }) {
  const t = useT()
  const items = usePinnedStories(peerId)
  const [openId, setOpenId] = useState<number | null>(null)

  if (items.length === 0) return null
  const open = items.find((i) => i.id === openId) ?? null

  return (
    <div style={{ padding: '0 16px 12px' }}>
      <Text size={14} weight={600} color="var(--primary-color)" style={{ padding: '0 4px 6px', display: 'block' }}>
        {t('Stories')}
      </Text>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {items.map((it) => (
          <Tile key={it.id} story={it} onClick={() => setOpenId(it.id)} />
        ))}
      </div>
      {open && <StoryReadOnlyPreview key={open.id} story={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}
