import { useState, type ReactNode } from 'react'
import { Box, IconButton, Typography, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { slideInRight } from '../motion'
import TgSwitch from './TgSwitch'
import { useT, useLang, LANGS } from '../i18n'
import ActiveSessions from './settings/ActiveSessions'
import BlockedUsers from './settings/BlockedUsers'
import TwoStepVerification from './settings/TwoStepVerification'
import PrivacyRule from './settings/PrivacyRule'
import AutoDownload from './settings/AutoDownload'
import QuickReaction from './settings/QuickReaction'
import PowerSaving from './settings/PowerSaving'
import Passkeys from './settings/Passkeys'
import LanguageSettings from './settings/LanguageSettings'
import GeneralSettings from './settings/GeneralSettings'

// Rows that open a dedicated sub-screen instead of being a plain value.
const PRIVACY_RULES = new Set([
  'Phone Number',
  'Last Seen & Online',
  'Profile Photo',
  'Calls',
  'Forwarded Messages',
  'Groups & Channels',
])
const NAV = new Set<string>([
  ...PRIVACY_RULES,
  'Active Sessions',
  'Blocked Users',
  'Two-Step Verification',
  'Passkeys',
  'Power Saving',
  'Quick Reaction',
  'Auto-Download Media',
])
function renderDedicated(label: string, onBack: () => void): ReactNode {
  if (PRIVACY_RULES.has(label)) return <PrivacyRule title={label} onBack={onBack} />
  switch (label) {
    case 'Active Sessions':
      return <ActiveSessions onBack={onBack} />
    case 'Blocked Users':
      return <BlockedUsers onBack={onBack} />
    case 'Two-Step Verification':
      return <TwoStepVerification onBack={onBack} />
    case 'Passkeys':
      return <Passkeys onBack={onBack} />
    case 'Power Saving':
      return <PowerSaving onBack={onBack} />
    case 'Quick Reaction':
      return <QuickReaction onBack={onBack} />
    case 'Auto-Download Media':
      return <AutoDownload onBack={onBack} />
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
  'Notifications and Sounds': [
    {
      caption: 'Web',
      rows: [
        { label: 'Show Notifications', type: 'toggle', on: true },
        { label: 'Offline Notifications', type: 'toggle', on: true },
        { label: 'Notify All Accounts', type: 'toggle', on: false },
      ],
    },
    {
      caption: 'Sound',
      rows: [
        { label: 'Sound Enabled', type: 'toggle', on: true },
        { label: 'Sent Message Sound', type: 'toggle', on: true },
      ],
    },
    {
      caption: 'Private Chats',
      rows: [
        { label: 'Notifications', type: 'toggle', on: true },
        { label: 'Message Preview', type: 'toggle', on: true },
      ],
    },
    {
      caption: 'Groups',
      rows: [
        { label: 'Notifications', type: 'toggle', on: true },
        { label: 'Message Preview', type: 'toggle', on: true },
      ],
    },
    {
      caption: 'Channels',
      rows: [
        { label: 'Notifications', type: 'toggle', on: true },
        { label: 'Message Preview', type: 'toggle', on: true },
      ],
    },
    {
      caption: 'Other',
      rows: [{ label: 'Contacts joined Telegram', type: 'toggle', on: true }],
    },
  ],
  'Data and Storage': [
    {
      caption: 'Automatic media download',
      rows: [{ label: 'Auto-Download Media', type: 'value', value: 'On' }],
    },
    {
      caption: 'Storage',
      footer: 'Telegram never deletes your messages — they are stored in the cloud.',
      rows: [
        { label: 'Cached files', type: 'value', value: '212 MB' },
        { label: 'Cache time limit', type: 'value', value: '1 week' },
        { label: 'Clear cache', type: 'button', danger: true },
      ],
    },
  ],
  'Privacy and Security': [
    {
      caption: 'Security',
      rows: [
        { label: 'Blocked Users', type: 'value', value: '3' },
        { label: 'Active Sessions', type: 'value', value: '4' },
        { label: 'Auto-Delete Messages', type: 'value', value: 'Off' },
        { label: 'Passcode Lock', type: 'value', value: 'Off' },
        { label: 'Two-Step Verification', type: 'value', value: 'Off' },
        { label: 'Passkeys', type: 'value', value: '2' },
      ],
    },
    {
      caption: 'Privacy',
      rows: [
        { label: 'Phone Number', type: 'value', value: 'My Contacts' },
        { label: 'Last Seen & Online', type: 'value', value: 'Everybody' },
        { label: 'Profile Photo', type: 'value', value: 'Everybody' },
        { label: 'Calls', type: 'value', value: 'Everybody' },
        { label: 'Forwarded Messages', type: 'value', value: 'Everybody' },
        { label: 'Groups & Channels', type: 'value', value: 'Everybody' },
      ],
    },
  ],
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
  'Chat Folders': [
    {
      footer: 'Create folders for different groups of chats and quickly switch between them.',
      rows: [
        { label: 'Create New Folder', type: 'button' },
        { label: 'All Chats', type: 'value', value: '40 chats' },
        { label: 'Personal', type: 'value', value: '12 chats' },
        { label: 'Work', type: 'value', value: '8 chats' },
      ],
    },
  ],
  'Stickers and Emoji': [
    {
      rows: [
        { label: 'Suggest Stickers by Emoji', type: 'value', value: 'All' },
        { label: 'Loop Animated Stickers', type: 'toggle', on: true },
        { label: 'Suggest Emoji', type: 'toggle', on: true },
        { label: 'Big Emoji', type: 'toggle', on: true },
        { label: 'Dynamic Pack Order', type: 'toggle', on: true },
      ],
    },
  ],
  'Speakers and Camera': [
    {
      caption: 'Output',
      rows: [{ label: 'Output Device', type: 'value', value: 'Default' }],
    },
    {
      caption: 'Input',
      rows: [{ label: 'Input Device', type: 'value', value: 'Default' }],
    },
    {
      rows: [{ label: 'Accept Calls', type: 'toggle', on: true }],
    },
  ],
  Devices: [
    {
      caption: 'This device',
      footer: 'Control the apps and devices that are currently logged into your account.',
      rows: [{ label: 'Telegram Web · Chrome, macOS', type: 'value', value: 'online' }],
    },
    {
      caption: 'Active sessions',
      rows: [
        { label: 'Telegram iOS · iPhone 15', type: 'value', value: '2 hours ago' },
        { label: 'Telegram Desktop · Windows', type: 'value', value: 'Jun 18' },
        { label: 'Telegram Android · Pixel 8', type: 'value', value: 'Jun 12' },
        { label: 'Terminate All Other Sessions', type: 'button', danger: true },
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
  return title in SCREENS
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

export default function SettingsSubScreen({ title, onBack }: { title: string; onBack: () => void }) {
  const t = useT()
  const [lang, setLang] = useLang()
  const theme = useTheme()
  const tg = theme.tg
  const isDark = theme.palette.mode === 'dark'
  const cardBg = isDark ? '#2b2b2b' : '#ffffff'
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

  return (
    <motion.div
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        background: tg.sidebarBg,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1.25 }}>
        <IconButton onClick={onBack} sx={{ color: tg.textSecondary }}>
          <TgIcon name="back" />
        </IconButton>
        <Typography sx={{ flex: 1, fontSize: 19, fontWeight: 600, color: tg.textPrimary }}>
          {t(title)}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', pb: 3 }}>
        {sections.map((section, si) => (
          <Box key={si} sx={{ mb: 1.5 }}>
            {section.caption && (
              <Typography
                sx={{ px: 3, pb: 0.5, fontSize: 14, fontWeight: 600, color: tg.accent }}
              >
                {section.caption && t(section.caption)}
              </Typography>
            )}
            <Box sx={{ mx: 1.25, borderRadius: '16px', background: cardBg, py: 0.5 }}>
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
                return (
                  <Box
                    key={r.label}
                    onClick={onRow}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      px: 2,
                      py: 1.15,
                      mx: 0.5,
                      borderRadius: '12px',
                      cursor: 'pointer',
                      '&:hover': { background: tg.hover },
                    }}
                  >
                    <Typography
                      sx={{
                        flex: 1,
                        fontSize: 16,
                        color: r.danger ? '#ff595a' : r.type === 'button' ? tg.accent : tg.textPrimary,
                      }}
                    >
                      {NATIVE_LANGUAGE_NAMES.has(r.label) ? r.label : t(r.label)}
                    </Typography>
                    {r.type === 'toggle' && <TgSwitch checked={!!toggles[key]} />}
                    {r.type === 'value' && (
                      <Typography sx={{ fontSize: 15, color: tg.textFaint }}>
                        {r.value && (KEYBOARD_SHORTCUTS.has(r.value) ? r.value : t(r.value))}
                      </Typography>
                    )}
                    {isNav && <TgIcon name="next" size={22} color={tg.textFaint} />}
                    {selected && <TgIcon name="check" size={22} color={tg.accent} />}
                  </Box>
                )
              })}
            </Box>
            {section.footer && (
              <Typography sx={{ px: 3, pt: 0.75, fontSize: 13.5, color: tg.textSecondary }}>
                {section.footer && t(section.footer)}
              </Typography>
            )}
          </Box>
        ))}
      </Box>

      {/* dedicated sub-sub-screen overlay */}
      <AnimatePresence>
        {dedicated && renderDedicated(dedicated, () => setDedicated(null))}
      </AnimatePresence>
    </motion.div>
  )
}
