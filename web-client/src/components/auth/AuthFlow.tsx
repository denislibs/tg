import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Text from '../../shared/ui/Text'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import IconButton from '../../shared/ui/IconButton'
import classNames from '../../shared/lib/classNames'
import { EASE, DUR } from '../../motion'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import QrCode from './QrCode'
import PasswordMonkey from '../PasswordMonkey'
import TrackingMonkey from '../TrackingMonkey'
import CountryInput from './CountryInput'
import CodeInput from './CodeInput'
import { COUNTRIES, countryByPhone, type Country } from './countries'
import { isWebAuthnSupported, getPasskeyAssertion } from '../../core/webauthnBrowser'
import { ANIMATE_AUTH_KEY, ANIMATE_MAIN_KEY, PREV_ACCOUNT_KEY, playAuthHostEnter, playAuthHostExit } from '../../core/accountTransition'
import ChatBackground from '../ChatBackgroundLazy'
import type { ToggleMode } from '../../App'
import s from './AuthFlow.module.scss'

const MotionIconButton = motion.create(IconButton)

type Step = 'phone' | 'qr' | 'code' | 'password'

// Group raw digits per the country mask (e.g. RU 9990000001 → "999 000 00 01"),
// truncating anything past the mask's total length. Без маски (у страны нет
// pattern в tweb-данных) цифры остаются как есть.
const maxDigits = (p: number[]) => p.reduce((a, b) => a + b, 0)
function formatPhone(digits: string, pattern?: number[]): string {
  if (!pattern) return digits
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

export default function AuthFlow({ onComplete, onToggleMode }: { onComplete: () => void; onToggleMode?: ToggleMode }) {
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

  // Добавление аккаунта из меню (tweb AuthCardsHost): экран входа въезжает
  // справа (hostEnter), а на первом шаге появляется стрелка возврата к
  // прежнему аккаунту (tweb showBackButton при getCurrentAccount()!==1).
  const overlayRef = useRef<HTMLDivElement>(null)
  const [prevAccount] = useState<number | null>(() => {
    const v = localStorage.getItem(PREV_ACCOUNT_KEY)
    return v ? Number(v) : null
  })
  useLayoutEffect(() => {
    if (localStorage.getItem(ANIMATE_AUTH_KEY)) {
      localStorage.removeItem(ANIMATE_AUTH_KEY)
      playAuthHostEnter(overlayRef.current)
    }
  }, [])
  // Возврат к прежнему аккаунту: hostExit → смена активного токена → reload,
  // после которого мессенджер въезжает scale-enter (флаг ANIMATE_MAIN).
  const backToAccount = async () => {
    if (prevAccount == null) return
    localStorage.setItem(ANIMATE_MAIN_KEY, '1')
    localStorage.removeItem(PREV_ACCOUNT_KEY)
    await playAuthHostExit(overlayRef.current)
    await managers.auth.switchAccount(prevAccount)
    location.reload()
  }

  // phone step
  const [country, setCountry] = useState<Country>(() => COUNTRIES.find((c) => c.iso2 === 'RU')!)
  const [phone, setPhone] = useState('')
  const [keep, setKeep] = useState(true)
  const phoneDigits = phone.replace(/\D/g, '')
  const fullPhone = `${country.code}${phoneDigits}`

  // Ввод в поле телефона. Если начали с «+» — набирается международный код:
  // автоопределяем страну по самому длинному совпадению (tweb telInputField /
  // formatPhoneNumber), после чего в поле остаётся национальная часть.
  const onPhoneInput = (raw: string) => {
    if (raw.trimStart().startsWith('+')) {
      const digits = raw.replace(/\D/g, '')
      const detected = countryByPhone(digits)
      if (detected) {
        setCountry(detected)
        setPhone(formatPhone(digits.slice(detected.code.length - 1), detected.pattern))
      } else {
        setPhone(raw) // код ещё не набран целиком
      }
      return
    }
    setPhone(formatPhone(raw.replace(/\D/g, ''), country.pattern))
  }

  // code step — единое значение CodeInput (tweb codeInputField)
  const [codeValue, setCodeValue] = useState('')
  // фокус поля кода — для обезьянки (tweb monkeys/tracking: focus/blur input)
  const [codeFocused, setCodeFocused] = useState(false)

  // password step (облачный пароль, 2FA): одноразовый токен из sign_in
  const [pwToken, setPwToken] = useState('')
  const [pwHint, setPwHint] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  // Вход по ключу доступа (WebAuthn discoverable credential): без телефона.
  const passkeyLogin = async () => {
    if (busy) return
    setError(''); setBusy(true)
    try {
      const { session, options } = await managers.auth.passkeyLoginBegin()
      const assertion = await getPasskeyAssertion(options)
      await managers.auth.passkeyLoginFinish(session, assertion, 'web', 'browser')
      onComplete()
    } catch {
      setError(t('Passkey sign-in failed'))
    } finally { setBusy(false) }
  }

  const submitPassword = async () => {
    if (busy || !password) return
    setError(''); setBusy(true)
    try {
      await managers.auth.checkPassword(pwToken, password, 'web', 'browser')
      onComplete()
    } catch {
      setError(t('Invalid password'))
    } finally { setBusy(false) }
  }

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
      const res = await managers.auth.signIn(fullPhone, value, 'web', 'browser')
      // Включён облачный пароль — второй шаг входа (SESSION_PASSWORD_NEEDED)
      if (res.passwordNeeded) {
        setPwToken(res.passwordToken)
        setPwHint(res.hint)
        setPassword('')
        setShowPw(false)
        go('password', 1)
        return
      }
      onComplete()
    } catch {
      setError(t('Invalid code'))
      setCodeValue('')
    } finally { setBusy(false) }
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
      {/* tweb SignInCard: заголовок «Sign in to Telegram» */}
      <Text size={26} weight={600} color="var(--primary-text-color)" style={{ textAlign: 'center' }}>
        {t('Sign in to Telegram')}
      </Text>
      <Text
        size={15} color="var(--secondary-text-color)"
        style={{ textAlign: 'center', marginTop: '8px', marginBottom: '24px', lineHeight: 1.5 }}
      >
        {t('Please confirm your country code and enter your phone number.')}
      </Text>

      {/* country selector — полный список tweb countryInputField */}
      <CountryInput
        value={country}
        onChange={(c) => {
          setCountry(c)
          setPhone((prev) => formatPhone(prev.replace(/\D/g, ''), c.pattern))
        }}
      />

      {/* phone field: лейбл всегда на рамке — в поле всегда есть код страны
          (tweb .input-field-phone + плавающий label «Phone Number») */}
      <div className={s.fieldWrap}>
        <label className={s.fieldLabel}>{t('Phone Number')}</label>
        <Text size={16} color="var(--primary-text-color)" style={{ marginRight: '8px' }}>{country.code}</Text>
        <input
          autoFocus
          className={s.phoneInput}
          value={phone}
          onChange={(e) => onPhoneInput(e.target.value)}
          inputMode="tel"
        />
      </div>

      {/* keep signed in */}
      <div onClick={() => setKeep((k) => !k)} className={s.keepRow}>
        <div className={classNames(s.keepBox, keep ? s.keepBoxOn : '')}>
          {keep && <TgIcon name="check" size={16} color="#fff" />}
        </div>
        <Text size={15} color="var(--primary-text-color)">{t('Keep me signed in')}</Text>
      </div>

      <div
        className={classNames(s.accentBtn, phoneDigits.length >= 7 ? '' : s.accentBtnDisabled)}
        onClick={async () => {
          if (busy) return
          setError(''); setBusy(true)
          try {
            await managers.auth.requestCode(fullPhone)
            setCodeValue('')
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
      {isWebAuthnSupported() && (
        <div onClick={() => void passkeyLogin()} className={s.linkBtn}>
          {t('Log in with a Passkey')}
        </div>
      )}
    </>
  )

  const qrStep = (
    <>
      <Text size={24} weight={600} color="var(--primary-text-color)" style={{ textAlign: 'center', marginBottom: '24px' }}>
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
            <Text size={14.5} color="var(--secondary-text-color)">{line}</Text>
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
      {/* обезьянка следит за вводом кода (tweb monkeys/tracking) */}
      <TrackingMonkey typed={codeValue.length} length={CODE_LEN} focused={codeFocused} size={130} />
      <Text size={22} weight={600} color="var(--primary-text-color)" style={{ textAlign: 'center' }}>
        {country.code} {phone}
      </Text>
      <Text
        size={15} color="var(--secondary-text-color)"
        style={{ textAlign: 'center', marginTop: '8px', marginBottom: '24px', lineHeight: 1.5 }}
      >
        {t('We have sent you a message with the code.')}
      </Text>

      <CodeInput
        length={CODE_LEN}
        value={codeValue}
        onChange={(v) => { setError(''); setCodeValue(v) }}
        onComplete={(v) => void submitCode(v)}
        error={!!error}
        onFocusChange={setCodeFocused}
      />

      {/* резерв высоты под ошибку — layout не прыгает (tweb errorLabel 1lh) */}
      <div className={s.codeError}>{error}</div>

      <div
        className={classNames(s.accentBtn, codeValue.length === CODE_LEN ? '' : s.accentBtnDisabled)}
        onClick={() => submitCode(codeValue)}
      >
        {t('Next')}
      </div>
    </>
  )

  // Шаг облачного пароля (tweb pages/pagePassword: монки + поле с «глазком»)
  const passwordStep = (
    <>
      <PasswordMonkey peeking={showPw} />
      <Text size={22} weight={600} color="var(--primary-text-color)" style={{ textAlign: 'center', marginTop: '8px' }}>
        {t('Enter Your Password')}
      </Text>
      <Text
        size={15} color="var(--secondary-text-color)"
        style={{ textAlign: 'center', marginTop: '8px', marginBottom: '24px', lineHeight: 1.5 }}
      >
        {t('Your account is protected with an additional password.')}
      </Text>

      <div className={s.fieldWrap}>
        <input
          autoFocus
          className={s.phoneInput}
          type={showPw ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submitPassword() }}
          placeholder={pwHint ? `${t('Password')} (${pwHint})` : t('Password')}
        />
        <IconButton size="small" color="var(--secondary-text-color)" onClick={() => setShowPw((v) => !v)} aria-label="toggle password">
          <TgIcon name={showPw ? 'eye2' : 'eye1'} size={22} />
        </IconButton>
      </div>

      {error && <Text size={13} color="#e53935" style={{ textAlign: 'center', marginTop: '12px' }}>{error}</Text>}

      <div
        className={classNames(s.accentBtn, password ? '' : s.accentBtnDisabled)}
        onClick={() => void submitPassword()}
      >
        {t('Next')}
      </div>
    </>
  )

  const content =
    step === 'phone' ? phoneStep : step === 'qr' ? qrStep : step === 'password' ? passwordStep : codeStep

  return (
    <div ref={overlayRef} className={s.overlay}>
      {/* Обои — те же анимированные градиент+doodle, что и в чате (tweb: фон
          приложения виден и на экране входа) */}
      <ChatBackground />

      {/* Кнопки-кружки в углах (tweb .closeButton / .themeButton): слева —
          «назад» (внутренний шаг → телефон; первый шаг при добавлении аккаунта
          → возврат к прежнему), справа — переключатель темы (всегда). */}
      <AnimatePresence>
        {(step !== 'phone' || prevAccount != null) && (
          <MotionIconButton
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => (step !== 'phone' ? go('phone', -1) : void backToAccount())}
            color="#fff"
            className={classNames(s.cornerBtn, s.cornerBtnLeft)}
          >
            <TgIcon name="back" />
          </MotionIconButton>
        )}
      </AnimatePresence>
      {onToggleMode && (
        <IconButton
          onClick={(e) => onToggleMode({ x: e.clientX, y: e.clientY })}
          color="#fff"
          className={classNames(s.cornerBtn, s.cornerBtnRight)}
          aria-label={t('Dark Mode')}
        >
          <TgIcon name="darkmode" />
        </IconButton>
      )}

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
