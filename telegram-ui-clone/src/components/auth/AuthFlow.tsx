import { useEffect, useRef, useState } from 'react'
import { Box, InputBase, Typography, useTheme } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import IconButton from '../../shared/ui/IconButton'
import { EASE, DUR } from '../../motion'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import QrCode from './QrCode'

const MotionIconButton = motion(IconButton)

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
  const tg = useTheme().tg
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
  const onCodeKey = (i: number, e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) codeRefs.current[i - 1]?.focus()
  }

  const accentBtn = {
    height: 54,
    borderRadius: '12px',
    background: tg.accent,
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'filter .15s ease, opacity .15s ease',
    '&:hover': { filter: 'brightness(1.06)' },
  }

  const fieldWrap = {
    border: `1.5px solid ${tg.divider}`,
    borderRadius: '12px',
    px: 1.75,
    height: 54,
    display: 'flex',
    alignItems: 'center',
    transition: 'border-color .15s ease',
    '&:focus-within': { borderColor: tg.accent },
  }

  const Logo = (
    <Box
      sx={{
        width: 96,
        height: 96,
        borderRadius: '50%',
        background: tg.accentGradient,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        mx: 'auto',
        mb: 2.5,
        boxShadow: '0 8px 28px -8px rgba(0,0,0,0.4)',
      }}
    >
      <TgPlane />
    </Box>
  )

  // ---- step contents ----
  const phoneStep = (
    <>
      {Logo}
      <Typography sx={{ fontSize: 26, fontWeight: 600, textAlign: 'center', color: tg.textPrimary }}>
        Telegram
      </Typography>
      <Typography
        sx={{ fontSize: 15, textAlign: 'center', color: tg.textSecondary, mt: 1, mb: 3, lineHeight: 1.5 }}
      >
        {t('Please confirm your country code and enter your phone number.')}
      </Typography>

      {/* country selector */}
      <Box sx={{ position: 'relative', mb: 1.25 }}>
        <Box
          onClick={() => setCountryOpen((o) => !o)}
          sx={{ ...fieldWrap, cursor: 'pointer', justifyContent: 'space-between' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>{country.flag}</span>
            <Typography sx={{ fontSize: 16, color: tg.textPrimary }}>{country.name}</Typography>
          </Box>
          <TgIcon name="down" color={tg.textFaint} />
        </Box>
        <AnimatePresence>
          {countryOpen && (
            <Box
              component={motion.div}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: EASE }}
              sx={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: 0,
                right: 0,
                zIndex: 10,
                maxHeight: 240,
                overflowY: 'auto',
                background: tg.menuBg,
                backdropFilter: 'blur(40px)',
                WebkitBackdropFilter: 'blur(40px)',
                borderRadius: '12px',
                boxShadow: tg.menuShadow,
                py: 0.5,
              }}
            >
              {COUNTRIES.map((c) => (
                <Box
                  key={c.name}
                  onClick={() => {
                    setCountry(c)
                    setPhone((prev) => formatPhone(prev.replace(/\D/g, ''), c.pattern))
                    setCountryOpen(false)
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    px: 1.75,
                    py: 1,
                    cursor: 'pointer',
                    '&:hover': { background: tg.hover },
                  }}
                >
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{c.flag}</span>
                  <Typography sx={{ fontSize: 15, color: tg.textPrimary, flex: 1 }}>{c.name}</Typography>
                  <Typography sx={{ fontSize: 15, color: tg.textFaint }}>{c.code}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </AnimatePresence>
      </Box>

      {/* phone field */}
      <Box sx={fieldWrap}>
        <Typography sx={{ fontSize: 16, color: tg.textPrimary, mr: 1 }}>{country.code}</Typography>
        <InputBase
          autoFocus
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value.replace(/\D/g, ''), country.pattern))}
          placeholder={t('Phone number')}
          inputMode="tel"
          sx={{ flex: 1, fontSize: 16, color: tg.textPrimary, '& input::placeholder': { color: tg.textFaint, opacity: 1 } }}
        />
      </Box>

      {/* keep signed in */}
      <Box
        onClick={() => setKeep((k) => !k)}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 2, cursor: 'pointer', userSelect: 'none' }}
      >
        <Box
          sx={{
            width: 22,
            height: 22,
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: keep ? tg.accent : 'transparent',
            border: keep ? 'none' : `2px solid ${tg.textFaint}`,
            transition: 'background .15s ease',
          }}
        >
          {keep && <TgIcon name="check" size={16} color="#fff" />}
        </Box>
        <Typography sx={{ fontSize: 15, color: tg.textPrimary }}>{t('Keep me signed in')}</Typography>
      </Box>

      <Box
        sx={{ ...accentBtn, mt: 3, opacity: phoneDigits.length >= 7 ? 1 : 0.5, pointerEvents: phoneDigits.length >= 7 ? 'auto' : 'none' }}
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
      </Box>

      {error && <Typography sx={{ fontSize: 13, color: '#e53935', textAlign: 'center', mt: 1.5 }}>{error}</Typography>}

      <Typography
        onClick={() => go('qr', 1)}
        sx={{
          mt: 2.5,
          textAlign: 'center',
          fontSize: 14,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.3,
          color: tg.accent,
          cursor: 'pointer',
          '&:hover': { textDecoration: 'underline' },
        }}
      >
        {t('Log in by QR Code')}
      </Typography>
    </>
  )

  const qrStep = (
    <>
      <Typography sx={{ fontSize: 24, fontWeight: 600, textAlign: 'center', color: tg.textPrimary, mb: 3 }}>
        {t('Log in to Telegram by QR Code')}
      </Typography>

      <Box
        sx={{
          position: 'relative',
          width: 'fit-content',
          mx: 'auto',
          p: 2,
          borderRadius: '18px',
          background: '#fff',
        }}
      >
        {qrUrl && !qrError ? (
          <QrCode data={qrUrl} size={220} color="#000" />
        ) : (
          <Box
            sx={{
              width: 220,
              height: 220,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography sx={{ fontSize: 14.5, color: '#999' }}>
              {qrError ? t('QR недоступен') : t('Обновление…')}
            </Typography>
          </Box>
        )}

        {/* center logo overlay */}
        {qrUrl && !qrError && (
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: tg.accentGradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <TgPlane size={30} />
          </Box>
        )}
      </Box>

      <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 1.75 }}>
        {[
          t('Open Telegram on your phone'),
          t('Go to Settings → Devices → Link Desktop Device'),
          t('Point your phone at this screen to confirm login'),
        ].map((line, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 24,
                height: 24,
                flexShrink: 0,
                borderRadius: '50%',
                background: tg.accent,
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {i + 1}
            </Box>
            <Typography sx={{ fontSize: 14.5, color: tg.textSecondary }}>{line}</Typography>
          </Box>
        ))}
      </Box>

      <Typography
        onClick={() => go('phone', -1)}
        sx={{
          mt: 3,
          textAlign: 'center',
          fontSize: 14,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.3,
          color: tg.accent,
          cursor: 'pointer',
          '&:hover': { textDecoration: 'underline' },
        }}
      >
        {t('Log in by phone Number')}
      </Typography>
    </>
  )

  const codeStep = (
    <>
      {Logo}
      <Typography sx={{ fontSize: 22, fontWeight: 600, textAlign: 'center', color: tg.textPrimary }}>
        {country.code} {phone}
      </Typography>
      <Typography
        sx={{ fontSize: 15, textAlign: 'center', color: tg.textSecondary, mt: 1, mb: 3, lineHeight: 1.5 }}
      >
        {t('We have sent you a message with the code.')}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1.25, justifyContent: 'center' }}>
        {code.map((d, i) => (
          <InputBase
            key={i}
            inputRef={(el) => (codeRefs.current[i] = el)}
            value={d}
            autoFocus={i === 0}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onCodeKey(i, e)}
            inputProps={{ inputMode: 'numeric', maxLength: 1, style: { textAlign: 'center' } }}
            sx={{
              width: 48,
              height: 56,
              border: `1.5px solid ${d ? tg.accent : tg.divider}`,
              borderRadius: '12px',
              fontSize: 24,
              fontWeight: 600,
              color: tg.textPrimary,
              transition: 'border-color .15s ease',
              '&:focus-within': { borderColor: tg.accent },
            }}
          />
        ))}
      </Box>

      {error && <Typography sx={{ fontSize: 13, color: '#e53935', textAlign: 'center', mt: 1.5 }}>{error}</Typography>}

      <Box
        sx={{ ...accentBtn, mt: 3, opacity: codeStr.length === CODE_LEN ? 1 : 0.5, pointerEvents: codeStr.length === CODE_LEN ? 'auto' : 'none' }}
        onClick={() => submitCode(codeStr)}
      >
        {t('Next')}
      </Box>
    </>
  )

  const content = step === 'phone' ? phoneStep : step === 'qr' ? qrStep : codeStep

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 5000,
        background: tg.appBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflowY: 'auto',
        p: 2,
      }}
    >
      {/* back arrow (not on first step) */}
      <AnimatePresence>
        {step !== 'phone' && (
          <MotionIconButton
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => go('phone', -1)}
            color={tg.textSecondary}
            style={{ position: 'fixed', top: 20, left: 20 }}
          >
            <TgIcon name="back" />
          </MotionIconButton>
        )}
      </AnimatePresence>

      <Box sx={{ width: '100%', maxWidth: 360 }}>
        <AnimatePresence mode="wait" initial={false}>
          <Box
            key={step}
            component={motion.div}
            initial={{ opacity: 0, x: dir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -40 }}
            transition={{ duration: DUR.fast, ease: EASE }}
          >
            {content}
          </Box>
        </AnimatePresence>
      </Box>
    </Box>
  )
}
