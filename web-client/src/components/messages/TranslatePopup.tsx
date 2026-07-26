// Попап перевода сообщения — порт tweb popups/translate.tsx: одна карточка с
// двумя секциями (оригинал «С: <язык>» / перевод «На <язык>» + копирование),
// разделитель между ними, снизу кнопка «ОК». Перевод берётся с бэка
// (LibreTranslate) через managers.messages.translate; целевой язык — пилюля-select.
import { useEffect, useState } from 'react'
import Popup from '../../shared/ui/Popup'
import Text from '../../shared/ui/Text'
import Spinner from '../../shared/ui/Spinner'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { useSettings } from '../../settings'
import type { Managers } from '../../client/bootstrap'
import s from './TranslatePopup.module.scss'

// Целевые языки — набор, поднятый в LibreTranslate (LT_LOAD_ONLY).
const TARGETS: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'uk', name: 'Українська' },
]
const NAMES: Record<string, string> = Object.fromEntries(TARGETS.map((l) => [l.code, l.name]))
const langName = (code: string) => NAMES[code] || (code ? code.toUpperCase() : '')

export default function TranslatePopup({
  open, onClose, onExitComplete, text, managers,
}: {
  open: boolean
  onClose: () => void
  onExitComplete?: () => void
  text: string
  managers: Managers
}) {
  const t = useT()
  const { translateTo } = useSettings()
  const [lang, setLang] = useState(translateTo || 'ru')
  const [result, setResult] = useState<string | null>(null)
  const [source, setSource] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open || !text) return
    let alive = true
    setResult(null)
    setError(null)
    managers.messages
      .translate(text, lang)
      .then((r) => { if (alive) { setResult(r.text); setSource(r.source) } })
      .catch(() => { if (alive) setError(t('Translation failed')) })
    return () => { alive = false }
  }, [open, text, lang, managers, t])

  const copy = () => {
    if (!result) return
    void navigator.clipboard?.writeText(result).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <Popup
      open={open}
      title={t('Translate')}
      onClose={onClose}
      onExitComplete={onExitComplete}
      width={440}
      action={{ label: t('OK'), onClick: onClose }}
    >
      <div className={s.card}>
        {/* Оригинал */}
        <div className={s.section}>
          <Text size={16} weight={600} color="var(--tg-textPrimary)">
            {t('From language')}: {langName(source) || '…'}
          </Text>
          <Text size={16} color="var(--tg-textPrimary)" className={s.body}>{text}</Text>
        </div>

        <div className={s.divider} />

        {/* Перевод */}
        <div className={s.section}>
          <div className={s.targetRow}>
            <Text size={16} weight={600} color="var(--tg-textPrimary)">{t('To language')}</Text>
            <span className={s.pill}>
              {langName(lang)}
              <select className={s.pillSelect} value={lang} onChange={(e) => setLang(e.target.value)}>
                {TARGETS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </span>
            <button className={s.copyBtn} onClick={copy} title={t('Copy')} disabled={!result}>
              <TgIcon name={copied ? 'check' : 'copy'} size={20} color="var(--tg-accent)" />
            </button>
          </div>
          {error ? (
            <Text size={16} color="var(--tg-dangerText)" className={s.body}>{error}</Text>
          ) : result == null ? (
            <div className={s.loading}><Spinner size={22} /></div>
          ) : (
            <Text size={16} color="var(--tg-textPrimary)" className={s.body}>{result}</Text>
          )}
        </div>
      </div>
    </Popup>
  )
}
