import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import { useManagers } from './useManagers'
import { loadStories } from '../../stores/storiesStore'
import { uiEvents } from './uiEvents'
import StoryViewer from '../../components/StoryViewer'
import AddStorySheet from '../../components/AddStorySheet'
import CloseFriendsSheet from '../../components/CloseFriendsSheet'
import StoriesArchiveSheet from '../../components/StoriesArchiveSheet'
import type { StoryTargetGetter } from '../../components/StoriesRow'
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
  // Откуда вьюер летит на открытии и куда возвращается на закрытии: геттер
  // аватарки ряда историй (tweb передаёт `target` в createStoriesViewer, list.tsx:95).
  const storyTargetRef = useRef<StoryTargetGetter | null>(null)
  const getStoryTarget = useCallback<StoryTargetGetter>((groupIndex) => storyTargetRef.current?.(groupIndex) ?? null, [])

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

      {/* Листы историй — вкладки слайдера сайдбара (tweb SidebarSlider: узел
          создаётся на открытии и снимается по концу перехода, `slider.ts:41-46`).
          Вход/уход ведёт сам лист, обёртка-презенс тут не нужна. */}

      {/* Лист создания истории (открывается после загрузки медиа) */}
      {storyMediaId != null && (
        <AddStorySheet onBack={() => setStoryMediaId(null)} onPublish={publishStory} onEditCloseFriends={() => setShowCloseFriends(true)} />
      )}

      {/* Редактор списка близких друзей */}
      {showCloseFriends && <CloseFriendsSheet onClose={() => setShowCloseFriends(false)} />}

      {/* Архив своих истёкших историй */}
      {showArchive && <StoriesArchiveSheet onClose={() => setShowArchive(false)} />}

      {/* Полноэкранный просмотрщик историй */}
      {storyOpen != null && <StoryViewer groupIndex={storyOpen} getTarget={getStoryTarget} onClose={() => setStoryOpen(null)} />}
    </>
  )

  return {
    openViewer: (groupIndex: number, getTarget?: StoryTargetGetter) => {
      storyTargetRef.current = getTarget ?? null
      setStoryOpen(groupIndex)
    },
    pickStoryFile,
    openArchive: () => setShowArchive(true),
    openCloseFriends: () => setShowCloseFriends(true),
    overlays,
  }
}
