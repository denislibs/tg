import type { LangPackKey } from '@/lang'
import GeneralSettings from './settings/GeneralSettings'
import SpeakersCamera from './settings/SpeakersCamera'
import ChatFoldersSettings from './folders/ChatFoldersSettings'
import PrivacySecuritySettings from './settings/PrivacySecuritySettings'
import DataStorageSettings from './settings/DataStorageSettings'
import StickersSettings from './settings/StickersSettings'
import HotkeysSettings from './settings/HotkeysSettings'
import type { Chat } from '../data'

// Мок-экранов (`SCREENS`) и их саб-экранов (`renderDedicated`: «Быстрая реакция»,
// «Энергосбережение») здесь больше нет: единственный мок «Общих» перехватывала
// ветка `GeneralSettings` ниже, и мок-ветка рендера была недостижима (задача 14
// плана 2D, поправка 10). «Быструю реакцию» открывает строка экрана «Стикеры и
// эмодзи» (вкладка `AppQuickReactionTab`, как tweb `stickersAndEmoji.tsx:60-66`).

export function hasSubScreen(title: LangPackKey) {
  // «Устройства» здесь БОЛЬШЕ НЕТ: экран уехал на слайдер вкладок
  // (`sidebarLeft/tabs/activeSessions.solid.tsx`), в колонку его завёл шаг 8
  // плана волны 2. «Языка» — тоже: он стал вкладкой `AppLanguageTab`
  // (`sidebarLeft/tabs/language.solid.tsx`), и React-экран
  // `settings/LanguageSettings.tsx` снесён вместе со своими стилями и тестом.
  // «Уведомлений и звуков» — тоже: вкладка `AppNotificationsTab`
  // (`sidebarLeft/tabs/notifications.solid.tsx`, пилот плана 2D, задача 6).
  return (
    title === 'Telegram.GeneralSettingsViewController' ||
    title === 'AccountSettings.SpeakersAndCamera' ||
    title === 'ChatList.Filter.List.Title' ||
    title === 'PrivacySettings' ||
    title === 'DataSettings' ||
    title === 'StickersName' ||
    title === 'KeyboardShortcuts.Title'
  )
}

export default function SettingsSubScreen({ title, onBack, chats }: { title: LangPackKey; onBack: () => void; chats?: Chat[] }) {
  // General Settings is a fully functional screen (text size, wallpaper, theme, time)
  if (title === 'Telegram.GeneralSettingsViewController') return <GeneralSettings onBack={onBack} />
  // Speakers and Camera — реальные устройства (enumerateDevices/getUserMedia)
  if (title === 'AccountSettings.SpeakersAndCamera') return <SpeakersCamera onBack={onBack} />
  // Chat Folders — реальные папки чатов (tweb chatFolders)
  if (title === 'ChatList.Filter.List.Title') return <ChatFoldersSettings onBack={onBack} chats={chats} />
  // Privacy and Security — реальный раздел конфиденциальности (tweb privacyAndSecurity)
  if (title === 'PrivacySettings') return <PrivacySecuritySettings onBack={onBack} />
  // Data and Storage — реальные «Данные и память» (tweb dataAndStorage)
  if (title === 'DataSettings') return <DataStorageSettings onBack={onBack} />
  // Stickers and Emoji — реальные стикеры (наборы, зацикливание, поиск)
  if (title === 'StickersName') return <StickersSettings onBack={onBack} />
  // Keyboard Shortcuts — статичная таблица хоткеев (tweb keyboardShortcuts)
  if (title === 'KeyboardShortcuts.Title') return <HotkeysSettings onBack={onBack} />

  return null
}
