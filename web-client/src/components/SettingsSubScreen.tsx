import type { LangPackKey } from '@/lang'
import { useState, type ReactNode } from 'react'
import { useT } from '../i18n'
import { SettingsScreen, Section, Row } from './settings/kit'
import QuickReaction from './settings/QuickReaction'
import PowerSaving from './settings/PowerSaving'
import GeneralSettings from './settings/GeneralSettings'
import SpeakersCamera from './settings/SpeakersCamera'
import NotificationsSettings from './settings/NotificationsSettings'
import ChatFoldersSettings from './folders/ChatFoldersSettings'
import PrivacySecuritySettings from './settings/PrivacySecuritySettings'
import DataStorageSettings from './settings/DataStorageSettings'
import StickersSettings from './settings/StickersSettings'
import HotkeysSettings from './settings/HotkeysSettings'
import type { Chat } from '../data'

// Rows that open a dedicated sub-screen instead of being a plain value.
const NAV = new Set<string>(['LiteMode.Title', 'DoubleTapSetting'])
function renderDedicated(label: LangPackKey, onBack: () => void): ReactNode {
  switch (label) {
    case 'LiteMode.Title':
      return <PowerSaving onBack={onBack} />
    case 'DoubleTapSetting':
      return <QuickReaction onBack={onBack} />
  }
  return null
}

type Ctrl = 'toggle' | 'value' | 'link' | 'button' | 'radio'
/** Подпись строки: ключ ЛИБО готовый текст (родные имена языков) — тот же раскол, что
 *  задача 7 сняла в ВАНИЛЬНОМ `Row` (там роль поля выражена ТИПОМ: ключ и готовое
 *  содержимое лежат в разных полях). Здесь `label: string` не различает их, и тайпчек
 *  на подставленном ключе смолчит. Уходит вместе с React-двойником `Row` — ЗАДАЧА #112
 *  (остатки волны 2, там двойники и перечислены). */
interface SRow {
  label: string
  type: Ctrl
  value?: string
  on?: boolean
  danger?: boolean
}
interface SSection {
  caption?: LangPackKey
  footer?: LangPackKey
  rows: SRow[]
}

// Structure mirrors tweb's settings tabs (content is mock)
const SCREENS: Partial<Record<LangPackKey, SSection[]>> = {
  'Telegram.GeneralSettingsViewController': [
    {
      caption: 'Settings',
      rows: [
        { label: 'General.TextSize', type: 'value', value: '16' },
        { label: 'ChatBackground.Title', type: 'link' },
        { label: 'DoubleTapSetting', type: 'value', value: '👍' },
        { label: 'LiteMode.Title', type: 'value', value: 'Checkbox.Disabled' },
      ],
    },
    {
      caption: 'General.TimeFormat',
      rows: [
        { label: 'General.TimeFormat.h12', type: 'radio', on: false },
        { label: 'General.TimeFormat.h23', type: 'radio', on: true },
      ],
    },
  ],
}

export function hasSubScreen(title: LangPackKey) {
  // Speakers and Camera, Notifications and Sounds, Chat Folders — реальные
  // экраны (не из мок-SCREENS). «Устройства» здесь БОЛЬШЕ НЕТ: экран уехал на
  // слайдер вкладок (`sidebarLeft/tabs/activeSessions.solid.tsx`), в колонку
  // его завёл шаг 8 плана волны 2. «Языка» — тоже: он стал вкладкой
  // `AppLanguageTab` (`sidebarLeft/tabs/language.solid.tsx`), и React-экран
  // `settings/LanguageSettings.tsx` снесён вместе со своими стилями и тестом.
  return (
    title in SCREENS ||
    title === 'AccountSettings.SpeakersAndCamera' ||
    title === 'AccountSettings.Notifications' ||
    title === 'ChatList.Filter.List.Title' ||
    title === 'PrivacySettings' ||
    title === 'DataSettings' ||
    title === 'StickersName' ||
    title === 'KeyboardShortcuts.Title'
  )
}

export default function SettingsSubScreen({ title, onBack, chats }: { title: LangPackKey; onBack: () => void; chats?: Chat[] }) {
  const t = useT()
  const sections = SCREENS[title] ?? []

  // local interactive state for toggles & radios
  const [toggles, setToggles] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {}
    sections.forEach((s, si) =>
      s.rows.forEach((r) => {
        if (r.type === 'toggle') o[`${si}:${r.label}`] = !!r.on
      }),
    )
    return o
  })
  const [radios, setRadios] = useState<Record<number, string>>(() => {
    const o: Record<number, string> = {}
    sections.forEach((s, si) => {
      const sel = s.rows.find((r) => r.type === 'radio' && r.on)
      if (sel) o[si] = sel.label
    })
    return o
  })
  const [dedicated, setDedicated] = useState<LangPackKey | null>(null)

  // General Settings is a fully functional screen (text size, wallpaper, theme, time)
  if (title === 'Telegram.GeneralSettingsViewController') return <GeneralSettings onBack={onBack} />
  // Speakers and Camera — реальные устройства (enumerateDevices/getUserMedia)
  if (title === 'AccountSettings.SpeakersAndCamera') return <SpeakersCamera onBack={onBack} />
  // Notifications and Sounds — реальные настройки уведомлений (tweb-структура)
  if (title === 'AccountSettings.Notifications') return <NotificationsSettings onBack={onBack} />
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

  return (
    // Саб-саб-экран уходит ПРОПОМ `sub`, а не детьми: у SettingsScreen он
    // должен стать вкладкой-соседом в `.tabs-container[data-animation="navigation"]`,
    // иначе уходящему экрану некуда сдвигаться и узел не доживает до конца
    // обратного слайда (kit.tsx:56-64,112-117; эталон — `SidebarSlider.closeTab`,
    // tweb components/slider.ts:71-84).
    <SettingsScreen
      title={title}
      onBack={onBack}
      zIndex={50}
      sub={dedicated ? renderDedicated(dedicated, () => setDedicated(null)) : null}
    >
      {sections.map((section, si) => (
        <Section key={si} caption={section.caption} footer={section.footer}>
          {section.rows.map((r) => {
            const key = `${si}:${r.label}`
            const isNav = NAV.has(r.label)
            const onRow = () => {
              if (isNav) setDedicated(r.label as LangPackKey)
              else if (r.type === 'toggle') setToggles((prev) => ({ ...prev, [key]: !prev[key] }))
              else if (r.type === 'radio') setRadios((rd) => ({ ...rd, [si]: r.label }))
            }
            const selected = r.type === 'radio' && radios[si] === r.label
            return (
              <Row
                key={r.label}
                label={r.label}
                onClick={onRow}
                danger={r.danger}
                accent={r.type === 'button' && !r.danger}
                toggle={r.type === 'toggle'}
                checked={!!toggles[key]}
                value={r.type === 'value' ? r.value && t(r.value as LangPackKey) : undefined}
                selected={!!selected}
              />
            )
          })}
        </Section>
      ))}
    </SettingsScreen>
  )
}
