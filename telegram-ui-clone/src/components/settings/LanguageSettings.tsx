import { useState } from 'react'
import Text from '../../shared/ui/Text'
import { useLang, LANGS, type Lang } from '../../i18n'
import { SettingsScreen, Section, Row } from './kit'
import s from './LanguageSettings.module.scss'

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
  return (
    <div className={s.radio} data-on={on || undefined}>
      {on && <div className={s.radioDot} />}
    </div>
  )
}

export default function LanguageSettings({ onBack }: { onBack: () => void }) {
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
        <div className={s.disabled}>
          <Row label="Translate Entire Chats" toggle checked={false} />
        </div>
        <Row label="Do Not Translate" value={currentNative} onClick={() => {}} />
      </Section>

      {/* language list */}
      <Section>
        {LANGUAGES.map((it) => {
          const on = sel === keyOf(it)
          return (
            <div
              key={it.en}
              className={s.langRow}
              onClick={() => {
                setSel(keyOf(it))
                if (it.code) setLang(it.code)
              }}
            >
              <Radio on={on} />
              <div className={s.langBody}>
                <Text size={16} color="var(--tg-textPrimary)">{it.en}</Text>
                <Text size={13.5} color="var(--tg-textSecondary)">{it.native}</Text>
              </div>
            </div>
          )
        })}
      </Section>
    </SettingsScreen>
  )
}
