import { useState, type ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useT, useLang, LANGS } from '../i18n'
import { SettingsScreen, Section, Row } from './settings/kit'
import ActiveSessions from './settings/ActiveSessions'
import QuickReaction from './settings/QuickReaction'
import PowerSaving from './settings/PowerSaving'
import LanguageSettings from './settings/LanguageSettings'
import GeneralSettings from './settings/GeneralSettings'
import SpeakersCamera from './settings/SpeakersCamera'
import NotificationsSettings from './settings/NotificationsSettings'
import ChatFoldersSettings from './folders/ChatFoldersSettings'
import PrivacySecuritySettings from './settings/PrivacySecuritySettings'
import DataStorageSettings from './settings/DataStorageSettings'
import StickersSettings from './settings/StickersSettings'
import type { Chat } from '../data'

// Rows that open a dedicated sub-screen instead of being a plain value.
const NAV = new Set<string>(['Power Saving', 'Quick Reaction'])
function renderDedicated(label: string, onBack: () => void): ReactNode {
  switch (label) {
    case 'Power Saving':
      return <PowerSaving onBack={onBack} />
    case 'Quick Reaction':
      return <QuickReaction onBack={onBack} />
  }
  return null
}

type Ctrl = 'toggle' | 'value' | 'link' | 'button' | 'radio'
interface SRow {
  label: string
  type: Ctrl
  value?: string
  on?: boolean
  danger?: boolean
}
interface SSection {
  caption?: string
  footer?: string
  rows: SRow[]
}

// Structure mirrors tweb's settings tabs (content is mock)
const SCREENS: Record<string, SSection[]> = {
  'General Settings': [
    {
      caption: 'Settings',
      rows: [
        { label: 'Text Size', type: 'value', value: '16' },
        { label: 'Chat Background', type: 'link' },
        { label: 'Quick Reaction', type: 'value', value: '👍' },
        { label: 'Power Saving', type: 'value', value: 'Disabled' },
      ],
    },
    {
      caption: 'Time Format',
      rows: [
        { label: '12-hour', type: 'radio', on: false },
        { label: '24-hour', type: 'radio', on: true },
      ],
    },
  ],
  Language: [
    {
      caption: 'Translate',
      rows: [{ label: 'Show Translate Button', type: 'toggle', on: true }],
    },
    {
      rows: [
        { label: 'English', type: 'radio', on: true },
        { label: 'Русский', type: 'radio', on: false },
        { label: 'Українська', type: 'radio', on: false },
        { label: 'Español', type: 'radio', on: false },
        { label: 'Deutsch', type: 'radio', on: false },
        { label: 'Français', type: 'radio', on: false },
      ],
    },
  ],
  'Keyboard Shortcuts': [
    {
      rows: [
        { label: 'Search', type: 'value', value: '⌘ K' },
        { label: 'New Group', type: 'value', value: '⌘ ⇧ G' },
        { label: 'Next Chat', type: 'value', value: '⌘ ↓' },
        { label: 'Previous Chat', type: 'value', value: '⌘ ↑' },
        { label: 'Settings', type: 'value', value: '⌘ ,' },
      ],
    },
  ],
}

export function hasSubScreen(title: string) {
  // Devices, Speakers and Camera, Notifications and Sounds, Chat Folders —
  // реальные экраны (не из мок-SCREENS)
  return (
    title in SCREENS ||
    title === 'Devices' ||
    title === 'Speakers and Camera' ||
    title === 'Notifications and Sounds' ||
    title === 'Chat Folders' ||
    title === 'Privacy and Security' ||
    title === 'Data and Storage' ||
    title === 'Stickers and Emoji'
  )
}

// Strings that are not English UI text and must not be translated.
const NATIVE_LANGUAGE_NAMES = new Set([
  'English',
  'Русский',
  'Українська',
  'Español',
  'Deutsch',
  'Français',
])
const KEYBOARD_SHORTCUTS = new Set(['⌘ K', '⌘ ⇧ G', '⌘ ↓', '⌘ ↑', '⌘ ,'])

export default function SettingsSubScreen({ title, onBack, chats }: { title: string; onBack: () => void; chats?: Chat[] }) {
  const t = useT()
  const [lang, setLang] = useLang()
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
  const [dedicated, setDedicated] = useState<string | null>(null)

  // Language has a dedicated tweb-style screen (radio-left list + native names)
  if (title === 'Language') return <LanguageSettings onBack={onBack} />
  // General Settings is a fully functional screen (text size, wallpaper, theme, time)
  if (title === 'General Settings') return <GeneralSettings onBack={onBack} />
  // Devices — реальные сессии с бэка (список/завершение), без мок-прослойки
  if (title === 'Devices') return <ActiveSessions onBack={onBack} />
  // Speakers and Camera — реальные устройства (enumerateDevices/getUserMedia)
  if (title === 'Speakers and Camera') return <SpeakersCamera onBack={onBack} />
  // Notifications and Sounds — реальные настройки уведомлений (tweb-структура)
  if (title === 'Notifications and Sounds') return <NotificationsSettings onBack={onBack} />
  // Chat Folders — реальные папки чатов (tweb chatFolders)
  if (title === 'Chat Folders') return <ChatFoldersSettings onBack={onBack} chats={chats} />
  // Privacy and Security — реальный раздел конфиденциальности (tweb privacyAndSecurity)
  if (title === 'Privacy and Security') return <PrivacySecuritySettings onBack={onBack} />
  // Data and Storage — реальные «Данные и память» (tweb dataAndStorage)
  if (title === 'Data and Storage') return <DataStorageSettings onBack={onBack} />
  // Stickers and Emoji — реальные стикеры (наборы, зацикливание, поиск)
  if (title === 'Stickers and Emoji') return <StickersSettings onBack={onBack} />

  return (
    <SettingsScreen title={title} onBack={onBack} zIndex={50}>
      {sections.map((section, si) => (
        <Section key={si} caption={section.caption} footer={section.footer}>
          {section.rows.map((r) => {
            const key = `${si}:${r.label}`
            // The Language screen's radios actually switch the app language
            const langEntry =
              title === 'Language' && r.type === 'radio'
                ? LANGS.find((l) => l.name === r.label)
                : undefined
            const isNav = NAV.has(r.label)
            const onRow = () => {
              if (isNav) setDedicated(r.label)
              else if (r.type === 'toggle') setToggles((prev) => ({ ...prev, [key]: !prev[key] }))
              else if (langEntry) setLang(langEntry.code)
              else if (r.type === 'radio') setRadios((rd) => ({ ...rd, [si]: r.label }))
            }
            const selected = langEntry
              ? langEntry.code === lang
              : r.type === 'radio' && radios[si] === r.label
            const isNative = NATIVE_LANGUAGE_NAMES.has(r.label)
            return (
              <Row
                key={r.label}
                label={r.label}
                translate={!isNative}
                onClick={onRow}
                danger={r.danger}
                accent={r.type === 'button' && !r.danger}
                toggle={r.type === 'toggle'}
                checked={!!toggles[key]}
                value={
                  r.type === 'value'
                    ? r.value && (KEYBOARD_SHORTCUTS.has(r.value) ? r.value : t(r.value))
                    : undefined
                }
                chevron={isNav}
                selected={!!selected}
              />
            )
          })}
        </Section>
      ))}

      {/* dedicated sub-sub-screen overlay */}
      <AnimatePresence>
        {dedicated && renderDedicated(dedicated, () => setDedicated(null))}
      </AnimatePresence>
    </SettingsScreen>
  )
}
