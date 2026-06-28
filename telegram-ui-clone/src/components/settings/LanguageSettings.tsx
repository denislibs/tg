import { useState } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import { useLang, LANGS, type Lang } from '../../i18n'
import { SettingsScreen, Section, Row, useCardBg } from './kit'

interface LangItem {
  en: string
  native: string
  code?: Lang // set for languages the app can actually switch to
}

// Suggested first (English, Russian), then alphabetical — mirrors tweb.
const LANGUAGES: LangItem[] = [
  { en: 'English', native: 'English', code: 'en' },
  { en: 'Russian', native: 'Русский', code: 'ru' },
  { en: 'Arabic', native: 'العربية' },
  { en: 'Belarusian', native: 'Беларуская' },
  { en: 'Catalan', native: 'Català' },
  { en: 'Chinese (Simplified)', native: '简体中文' },
  { en: 'Chinese (Traditional)', native: '繁體中文' },
  { en: 'Croatian', native: 'Hrvatski' },
  { en: 'Czech', native: 'Čeština' },
  { en: 'Dutch', native: 'Nederlands' },
  { en: 'Finnish', native: 'Suomi' },
  { en: 'French', native: 'Français', code: 'fr' },
  { en: 'German', native: 'Deutsch', code: 'de' },
  { en: 'Greek', native: 'Ελληνικά' },
  { en: 'Hebrew', native: 'עברית' },
  { en: 'Hindi', native: 'हिन्दी' },
  { en: 'Hungarian', native: 'Magyar' },
  { en: 'Indonesian', native: 'Bahasa Indonesia' },
  { en: 'Italian', native: 'Italiano' },
  { en: 'Japanese', native: '日本語' },
  { en: 'Korean', native: '한국어' },
  { en: 'Malay', native: 'Bahasa Melayu' },
  { en: 'Persian', native: 'فارسی' },
  { en: 'Polish', native: 'Polski' },
  { en: 'Portuguese (Brazil)', native: 'Português (Brasil)' },
  { en: 'Romanian', native: 'Română' },
  { en: 'Spanish', native: 'Español', code: 'es' },
  { en: 'Swedish', native: 'Svenska' },
  { en: 'Turkish', native: 'Türkçe' },
  { en: 'Ukrainian', native: 'Українська', code: 'uk' },
  { en: 'Uzbek', native: 'Oʻzbek' },
  { en: 'Vietnamese', native: 'Tiếng Việt' },
]

function Radio({ on }: { on: boolean }) {
  const tg = useTheme().tg
  return (
    <Box
      sx={{
        width: 22,
        height: 22,
        flexShrink: 0,
        borderRadius: '50%',
        border: `2px solid ${on ? tg.accent : tg.textFaint}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'border-color .15s ease',
      }}
    >
      {on && <Box sx={{ width: 11, height: 11, borderRadius: '50%', background: tg.accent }} />}
    </Box>
  )
}

export default function LanguageSettings({ onBack }: { onBack: () => void }) {
  const tg = useTheme().tg
  const cardBg = useCardBg()
  const [lang, setLang] = useLang()
  const [sel, setSel] = useState<string>(lang) // selection key: lang code or 'x:<en>'
  const [showBtn, setShowBtn] = useState(true)

  const currentNative = LANGS.find((l) => l.code === lang)?.name ?? 'English'
  const keyOf = (it: LangItem) => it.code ?? `x:${it.en}`

  return (
    <SettingsScreen title="Language" onBack={onBack}>
      {/* message translation */}
      <Section caption="Message Translation" footer="Watch real-time chat translations with a Telegram Premium subscription.">
        <Row label="Show Translate Button" toggle checked={showBtn} onClick={() => setShowBtn((v) => !v)} />
        <Box sx={{ opacity: 0.5, pointerEvents: 'none' }}>
          <Row label="Translate Entire Chats" toggle checked={false} />
        </Box>
        <Row label="Do Not Translate" value={currentNative} onClick={() => {}} />
      </Section>

      {/* language list */}
      <Box sx={{ mx: 1.25, borderRadius: '16px', background: cardBg, py: 0.5 }}>
        {LANGUAGES.map((it) => {
          const on = sel === keyOf(it)
          return (
            <Box
              key={it.en}
              onClick={() => {
                setSel(keyOf(it))
                if (it.code) setLang(it.code)
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                px: 2,
                py: 1,
                mx: 0.5,
                borderRadius: '12px',
                cursor: 'pointer',
                '&:hover': { background: tg.hover },
              }}
            >
              <Radio on={on} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 16, color: tg.textPrimary }}>{it.en}</Typography>
                <Typography sx={{ fontSize: 13.5, color: tg.textSecondary }}>{it.native}</Typography>
              </Box>
            </Box>
          )
        })}
      </Box>
    </SettingsScreen>
  )
}
