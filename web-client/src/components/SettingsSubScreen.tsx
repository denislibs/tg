import type { LangPackKey } from '@/lang'
import SpeakersCamera from './settings/SpeakersCamera'
import PrivacySecuritySettings from './settings/PrivacySecuritySettings'
import StickersSettings from './settings/StickersSettings'

// Мок-экранов (`SCREENS`) и их саб-экранов (`renderDedicated`: «Быстрая реакция»,
// «Энергосбережение») здесь больше нет: единственный мок «Общих» перехватывала
// ветка `GeneralSettings` (её снесла задача 13 вместе с экраном), и мок-ветка
// рендера была недостижима (задача 14 плана 2D, поправка 10). «Быструю реакцию» открывает строка экрана «Стикеры и
// эмодзи» (вкладка `AppQuickReactionTab`, как tweb `stickersAndEmoji.tsx:60-66`).

export function hasSubScreen(title: LangPackKey) {
  // «Устройства» здесь БОЛЬШЕ НЕТ: экран уехал на слайдер вкладок
  // (`sidebarLeft/tabs/activeSessions.solid.tsx`), в колонку его завёл шаг 8
  // плана волны 2. «Языка» — тоже: он стал вкладкой `AppLanguageTab`
  // (`sidebarLeft/tabs/language.solid.tsx`), и React-экран
  // `settings/LanguageSettings.tsx` снесён вместе со своими стилями и тестом.
  // «Уведомлений и звуков» — тоже: вкладка `AppNotificationsTab`
  // (`sidebarLeft/tabs/notifications.solid.tsx`, пилот плана 2D, задача 6).
  // «Горячих клавиш» — тоже: вкладка `AppKeyboardShortcutsTab`
  // (`sidebarLeft/tabs/keyboardShortcuts.solid.tsx`, план 2D, задача 10).
  // «Данных и памяти» — тоже: вкладка `AppDataAndStorageTab`
  // (`sidebarLeft/tabs/dataAndStorage/index.solid.tsx`, план 2D, задача 7).
  // «Общих» — тоже: вкладка `AppGeneralSettingsTab`
  // (`sidebarLeft/tabs/generalSettings.solid.tsx`, план 2D, задача 13).
  // «Папок» — тоже: вкладка `AppChatFoldersTab`
  // (`sidebarLeft/tabs/chatFolders.solid.tsx`, план 2D, задача 24).
  return (
    title === 'AccountSettings.SpeakersAndCamera' ||
    title === 'PrivacySettings' ||
    title === 'StickersName'
  )
}

export default function SettingsSubScreen({ title, onBack }: { title: LangPackKey; onBack: () => void }) {
  // Speakers and Camera — реальные устройства (enumerateDevices/getUserMedia)
  if (title === 'AccountSettings.SpeakersAndCamera') return <SpeakersCamera onBack={onBack} />
  // Privacy and Security — реальный раздел конфиденциальности (tweb privacyAndSecurity)
  if (title === 'PrivacySettings') return <PrivacySecuritySettings onBack={onBack} />
  // Stickers and Emoji — реальные стикеры (наборы, зацикливание, поиск)
  if (title === 'StickersName') return <StickersSettings onBack={onBack} />

  return null
}
