// AuthCodeCard — ввод кода подтверждения (порт карточки tweb
// `pages/cards/AuthCodeCard.tsx`): обезьянка следит за вводом, поле-ячейки
// (CodeInput), строка ошибки с зарезервированной высотой.
//
// Кнопки «Далее» на этой карточке в tweb НЕТ: код уходит на сервер, как только
// набрана последняя цифра (`onFill`).
//
// «Назад» к вводу номера в tweb делает НЕ угловая кнопка, а карандаш рядом с
// номером в шапке карточки (`.phoneEdit` → navigate('signIn')) — он и здесь.
import { useState } from 'react'
import TgIcon from '../../TgIcon'
import classNames from '../../../shared/lib/classNames'
import { useT } from '../../../i18n'
import { useManagers } from '../../../core/hooks/useManagers'
import TrackingMonkey from '../../TrackingMonkey'
import MediaHeader from '../MediaHeader'
import CodeInput from '../CodeInput'
import superFormatter from '../superFormatter'
import s from '../AuthFlow.module.scss'

export interface AuthCodeCardProps {
  /** номер для шапки карточки — в том виде, в каком его набрал пользователь */
  phone: string
  /** полный номер для `auth.signIn` */
  fullPhone: string
  /** длина кода */
  length: number
  /** карандаш у номера → назад на карточку ввода номера */
  onEditPhone: () => void
  /** сервер потребовал облачный пароль (SESSION_PASSWORD_NEEDED) */
  onPasswordNeeded: (token: string, hint: string) => void
  /** номер подтверждён, аккаунта нет — шаг регистрации (auth.authorizationSignUpRequired) */
  onSignUpRequired: (token: string) => void
  /** вход завершён */
  onComplete: () => void
}

// tweb mediaSizes.isMobile ? 100 : 130
const STICKER_SIZE = 130

export default function AuthCodeCard({
  phone,
  fullPhone,
  length,
  onEditPhone,
  onPasswordNeeded,
  onSignUpRequired,
  onComplete,
}: AuthCodeCardProps) {
  const t = useT()
  const managers = useManagers()

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [codeValue, setCodeValue] = useState('')
  // фокус поля — для обезьянки (tweb monkeys/tracking вешает focus/blur на input)
  const [codeFocused, setCodeFocused] = useState(false)

  const submitCode = async (value: string) => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const res = await managers.auth.signIn(fullPhone, value, 'web', 'browser')
      if (res.passwordNeeded) {
        onPasswordNeeded(res.passwordToken, res.hint)
        return
      }
      if (res.signUpRequired) {
        onSignUpRequired(res.signUpToken)
        return
      }
      onComplete()
    } catch {
      setError(t('PHONE_CODE_INVALID'))
      setCodeValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={classNames(s.card, s.pageAuthCode)}>
      <MediaHeader>
        <MediaHeader.Sticker size={STICKER_SIZE}>
          {/* tweb: `._sticker > stickerHost > .media-sticker-wrapper` —
              stickerHost переживает смену типа кода (обезьянка ↔ jolly_roger) */}
          <div>
            <TrackingMonkey
              typed={codeValue.length}
              length={length}
              focused={codeFocused}
              size={STICKER_SIZE}
            />
          </div>
        </MediaHeader.Sticker>
        <MediaHeader.Title>
          <div className={s.phoneWrapper}>
            <h4 className={s.phone}>{phone}</h4>
            {/* tweb .phoneEdit: правка номера — единственный путь назад отсюда */}
            <span className={s.phoneEdit} onClick={onEditPhone} role="button" aria-label={t('Edit')}>
              <TgIcon name="edit" size="1.5rem" />
            </span>
          </div>
        </MediaHeader.Title>
        <MediaHeader.Subtitle secondary>
          {/* перевод строки в словаре — <br> (tweb Login.Code.SentSms) */}
          <span className="i18n">{superFormatter(t('Login.Code.SentSms'))}</span>
        </MediaHeader.Subtitle>
      </MediaHeader>

      <CodeInput
        className={s.codeInputField}
        length={length}
        value={codeValue}
        onChange={(v) => {
          setError('')
          setCodeValue(v)
        }}
        onComplete={(v) => void submitCode(v)}
        error={!!error}
        disabled={busy}
        onFocusChange={setCodeFocused}
      />

      {/* высота зарезервирована всегда — появление ошибки не двигает раскладку
          (tweb .errorLabel height: 1lh) */}
      <div className={s.errorLabel}>{error}</div>
    </div>
  )
}
