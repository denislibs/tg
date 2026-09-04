/** @jsxImportSource solid-js */
// EmailRecoverCard — восстановление доступа кодом с привязанной почты
// (Solid-порт нашей React `cards/EmailRecoverCard.tsx`, которая сама — порт
// tweb `pages/cards/EmailRecoverCard.tsx`, 92 строки). Сюда ведёт «Forgot
// Password?» с карточки облачного пароля (`PasswordCard.solid.tsx`).
//
// Дерево 1:1 с живым tweb (dom-референс §2.6 нашей React-версии):
//
//   div.card                                    ← БЕЗ page-модификатора (его нет и в scss tweb)
//     div
//       div.sticker[--sticker-size: 130px] > div.lottie[--size] > canvas.lottie
//       div.title.text-center.text-overflow-wrap > span.i18n
//       div.subtitle.text-center > span.i18n > br + b > span.bluff-spoiler…
//     div.input-wrapper
//       div.wrap (поле кода — ШЕСТЬ ячеек, ВНУТРИ input-wrapper, БЕЗ .codeInputField)
//       div.errorLabel
//       button.btn-primary.btn-secondary.btn-primary-transparent.primary.rp
//
// Кнопки «Далее» тут нет: код уходит на сервер, как только набрана последняя
// цифра (`onComplete` у `CodeInput`). Повторной отправки тут тоже нет — у tweb
// EmailRecoverCard ровно два действия: подтвердить код и «Cancel» →
// `navigate({name:'password'})`. Единственный путь к повтору — вернуться на
// карточку пароля и нажать «Forgot Password?» ещё раз.
//
// ── Cancel несёт ВСЮ нагрузку password, а не только token ───────────────────
// У tweb Cancel ничего не передаёт — карточка `password` там перечитывает
// общий `authState`. У нас переход обязан довезти нагрузку САМ
// (`authFlow.solid.tsx::CardPayloadMap.password`), поэтому Cancel собирает её
// из СВОЕГО `props.spec.payload` (`token`/`hint`/`emailPattern`) — это и есть
// закрытие долга задачи 4 (находка 1 ревью, разбор — докблок
// `PasswordCard.solid.tsx`): маска возвращается пропом, не модульным Map.
import { createSignal, type JSX } from 'solid-js'
import Button from '@components/buttonTsx.solid'
import { i18n, type LangPackKey } from '@lib/langPack'
import AuthCard from '../AuthCard.solid'
import MediaHeader from '../MediaHeader.solid'
import CodeInput from '../CodeInput.solid'
import EmailPattern from '../emailPattern.solid'
import { useAuthFlow, type CardSpec } from '../authFlow.solid'
import styles from '../AuthFlow.module.scss'

type Spec = Extract<CardSpec, { name: 'emailRecover' }>

// tweb mediaSizes.isMobile ? 100 : 130 — тот же выбор, что у AuthCodeCard/PasswordCard.
const STICKER_SIZE = 130

// tweb CodeInputFieldCompat({length: 6}) — на этой карточке код ШЕСТИзначный
// (у AuthCodeCard — пять; сервер восстановления шлёт более длинный код).
const CODE_LEN = 6

export default function EmailRecoverCard(props: { spec: Spec }): JSX.Element {
  const { managers, navigate, toIm } = useAuthFlow()
  const token = () => props.spec.payload.token
  const emailPattern = () => props.spec.payload.emailPattern
  const hint = () => props.spec.payload.hint

  const [error, setError] = createSignal<LangPackKey | ''>('')
  const [busy, setBusy] = createSignal(false)
  const [code, setCode] = createSignal('')

  const errorLabel = () => {
    const key = error()
    return key ? i18n(key) : ''
  }

  const submit = async (value: string) => {
    if (busy()) return
    setError('')
    setBusy(true)
    const res = await managers.auth.confirmPasswordRecovery(token(), value, 'web', 'browser')
    setBusy(false)
    if ('user' in res) {
      void toIm()
      return
    }
    setCode('')
    setError(
      res.error === 'invalid_code'
        ? 'PHONE_CODE_INVALID'
        // Сервер не различает истёкший код и исчерпанные попытки — ни то ни
        // другое уже не поправить вводом, обе ветки просят начать заново.
        : res.error === 'recovery_expired'
          ? 'Login.Code.Expired'
          : 'Login.Error.Generic',
    )
  }

  const cancel = () => {
    navigate({ name: 'password', payload: { token: token(), hint: hint(), emailPattern: emailPattern() } })
  }

  return (
    <AuthCard
      header={
        <MediaHeader>
          <MediaHeader.Sticker size={STICKER_SIZE} name="Mailbox" />
          <MediaHeader.Title>{i18n('Login.ResetPassword.Title')}</MediaHeader.Title>
          {/* без .secondary — подзаголовок этой карточки в tweb белый */}
          <MediaHeader.Subtitle>
            {i18n('Login.ResetPassword.CodeHint')}
            <br />
            <EmailPattern pattern={emailPattern()} />
          </MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      <CodeInput
        length={CODE_LEN}
        value={code()}
        onChange={(v) => {
          setError('')
          setCode(v)
        }}
        onComplete={(v) => void submit(v)}
        error={!!error()}
        disabled={busy()}
      />

      {/* высота зарезервирована всегда — появление ошибки не двигает раскладку */}
      <div class={styles.errorLabel}>{errorLabel()}</div>

      <Button
        class="btn-primary btn-secondary btn-primary-transparent primary"
        disabled={busy()}
        onClick={cancel}
        text="Cancel"
      />
    </AuthCard>
  )
}
