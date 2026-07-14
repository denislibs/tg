import { useEffect, useRef, useState } from 'react'
import Text from '../../shared/ui/Text'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import IconButton from '../../shared/ui/IconButton'
import classNames from '../../shared/lib/classNames'
import { EASE, DUR } from '../../motion'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import QrCode from './QrCode'
import s from './AuthFlow.module.scss'

const MotionIconButton = motion.create(IconButton)

type Step = 'phone' | 'qr' | 'code'

interface Country {
  name: string
  code: string
  flag: string
  // National-number digit grouping (mask). Sum of the groups is the max length.
  pattern: number[]
}

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

// Group raw digits per the country mask (e.g. RU 9990000001 → "999 000 00 01"),
// truncating anything past the mask's total length.
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

/** Canonical Telegram plane, authored for a 240×240 circle so it reads centered. */
function TgPlane({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 240 240" aria-hidden>
      <path
        fill="#fff"
        d="M50.9,120.9l132-50.9c6.1-2.2,11.5,1.5,9.5,10.8l-22.5,106c-1.6,7.6-6.2,9.4-12.5,5.9l-34.6-25.5
           -16.7,16.1c-1.8,1.8-3.4,3.4-7,3.4l2.5-35.7,64.9-58.6c2.8-2.5-0.6-3.9-4.4-1.4l-80.2,50.5-34.6-10.8
           c-7.5-2.4-7.6-7.5,1.6-11.1z"
      />
    </svg>
  )
}

export default function AuthFlow({ onComplete }: { onComplete: () => void }) {
  const t = useT()

  const managers = useManagers()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [step, setStep] = useState<Step>('phone')
  const [dir, setDir] = useState(1) // 1 forward, -1 back
  const go = (next: Step, d: number) => {
    setDir(d)
    setStep(next)
  }

  // phone step
  const [country, setCountry] = useState<Country>(COUNTRIES[0])
  const [countryOpen, setCountryOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [keep, setKeep] = useState(true)
  const phoneDigits = phone.replace(/\D/g, '')
  const fullPhone = `${country.code}${phoneDigits}`

  // code step
  const [code, setCode] = useState<string[]>(Array(CODE_LEN).fill(''))
  const codeRefs = useRef<(HTMLInputElement | null)[]>([])
  const codeStr = code.join('')

  // qr step — generate + auto-rotate (30s) + poll (2s) for confirmation
  const [qrUrl, setQrUrl] = useState('')
  const [qrError, setQrError] = useState(false)
  const qrTokenRef = useRef<string>('')

  useEffect(() => {
    if (step !== 'qr') return
    let alive = true
    let rotate: ReturnType<typeof setInterval> | null = null
    let poll: ReturnType<typeof setInterval> | null = null

    const regen = async () => {
      try {
        const { token } = await managers.auth.qrNew('web')
        if (!alive) return
        qrTokenRef.current = token
        // Build the scan URL client-side from the real origin. The backend's
        // `url` is derived from proxy Host headers and can lose the port
        // (e.g. behind nginx → "http://localhost/qr/..."), so don't trust it.
        setQrUrl(`${location.origin}/qr/${token}`)
        setQrError(false)
      } catch {
        if (alive) setQrError(true)
      }
    }
    const tick = async () => {
      const token = qrTokenRef.current
      if (!token) return
      try {
        const r = await managers.auth.qrStatus(token)
        if (!alive) return
        if (r.status === 'confirmed') {
          cleanup()
          onComplete() // token already stored by qrStatus
        } else if (r.status === 'expired') {
          void regen() // rotate to a fresh code
        }
      } catch { /* transient; keep polling */ }
    }
    const cleanup = () => {
      alive = false
      if (rotate) clearInterval(rotate)
      if (poll) clearInterval(poll)
    }

    void regen()
    rotate = setInterval(() => void regen(), 30_000)
    poll = setInterval(() => void tick(), 2_000)
    return cleanup
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const submitCode = async (value: string) => {
    if (busy) return
    setError(''); setBusy(true)
    try {
      await managers.auth.signIn(fullPhone, value, 'web', 'browser')
      onComplete()
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
      assembled = next.join('') // capture the complete code synchronously
      return next
    })
    if (d && i < CODE_LEN - 1) codeRefs.current[i + 1]?.focus()
    if (d && i === CODE_LEN - 1) {
      // all entered → sign in (no 2FA on the backend)
      setTimeout(() => submitCode(assembled), 120)
    }
  }
  const onCodeKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) codeRefs.current[i - 1]?.focus()
  }

  const Logo = (
    <div className={s.logo}>
      <TgPlane />
    </div>
  )

  // ---- step contents ----
  const phoneStep = (
    <>
      {Logo}
      <Text size={26} weight={600} color="var(--tg-textPrimary)" style={{ textAlign: 'center' }}>
        Telegram
      </Text>
      <Text
        size={15} color="var(--tg-textSecondary)"
        style={{ textAlign: 'center', marginTop: '8px', marginBottom: '24px', lineHeight: 1.5 }}
      >
        {t('Please confirm your country code and enter your phone number.')}
      </Text>

      {/* country selector */}
      <div className={s.countryWrap}>
        <div
          onClick={() => setCountryOpen((o) => !o)}
          className={classNames(s.fieldWrap, s.countrySelect)}
        >
          <div className={s.countryLabel}>
            <span className={s.flag}>{country.flag}</span>
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
              className={s.dropdown}
            >
              {COUNTRIES.map((c) => (
                <div
                  key={c.name}
                  onClick={() => {
                    setCountry(c)
                    setPhone((prev) => formatPhone(prev.replace(/\D/g, ''), c.pattern))
                    setCountryOpen(false)
                  }}
                  className={s.dropdownItem}
                >
                  <span className={s.flagSmall}>{c.flag}</span>
                  <Text size={15} color="var(--tg-textPrimary)" style={{ flex: 1 }}>{c.name}</Text>
                  <Text size={15} color="var(--tg-textFaint)">{c.code}</Text>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* phone field */}
      <div className={s.fieldWrap}>
        <Text size={16} color="var(--tg-textPrimary)" style={{ marginRight: '8px' }}>{country.code}</Text>
        <input
          autoFocus
          className={s.phoneInput}
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value.replace(/\D/g, ''), country.pattern))}
          placeholder={t('Phone number')}
          inputMode="tel"
        />
      </div>

      {/* keep signed in */}
      <div onClick={() => setKeep((k) => !k)} className={s.keepRow}>
        <div className={classNames(s.keepBox, keep ? s.keepBoxOn : '')}>
          {keep && <TgIcon name="check" size={16} color="#fff" />}
        </div>
        <Text size={15} color="var(--tg-textPrimary)">{t('Keep me signed in')}</Text>
      </div>

      <div
        className={classNames(s.accentBtn, phoneDigits.length >= 7 ? '' : s.accentBtnDisabled)}
        onClick={async () => {
          if (busy) return
          setError(''); setBusy(true)
          try {
            await managers.auth.requestCode(fullPhone)
            setCode(Array(CODE_LEN).fill(''))
            go('code', 1)
          } catch {
            setError(t('Could not send the code. Try again.'))
          } finally { setBusy(false) }
        }}
      >
        {t('Next')}
      </div>

      {error && <Text size={13} color="#e53935" style={{ textAlign: 'center', marginTop: '12px' }}>{error}</Text>}

      <div onClick={() => go('qr', 1)} className={s.linkBtn}>
        {t('Log in by QR Code')}
      </div>
    </>
  )

  const qrStep = (
    <>
      <Text size={24} weight={600} color="var(--tg-textPrimary)" style={{ textAlign: 'center', marginBottom: '24px' }}>
        {t('Log in to Telegram by QR Code')}
      </Text>

      <div className={s.qrCard}>
        {qrUrl && !qrError ? (
          <QrCode data={qrUrl} size={220} color="#000" />
        ) : (
          <div className={s.qrFallback}>
            <Text size={14.5} color="#999">
              {qrError ? t('QR недоступен') : t('Обновление…')}
            </Text>
          </div>
        )}

        {/* center logo overlay */}
        {qrUrl && !qrError && (
          <div className={s.qrLogo}>
            <TgPlane size={30} />
          </div>
        )}
      </div>

      <div className={s.qrSteps}>
        {[
          t('Open Telegram on your phone'),
          t('Go to Settings → Devices → Link Desktop Device'),
          t('Point your phone at this screen to confirm login'),
        ].map((line, i) => (
          <div key={i} className={s.qrStepRow}>
            <div className={s.qrStepNum}>{i + 1}</div>
            <Text size={14.5} color="var(--tg-textSecondary)">{line}</Text>
          </div>
        ))}
      </div>

      <div onClick={() => go('phone', -1)} className={classNames(s.linkBtn, s.linkQr)}>
        {t('Log in by phone Number')}
      </div>
    </>
  )

  const codeStep = (
    <>
      {Logo}
      <Text size={22} weight={600} color="var(--tg-textPrimary)" style={{ textAlign: 'center' }}>
        {country.code} {phone}
      </Text>
      <Text
        size={15} color="var(--tg-textSecondary)"
        style={{ textAlign: 'center', marginTop: '8px', marginBottom: '24px', lineHeight: 1.5 }}
      >
        {t('We have sent you a message with the code.')}
      </Text>

      <div className={s.codeRow}>
        {code.map((d, i) => (
          <input
            key={i}
            ref={(el) => { codeRefs.current[i] = el }}
            className={classNames(s.codeCell, d ? s.codeCellFilled : '')}
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
        className={classNames(s.accentBtn, codeStr.length === CODE_LEN ? '' : s.accentBtnDisabled)}
        onClick={() => submitCode(codeStr)}
      >
        {t('Next')}
      </div>
    </>
  )

  const content = step === 'phone' ? phoneStep : step === 'qr' ? qrStep : codeStep

  return (
    <div className={s.overlay}>
      {/* back arrow (not on first step) */}
      <AnimatePresence>
        {step !== 'phone' && (
          <MotionIconButton
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => go('phone', -1)}
            color="var(--tg-textSecondary)"
            className={s.back}
          >
            <TgIcon name="back" />
          </MotionIconButton>
        )}
      </AnimatePresence>

      <div className={s.card}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: dir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -40 }}
            transition={{ duration: DUR.fast, ease: EASE }}
          >
            {content}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
