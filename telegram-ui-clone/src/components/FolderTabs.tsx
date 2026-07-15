import { Tabs } from '../shared/ui/Tabs'
import { useT } from '../i18n'

export type FolderKey = 'all' | 'private' | 'groups' | 'channels'

export const FOLDER_ORDER: FolderKey[] = ['all', 'private', 'groups', 'channels']

// Sidebar folder filter, rendered with the shared <Tabs> strip (tweb 1:1).
// The chat-list content slide stays in Sidebar (already ±100%).
export default function FolderTabs({
  value,
  onChange,
  counts,
}: {
  value: FolderKey
  onChange: (k: FolderKey) => void
  /** unread-chat count per folder; a tab shows a badge only when > 0 */
  counts?: Partial<Record<FolderKey, number>>
}) {
  const t = useT()
  const tabs: { key: FolderKey; label: string }[] = [
    { key: 'all', label: t('All Chats') },
    { key: 'private', label: t('Private') },
    { key: 'groups', label: t('Groups') },
    { key: 'channels', label: t('Channels') },
  ]
  return (
    <Tabs value={value} onChange={(v) => onChange(v as FolderKey)} order={FOLDER_ORDER}>
      <Tabs.List framed>
        {tabs.map(({ key, label }) => (
          <Tabs.Tab key={key} value={key} badge={counts?.[key]}>
            {label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs>
  )
}
