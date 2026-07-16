// Настройки → «Папки с чатами» — порт tweb chatFolders.tsx: анимация Folders_1
// (86×86), caption, кнопка «Новая папка», секция «Папки» (строки со счётчиками
// «1 канал и 1 группа»), «Рекомендованные папки» (с кнопкой Добавить),
// «Расположение папок» (radio → settings.tabsInSidebar, tweb Folders view).
import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import LottieSticker from '../LottieSticker'
import { useT, useLang } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useSettings } from '../../settings'
import { useFoldersStore } from '../../stores/foldersStore'
import { folderCounts } from '../../core/folderFilter'
import type { Folder, FolderInput } from '../../core/managers/foldersManager'
import type { Chat } from '../../data'
import { SettingsScreen, Section, Row } from '../settings/kit'
import FolderEditor from './FolderEditor'
import { folderSubtitle } from './labels'
import s from './ChatFoldersSettings.module.scss'

// Рекомендованные папки (tweb getSuggestedDialogsFilters; у нас — статичные
// пресеты, скрываются если папка с таким названием уже есть).
const SUGGESTED: { title: string; desc: string; input: Omit<FolderInput, 'title'> }[] = [
  {
    title: 'New',
    desc: 'Chats with new messages.',
    input: {
      contacts: true, nonContacts: true, groups: true, broadcasts: true,
      excludeMuted: false, excludeRead: true, includeChats: [], excludeChats: [],
    },
  },
  {
    title: 'Personal',
    desc: 'Messages from private chats.',
    input: {
      contacts: true, nonContacts: true, groups: false, broadcasts: false,
      excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
    },
  },
]

function RadioRow({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  const t = useT()
  return (
    <div className={s.radioRow} onClick={onClick}>
      <TgIcon name={selected ? 'radioon' : 'radiooff'} color={selected ? 'var(--tg-accent)' : 'var(--tg-textFaint)'} />
      <Text size={16} color="var(--tg-textPrimary)">{t(label)}</Text>
    </div>
  )
}

export default function ChatFoldersSettings({ onBack, chats = [] }: { onBack: () => void; chats?: Chat[] }) {
  const t = useT()
  const [lang] = useLang()
  const managers = useManagers()
  const folders = useFoldersStore((st) => st.folders)
  const contactIds = useFoldersStore((st) => st.contactIds)
  const upsert = useFoldersStore((st) => st.upsert)
  const { tabsInSidebar, update } = useSettings()
  const [editor, setEditor] = useState<Folder | 'new' | null>(null)

  const suggested = SUGGESTED.filter((sg) => !folders.some((f) => f.title === t(sg.title)))
  const addSuggested = (sg: (typeof SUGGESTED)[number]) => {
    void managers.folders
      .create({ ...sg.input, title: t(sg.title) })
      .then(upsert)
      .catch(() => undefined)
  }

  return (
    <SettingsScreen title="Chat Folders" onBack={onBack}>
      <LottieSticker name="Folders_1" size={86} />
      <Text size={14} color="var(--tg-textSecondary)" className={s.caption}>
        {t('Create folders for different groups of chats and quickly switch between them.')}
      </Text>
      <div className={s.createWrap}>
        <button type="button" className={s.createBtn} onClick={() => setEditor('new')}>
          <TgIcon name="add" size={20} />
          {t('Create Folder')}
        </button>
      </div>

      {folders.length > 0 && (
        <Section caption="Folders">
          {folders.map((f) => (
            <Row
              key={f.id}
              label={f.title}
              translate={false}
              sublabel={folderSubtitle(folderCounts(chats, f, contactIds), lang)}
              onClick={() => setEditor(f)}
            />
          ))}
        </Section>
      )}

      {suggested.length > 0 && (
        <Section caption="Recommended Folders">
          {suggested.map((sg) => (
            <div key={sg.title} className={s.suggestedRow}>
              <div className={s.suggestedBody}>
                <Text size={16} color="var(--tg-textPrimary)">{t(sg.title)}</Text>
                <Text size={13.5} color="var(--tg-textSecondary)">{t(sg.desc)}</Text>
              </div>
              <button type="button" className={s.addBtn} onClick={() => addSuggested(sg)}>
                {t('Add')}
              </button>
            </div>
          ))}
        </Section>
      )}

      <Section caption="Folders view">
        <RadioRow label="Folders on the Left" selected={tabsInSidebar} onClick={() => update({ tabsInSidebar: true })} />
        <RadioRow label="Folders above chats" selected={!tabsInSidebar} onClick={() => update({ tabsInSidebar: false })} />
      </Section>

      <AnimatePresence>
        {editor && (
          <FolderEditor folder={editor === 'new' ? null : editor} chats={chats} onClose={() => setEditor(null)} />
        )}
      </AnimatePresence>
    </SettingsScreen>
  )
}
