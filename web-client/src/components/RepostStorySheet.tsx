// RepostStorySheet — репост чужой истории (4d, tweb fwd_from). Переиспользует
// AddStorySheet (подпись/приватность/период), но вместо post вызывает repost:
// media берётся с бэка от оригинала, fwd_from = автор+id источника.
import { createPortal } from 'react-dom'
import AddStorySheet from './AddStorySheet'
import { useManagers } from '../core/hooks/useManagers'
import rootScope from '@lib/rootScope'
import { loadStories } from '../stores/storiesStore'

export default function RepostStorySheet({
  sourceAuthorId,
  sourceStoryId,
  onClose,
}: {
  sourceAuthorId: number
  sourceStoryId: number
  onClose: () => void
}) {
  const managers = useManagers()
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 3200 }}>
      <AddStorySheet
        onBack={onClose}
        onPublish={async (args) => {
          try {
            await managers.stories.repost({ sourceAuthorId, sourceStoryId, ...args })
            await loadStories(managers)
            rootScope.dispatchEvent('ui:toast', 'История репостнута')
          } catch {
            rootScope.dispatchEvent('ui:toast', 'Не удалось репостнуть историю')
          }
          onClose()
        }}
      />
    </div>,
    document.body,
  )
}
