import { lazy, Suspense, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useManagers } from './useManagers'
import { loadStories } from '../../stores/storiesStore'
import { uiEvents } from './uiEvents'
import StoryViewer from '../../components/StoryViewer'
import AddStorySheet from '../../components/AddStorySheet'
import CloseFriendsSheet from '../../components/CloseFriendsSheet'
import StoriesArchiveSheet from '../../components/StoriesArchiveSheet'
import type { MediaArea } from '../managers/storiesManager'

// MediaEditor (+ WebGL sceneRender/enhanceGL) грузится лениво — только при
// редактировании медиа истории.
const MediaEditor = lazy(() => import('../../components/mediaEditor/MediaEditor'))

// Stories-флоу сайдбара: просмотрщик групп историй + создание (выбор файла →
// MediaEditor → загрузка → лист подписи/приватности → publish) + листы «близкие
// друзья» / архив своих истёкших историй. Возвращает точки входа и готовый
// overlays-узел (весь JSX историй), чтобы Sidebar оставался тонким.
export function useSidebarStories() {
  const managers = useManagers()
  const [storyOpen, setStoryOpen] = useState<number | null>(null)
  const [storyMediaId, setStoryMediaId] = useState<number | null>(null)
  // Выбранный файл истории проходит через MediaEditor до загрузки — как обычное
  // медиа. onDone → загрузка отредактированного → лист.
  const [storyEditFile, setStoryEditFile] = useState<File | null>(null)
  const [showCloseFriends, setShowCloseFriends] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const storyFileRef = useRef<HTMLInputElement>(null)

  const pickStoryFile = () => storyFileRef.current?.click()
  const onStoryFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // разрешить повторный выбор того же файла
    if (!file) return
    setStoryEditFile(file) // сначала редактор (MediaEditor), загрузка — после onDone
  }
  const uploadStoryMedia = async (file: File) => {
    setStoryEditFile(null)
    try {
      const mediaId = await managers.media.upload({ blob: file, mime: file.type, size: file.size, fileName: file.name })
      setStoryMediaId(mediaId)
    } catch {
      // Аплоад сорвался — сбрасываем флоу (лист подписи не откроется) и даём
      // повторить; тост сообщает об ошибке.
      setStoryMediaId(null)
      uiEvents.emit('ui:toast', 'Не удалось загрузить историю')
    }
  }
  const publishStory = async (args: { caption: string; privacy: 'everyone' | 'contacts' | 'close' | 'selected'; allowIds: number[]; period: number; mediaAreas?: MediaArea[] }) => {
    if (storyMediaId == null) return
    await managers.stories.post({ mediaId: storyMediaId, ...args })
    setStoryMediaId(null)
    await loadStories(managers) // подтянуть свою группу с именем/аватаром автора
  }

  const overlays = (
    <>
      {/* Скрытый выбор файла истории (image/video) */}
      <input ref={storyFileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={onStoryFile} />

      {/* Редактор истории: выбранный файл проходит через MediaEditor до загрузки */}
      {storyEditFile && (
        <Suspense fallback={null}>
          <MediaEditor file={storyEditFile} onDone={(f) => void uploadStoryMedia(f)} onCancel={() => setStoryEditFile(null)} />
        </Suspense>
      )}

      {/* Лист создания истории (открывается после загрузки медиа) */}
      <AnimatePresence>
        {storyMediaId != null && (
          <AddStorySheet onBack={() => setStoryMediaId(null)} onPublish={publishStory} onEditCloseFriends={() => setShowCloseFriends(true)} />
        )}
      </AnimatePresence>

      {/* Редактор списка близких друзей */}
      <AnimatePresence>
        {showCloseFriends && <CloseFriendsSheet onClose={() => setShowCloseFriends(false)} />}
      </AnimatePresence>

      {/* Архив своих истёкших историй */}
      <AnimatePresence>
        {showArchive && <StoriesArchiveSheet onClose={() => setShowArchive(false)} />}
      </AnimatePresence>

      {/* Полноэкранный просмотрщик историй */}
      {storyOpen != null && <StoryViewer groupIndex={storyOpen} onClose={() => setStoryOpen(null)} />}
    </>
  )

  return {
    openViewer: (groupIndex: number) => setStoryOpen(groupIndex),
    pickStoryFile,
    openArchive: () => setShowArchive(true),
    openCloseFriends: () => setShowCloseFriends(true),
    overlays,
  }
}
