// EmailRecoverCard — восстановление доступа кодом с привязанной почты (порт
// карточки tweb `pages/cards/EmailRecoverCard.tsx`). Сюда ведёт ссылка
// «Forgot Password?» с карточки облачного пароля.
//
// Дерево 1:1 с живым tweb (dom-референс §2.6):
//
//   div.card                                    ← БЕЗ page-модификатора (его нет и в scss tweb)
//     div
//       div.sticker[--sticker-size: 130px] > div.lottie[--size] > canvas.lottie
//       div.title.text-center.text-overflow-wrap > span.i18n
//       div.subtitle.text-center > span.i18n > br + b > span.bluff-spoiler…
//     div.input-wrapper
//       div.wrap (поле кода — ШЕСТЬ ячеек и ВНУТРИ input-wrapper, БЕЗ .codeInputField)
//       div.errorLabel
//       button.btn-primary.btn-secondary.btn-primary-transparent.primary.rp
//
// Кнопки «Далее» тут нет: код уходит на сервер, как только набрана последняя цифра.
// Повторной отправки тут тоже нет — в `EmailRecoverCard.tsx` у tweb ровно два
// действия: `onFill` (подтвердить код) и «Cancel» → `navigate({name:'password'})`.
// Единственный путь к повтору — вернуться на карточку пароля и нажать «Forgot
// Password?» ещё раз; та ссылка в tweb каждый раз идёт на сервер (см. AuthFlow).
import { useState } from 'react'
import { useT } from '../../../i18n'
import { useManagers } from '../../../core/hooks/useManagers'
import MediaHeader from '../MediaHeader'
import CodeInput from '../CodeInput'
import useEmailPattern from '../emailPattern'
import { SecondaryButton } from '../AuthButton'
import s from '../AuthFlow.module.scss'

export interface EmailRecoverCardProps {
  /** одноразовый токен из sign_in — им же подтверждается код с почты */
  token: string
  /** маска адреса с сервера, напр. `d****@e******.com` */
  emailPattern: string
  /** «Cancel» — назад на карточку облачного пароля */
  onCancel: () => void
  /** вход завершён */
  onComplete: () => void
}

// tweb mediaSizes.isMobile ? 100 : 130
const STICKER_SIZE = 130

// tweb CodeInputFieldCompat({length: 6}) — на этой карточке код ШЕСТИзначный.
const CODE_LEN = 6

export default function EmailRecoverCard({
  token,
  emailPattern,
  onCancel,
  onComplete,
}: EmailRecoverCardProps) {
  const t = useT()
  const managers = useManagers()

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const pattern = useEmailPattern(emailPattern)

  const submit = async (value: string) => {
    if (busy) return
    setError('')
    setBusy(true)
    const res = await managers.auth.confirmPasswordRecovery(token, value, 'web', 'browser')
    if ('user' in res) {
      onComplete()
      return
    }
    setBusy(false)
    setCode('')
    setError(
      res.error === 'invalid_code'
        ? t('Invalid code')
        // Сервер не различает истёкший код и исчерпанные 5 попыток — ни то ни
        // другое уже не поправить вводом, обе ветки просят начать заново.
        : res.error === 'recovery_expired'
          ? t('Code expired. Please request a new one.')
          : t('Something went wrong. Try again.'),
    )
  }

  return (
    <div className={s.card}>
      <MediaHeader>
        <MediaHeader.Sticker size={STICKER_SIZE} name="Mailbox" />
        <MediaHeader.Title>
          <span className="i18n">{t('Reset Password')}</span>
        </MediaHeader.Title>
        {/* без `.secondary` — подзаголовок этой карточки в tweb белый */}
        <MediaHeader.Subtitle>
          <span className="i18n">
            {t('Enter the code we just sent to your email')}
            <br />
            <b>{pattern}</b>
          </span>
        </MediaHeader.Subtitle>
      </MediaHeader>

      <div className="input-wrapper">
        {/* без `s.codeInputField`: у этой карточки поле идёт вплотную к гриду —
            в самом tweb класс сюда не передан (см. §9 dom-референса). */}
        <CodeInput
          length={CODE_LEN}
          value={code}
          onChange={(v) => {
            setError('')
            setCode(v)
          }}
          onComplete={(v) => void submit(v)}
          error={!!error}
          disabled={busy}
        />

        {/* высота зарезервирована всегда — появление ошибки не двигает раскладку */}
        <div className={s.errorLabel}>{error}</div>

        <SecondaryButton onClick={onCancel}>{t('Cancel')}</SecondaryButton>
      </div>
    </div>
  )
}
