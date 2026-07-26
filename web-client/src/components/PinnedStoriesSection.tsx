import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import Text from '../shared/ui/Text'
import { useT } from '../i18n'
import { useManagers } from '../core/hooks/useManagers'
import StoryReadOnlyPreview from './StoryReadOnlyPreview'
import type { StoryItem } from '../core/managers/storiesManager'

// Плитка закреплённой истории: превью медиа (thumbUrl).
function Tile({ story, onClick }: { story: StoryItem; onClick: () => void }) {
  const managers = useManagers()
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    void managers.media.thumbUrl(story.mediaId).then((u) => { if (alive) setUrl(u) }).catch(() => {})
    return () => { alive = false }
  }, [managers, story.mediaId])
  return (
    <div
      onClick={onClick}
      role="button"
      style={{ aspectRatio: '9 / 16', borderRadius: 10, overflow: 'hidden', background: 'var(--tg-inputSearchBg)', cursor: 'pointer' }}
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
  const managers = useManagers()
  const [items, setItems] = useState<StoryItem[]>([])
  const [openId, setOpenId] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    managers.stories.pinnedStories(peerId).then((list) => { if (alive) setItems(list) }).catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [managers, peerId])

  if (items.length === 0) return null
  const open = items.find((i) => i.id === openId) ?? null

  return (
    <div style={{ padding: '0 16px 12px' }}>
      <Text size={14} weight={600} color="var(--tg-accent)" style={{ padding: '0 4px 6px', display: 'block' }}>
        {t('Stories')}
      </Text>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {items.map((it) => (
          <Tile key={it.id} story={it} onClick={() => setOpenId(it.id)} />
        ))}
      </div>
      <AnimatePresence>
        {open && <StoryReadOnlyPreview key={open.id} story={open} onClose={() => setOpenId(null)} />}
      </AnimatePresence>
    </div>
  )
}
