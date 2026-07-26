import { Tabs } from '../shared/ui/Tabs'
import { useT } from '../i18n'
import type { Folder } from '../core/managers/foldersManager'
import { ALL_FOLDER_ID } from '../stores/foldersStore'

// Табы папок (tweb folders-tabs): «Все» + папки пользователя; value = id папки
// (0 — «Все чаты»). Правый клик по табу — контекстное меню папки, как в tweb
// createFolderContextMenu. Слайд контента остаётся в ChatList (±100%).
export default function FolderTabs({
  value,
  onChange,
  folders,
  counts,
  onTabContextMenu,
}: {
  value: number
  onChange: (id: number) => void
  folders: Folder[]
  /** число непрочитанных чатов по id папки; badge только когда > 0 */
  counts?: Record<number, number>
  onTabContextMenu?: (id: number, e: React.MouseEvent) => void
}) {
  const t = useT()
  return (
    <Tabs value={value} onChange={(v) => onChange(Number(v))}>
      <Tabs.List framed>
        <Tabs.Tab
          value={ALL_FOLDER_ID}
          badge={counts?.[ALL_FOLDER_ID]}
          onContextMenu={(e) => onTabContextMenu?.(ALL_FOLDER_ID, e)}
        >
          {t('All')}
        </Tabs.Tab>
        {folders.map((f) => (
          <Tabs.Tab
            key={f.id}
            value={f.id}
            badge={counts?.[f.id]}
            onContextMenu={(e) => onTabContextMenu?.(f.id, e)}
          >
            {f.title}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs>
  )
}
