// AuthCodeCard — ввод кода подтверждения (порт карточки tweb
// `pages/cards/AuthCodeCard.tsx`): обезьянка следит за вводом, поле-ячейки
// (CodeInput), строка ошибки с зарезервированной высотой.
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
import { PrimaryButton } from '../AuthButton'
import CodeInput from '../CodeInput'
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
  /** вход завершён */
  onComplete: () => void
}

export default function AuthCodeCard({
  phone,
  fullPhone,
  length,
  onEditPhone,
  onPasswordNeeded,
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
      onComplete()
    } catch {
      setError(t('Invalid code'))
      setCodeValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={classNames(s.card, s.pageAuthCode)}>
      <MediaHeader>
        <MediaHeader.Sticker size={130}>
          <TrackingMonkey typed={codeValue.length} length={length} focused={codeFocused} size={130} />
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
          <span className="i18n">{t('We have sent you a message with the code.')}</span>
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
        onFocusChange={setCodeFocused}
      />

      {/* высота зарезервирована всегда — появление ошибки не двигает раскладку
          (tweb .errorLabel height: 1lh) */}
      <div className={s.errorLabel}>{error}</div>

      <PrimaryButton disabled={codeValue.length !== length} onClick={() => void submitCode(codeValue)}>
        {t('Next')}
      </PrimaryButton>
    </div>
  )
}
