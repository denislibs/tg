// ChangePhone — смена номера телефона (tweb Settings → Edit Profile → Change
// Number: страница ввода номера + страница кода, как при входе). Двухшаговый
// экран настроек: ввод нового номера → ввод кода подтверждения.
import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import { EASE, DUR } from '../../motion'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { SettingsScreen } from './kit'
import auth from '../auth/AuthFlow.module.scss'

interface Country {
  name: string
  code: string
  flag: string
  pattern: number[]
}

// Тот же набор, что на экране входа (AuthFlow) — держим локально, чтобы не
// расширять экспортную поверхность формы входа.
const COUNTRIES: Country[] = [
  { name: 'Russia', code: '+7', flag: '🇷🇺', pattern: [3, 3, 2, 2] },
  { name: 'Kazakhstan', code: '+7', flag: '🇰🇿', pattern: [3, 3, 2, 2] },
  { name: 'Ukraine', code: '+380', flag: '🇺🇦', pattern: [2, 3, 2, 2] },
  { name: 'United States', code: '+1', flag: '🇺🇸', pattern: [3, 3, 4] },
  { name: 'United Kingdom', code: '+44', flag: '🇬🇧', pattern: [4, 6] },
  { name: 'Germany', code: '+49', flag: '🇩🇪', pattern: [3, 4, 4] },
  { name: 'France', code: '+33', flag: '🇫🇷', pattern: [1, 2, 2, 2, 2] },
  { name: 'Spain', code: '+34', flag: '🇪🇸', pattern: [3, 3, 3] },
]

const maxDigits = (p: number[]) => p.reduce((a, b) => a + b, 0)
function formatPhone(digits: string, pattern: number[]): string {
  const d = digits.slice(0, maxDigits(pattern))
  const groups: string[] = []
  let i = 0
  for (const g of pattern) {
    if (i >= d.length) break
    groups.push(d.slice(i, i + g))
    i += g
  }
  return groups.join(' ')
}

const CODE_LEN = 5

export default function ChangePhone({ onBack }: { onBack: () => void }) {
  const t = useT()
  const managers = useManagers()
  const setMe = useChatsStore((s) => s.setMe)

  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [dir, setDir] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // phone step
  const [country, setCountry] = useState<Country>(COUNTRIES[0])
  const [countryOpen, setCountryOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const phoneDigits = phone.replace(/\D/g, '')
  const fullPhone = `${country.code}${phoneDigits}`

  // code step
  const [code, setCode] = useState<string[]>(Array(CODE_LEN).fill(''))
  const codeRefs = useRef<(HTMLInputElement | null)[]>([])
  const codeStr = code.join('')

  const submitPhone = async () => {
    if (busy || phoneDigits.length < 7) return
    setError(''); setBusy(true)
    try {
      const res = await managers.auth.changePhone(fullPhone)
      if ('taken' in res) { setError(t('This number is already connected to a Telegram account.')); return }
      if ('invalid' in res) { setError(t('Invalid phone number.')); return }
      setCode(Array(CODE_LEN).fill(''))
      setDir(1); setStep('code')
    } catch {
      setError(t('Could not send the code. Try again.'))
    } finally { setBusy(false) }
  }

  const submitCode = async (value: string) => {
    if (busy) return
    setError(''); setBusy(true)
    try {
      const res = await managers.auth.confirmChangePhone(fullPhone, value)
      if ('user' in res) {
        setMe(res.user)
        onBack()
        return
      }
      if ('taken' in res) setError(t('This number is already connected to a Telegram account.'))
      else if ('invalid' in res) setError(t('Invalid phone number.'))
      else setError(t('Invalid code'))
      setCode(Array(CODE_LEN).fill(''))
      codeRefs.current[0]?.focus()
    } catch {
      setError(t('Invalid code'))
      setCode(Array(CODE_LEN).fill(''))
      codeRefs.current[0]?.focus()
    } finally { setBusy(false) }
  }

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1)
    let assembled = ''
    setCode((prev) => {
      const next = [...prev]
      next[i] = d
      assembled = next.join('')
      return next
    })
    if (d && i < CODE_LEN - 1) codeRefs.current[i + 1]?.focus()
    if (d && i === CODE_LEN - 1) setTimeout(() => void submitCode(assembled), 120)
  }
  const onCodeKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) codeRefs.current[i - 1]?.focus()
  }

  const phoneStep = (
    <div className={auth.card} style={{ margin: '0 auto', boxShadow: 'none' }}>
      <Text
        size={15} color="var(--tg-textSecondary)"
        style={{ textAlign: 'center', marginBottom: '24px', lineHeight: 1.5 }}
      >
        {t('Please confirm your country code and enter your new phone number.')}
      </Text>

      <div className={auth.countryWrap}>
        <div
          onClick={() => setCountryOpen((o) => !o)}
          className={classNames(auth.fieldWrap, auth.countrySelect)}
        >
          <div className={auth.countryLabel}>
            <span className={auth.flag}>{country.flag}</span>
            <Text size={16} color="var(--tg-textPrimary)">{country.name}</Text>
          </div>
          <TgIcon name="down" color="var(--tg-textFaint)" />
        </div>
        <AnimatePresence>
          {countryOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: EASE }}
              className={auth.dropdown}
            >
              {COUNTRIES.map((c) => (
                <div
                  key={c.name}
                  onClick={() => {
                    setCountry(c)
                    setPhone((prev) => formatPhone(prev.replace(/\D/g, ''), c.pattern))
                    setCountryOpen(false)
                  }}
                  className={auth.dropdownItem}
                >
                  <span className={auth.flagSmall}>{c.flag}</span>
                  <Text size={15} color="var(--tg-textPrimary)" style={{ flex: 1 }}>{c.name}</Text>
                  <Text size={15} color="var(--tg-textFaint)">{c.code}</Text>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={auth.fieldWrap}>
        <Text size={16} color="var(--tg-textPrimary)" style={{ marginRight: '8px' }}>{country.code}</Text>
        <input
          autoFocus
          className={auth.phoneInput}
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value.replace(/\D/g, ''), country.pattern))}
          placeholder={t('Phone number')}
          inputMode="tel"
        />
      </div>

      <div
        className={classNames(auth.accentBtn, phoneDigits.length >= 7 ? '' : auth.accentBtnDisabled)}
        onClick={() => void submitPhone()}
      >
        {t('Next')}
      </div>

      {error && <Text size={13} color="#e53935" style={{ textAlign: 'center', marginTop: '12px' }}>{error}</Text>}
    </div>
  )

  const codeStep = (
    <div className={auth.card} style={{ margin: '0 auto', boxShadow: 'none' }}>
      <Text size={22} weight={600} color="var(--tg-textPrimary)" style={{ textAlign: 'center' }}>
        {country.code} {phone}
      </Text>
      <Text
        size={15} color="var(--tg-textSecondary)"
        style={{ textAlign: 'center', marginTop: '8px', marginBottom: '24px', lineHeight: 1.5 }}
      >
        {t('We have sent you a message with the code.')}
      </Text>

      <div className={auth.codeRow}>
        {code.map((d, i) => (
          <input
            key={i}
            ref={(el) => { codeRefs.current[i] = el }}
            className={classNames(auth.codeCell, d ? auth.codeCellFilled : '')}
            value={d}
            autoFocus={i === 0}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onCodeKey(i, e)}
            inputMode="numeric"
            maxLength={1}
          />
        ))}
      </div>

      {error && <Text size={13} color="#e53935" style={{ textAlign: 'center', marginTop: '12px' }}>{error}</Text>}

      <div
        className={classNames(auth.accentBtn, codeStr.length === CODE_LEN ? '' : auth.accentBtnDisabled)}
        onClick={() => void submitCode(codeStr)}
      >
        {t('Next')}
      </div>
    </div>
  )

  return (
    <SettingsScreen title="Change Number" onBack={onBack} zIndex={60}>
      <div style={{ padding: '24px 16px' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: dir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -40 }}
            transition={{ duration: DUR.fast, ease: EASE }}
          >
            {step === 'phone' ? phoneStep : codeStep}
          </motion.div>
        </AnimatePresence>
      </div>
    </SettingsScreen>
  )
}
