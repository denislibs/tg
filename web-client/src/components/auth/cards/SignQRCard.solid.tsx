/** @jsxImportSource solid-js */
// SignQRCard — вход по QR-коду. Solid-порт нашей React `cards/SignQRCard.tsx`
// (которая сама — порт tweb `pages/cards/SignQRCard.tsx`, 245 строк, поверх
// нашего REST-бэкенда: у tweb это MTProto-цикл `auth.exportLoginToken`/
// `auth.importLoginToken`, у нас — `managers.auth.qrNew`/`qrStatus`).
//
// ── Ротация и опрос ЖИВУТ В КАРТОЧКЕ и снимаются вместе с ней ───────────────
// Это то самое особое внимание задачи 5: у tweb — `onCleanup` В САМОЙ
// карточке (`SignQRCard.tsx:212-216`, `stopped = true` + снятие подписок
// rootScope), а не возврат из React `useEffect` (как было бы у нас в
// React-версии). Здесь — ровно тот же приём: `onCleanup`, а не что-либо,
// зависящее от порядка React-рендеров. Пины `SignQRCard.solid.test.tsx`
// (describe «таймеры снимаются вместе с карточкой») продвигают фейковые
// таймеры ПОСЛЕ `dispose()` и проверяют, что ни `qrNew`, ни `qrStatus` больше
// не званы — заодно ловят и позднюю подтверждённость (ответ, догнавший уже
// мёртвую карточку), которую флаг `alive` внутри отбрасывает.
//
// ── Ротация/опрос — наше расширение против tweb (REST, не MTProto) ─────────
// У tweb один цикл `iterate()` сам решает, когда переопросить сервер (`diff`
// от `expires` токена). У нашего REST `qrNew`/`qrStatus` нет отдельного
// «сколько ждать» в ответе — поэтому, как и в React-версии, здесь ДВА
// независимых интервала: ротация токена (`ROTATE_MS`, если экран открыт
// долго и токен истёк на сервере) и опрос подтверждения (`POLL_MS`).
//
// ── Что НЕ портировано из tweb (нет предмета на REST-бэкенде) ───────────────
// Ветка `SESSION_PASSWORD_NEEDED → navigate({name:'password'})`
// (`SignQRCard.tsx:168-171`, MTProto бросает эту ошибку из
// `auth.exportLoginToken`, если у аккаунта, с которого сканируют,
// включён облачный пароль) — не портирована: у нашего `qrStatus` РОВНО
// три исхода (`pending`/`expired`/`confirmed`, все — обычные значения, не
// исключения), у него нет третьего/четвёртого конструктора под 2FA. Как
// именно REST-бэкенд обошёлся бы с паролем на QR-входе — вопрос протокола
// `POST/GET /auth/qr/*`, не этой карточки.
//
// ── Отказ виден, а не проглочен ─────────────────────────────────────────────
// У tweb `iterate()` разбирает ошибку ПО ТИПУ (`SignQRCard.tsx:172-188`) и ни
// одну не гасит молча: `SESSION_PASSWORD_NEEDED` (:174) уводит на карточку
// пароля, `AUTH_TOKEN_EXPIRED` (:178) пишет `console.warn` и крутит цикл
// дальше, ЛЮБАЯ прочая (`default:`, :181-184) — `console.error` плюс
// `stopped = true`, то есть остановка опроса. Прежняя редакция этой карточки
// держала на обоих вызовах ПУСТОЙ `catch {}`: падение (например, недоступный
// `managers.auth` при поломке RPC-прокси) превращалось в вечный прелоадер без
// единой строки в консоли — кнопка «нажимается и ничего не происходит».
// Здесь — ветка `default:` оригинала дословно (след в консоли + остановка) и,
// сверх неё, видимый отказ: `toastNew` (tweb `components/toast.ts`, ключ из
// словаря). Двух других веток у нас нет предмета — см. абзац выше про 2FA и
// `qrStatus`, где протухший токен приезжает ЗНАЧЕНИЕМ `expired`, а не броском.
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import Button from '@components/buttonTsx.solid'
import { toastNew } from '@components/toast'
import { i18n } from '@lib/langPack'
import { isWebAuthnSupported, getPasskeyAssertion } from '@core/webauthnBrowser'
import AuthCard from '../AuthCard.solid'
import MediaHeader from '../MediaHeader.solid'
import Preloader from '../Preloader.solid'
import QrCode from '../QrCode.solid'
import { reportPasskeyLoginError } from '../passkeyLoginError'
import { useAuthFlow, type CardSpec } from '../authFlow.solid'
import styles from '../AuthFlow.module.scss'

type Spec = Extract<CardSpec, { name: 'signQR' }>

// tweb QR_SIZE = 240 — и контейнер, и матрица рисуются в 240 (× devicePixelRatio
// в атрибутах канвы); до 208 CSS её ужимает `.qrCanvas{width/height:100%}`
// внутри контейнера с padding 16.
const QR_SIZE = 240
const ROTATE_MS = 30_000
const POLL_MS = 2_000

export default function SignQRCard(_props: { spec: Spec }): JSX.Element {
  const { managers, navigate, toIm } = useAuthFlow()

  const [qrUrl, setQrUrl] = createSignal('')
  // Пока QR не нарисован, в `._sticker` крутится прелоадер (tweb putPreloader).
  const [painted, setPainted] = createSignal(false)
  const [preloaderVisible, setPreloaderVisible] = createSignal(true)
  // Опрос остановлен отказом (ветка `default:` tweb). Всплывашка живёт 3с и
  // уходит — а состояние карточки остаётся неверным («сканируйте» при мёртвом
  // опросе), поэтому подзаголовок переключается на текст отказа. Это ТОТ ЖЕ
  // узел `MediaHeader.Subtitle`, что и в оригинале, только с другим ключом
  // словаря: своей разметки/стилей под ошибку здесь не заводится.
  const [failed, setFailed] = createSignal(false)
  let qrToken = ''

  onMount(() => {
    let alive = true

    // Ветка `default:` разбора ошибки у tweb (`SignQRCard.tsx:181-184`):
    // `console.error` + `stopped = true`. Останавливаем оба таймера тем же
    // `cleanup`, что и успешный вход, и показываем всплывашку — иначе на
    // экране остался бы бесконечно крутящийся прелоадер без объяснения.
    const fail = (what: string, err: unknown) => {
      if (!alive) return
      console.error(`SignQRCard: ${what} error:`, err)
      cleanup()
      setFailed(true)
      toastNew({ langPackKey: 'Login.Error.Generic' })
    }

    const regen = async () => {
      try {
        const token = await managers.auth.qrNew('web')
        if (!alive) return
        qrToken = token
        // URL для сканера строим от реального origin — с бэка он не едет
        // (за nginx мог потерять порт из Host-заголовков прокси).
        setQrUrl(`${location.origin}/qr/${token}`)
      } catch (err) {
        fail('qrNew', err)
      }
    }
    const tick = async () => {
      const token = qrToken
      if (!token) return
      try {
        const r = await managers.auth.qrStatus(token)
        if (!alive) return
        if (r.status === 'confirmed') {
          cleanup()
          void toIm() // токен уже сохранён внутри qrStatus
        } else if (r.status === 'expired') {
          void regen() // крутим свежий код
        }
      } catch (err) {
        // Протухший код сюда НЕ попадает — `qrStatus` отдаёт его значением
        // `expired` (`core/managers/authManager.ts`, ветка 404). Значит здесь
        // только настоящий отказ (сеть/воркер) — ветка `default:` оригинала.
        fail('qrStatus', err)
      }
    }
    const cleanup = () => {
      alive = false
      clearInterval(rotate)
      clearInterval(poll)
    }

    void regen()
    // `cleanup` (объявлен выше) читает `rotate`/`poll` по замыканию, а вызван
    // будет не раньше первого сработавшего таймера — TDZ здесь не грозит.
    const rotate = setInterval(() => void regen(), ROTATE_MS)
    const poll = setInterval(() => void tick(), POLL_MS)

    onCleanup(cleanup)
  })

  // Вход по ключу доступа (WebAuthn discoverable credential) — tweb держит эту
  // кнопку на обеих стартовых карточках (signQR и signIn); см. SignInCard.solid.
  const [passkeyBusy, setPasskeyBusy] = createSignal(false)
  const passkeyLogin = async () => {
    if (passkeyBusy()) return
    setPasskeyBusy(true)
    try {
      const { session, options } = await managers.auth.passkeyLoginBegin()
      const assertion = await getPasskeyAssertion(options)
      await managers.auth.passkeyLoginFinish(session, assertion, 'web', 'browser')
      void toIm()
    } catch (err) {
      // Разбор — общий на обе карточки, см. `../passkeyLoginError.ts`
      // (tweb держит его в `components/passkeyLoginButton.tsx:68-80`).
      reportPasskeyLoginError('SignQRCard', err)
      setPasskeyBusy(false)
    }
  }

  return (
    <AuthCard
      class={styles.pageSignQR}
      inputWrapper={false}
      header={
        <MediaHeader>
          {/* Подложка QR — тематическая (`--light-filled-primary-color`), radius 16;
              логотип вшит в саму матрицу, оверлея поверх QR в tweb нет. */}
          <MediaHeader.Sticker size={QR_SIZE} class={styles.qrContainer}>
            {/* tweb: `putPreloader(stickerHost, true)` до первой отрисовки, затем
                прелоадер уезжает `hide-icon .4s forwards`, а канва въезжает
                `grow-icon .4s forwards`. */}
            <Show when={preloaderVisible()}>
              <Preloader
                style={painted() ? { animation: 'hide-icon .4s forwards' } : undefined}
                onAnimationEnd={() => setPreloaderVisible(false)}
              />
            </Show>
            <Show when={qrUrl()}>
              <QrCode class={styles.qrCanvas} data={qrUrl()} size={QR_SIZE} onPainted={() => setPainted(true)} />
            </Show>
          </MediaHeader.Sticker>
          <MediaHeader.Title>{i18n('Login.QR.Title')}</MediaHeader.Title>
          <MediaHeader.Subtitle secondary>
            {i18n(failed() ? 'Login.Error.Generic' : 'Login.QR.Subtitle')}
          </MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      <ol class={styles.qrDescription}>
        {/* i18n() уже отдаёт готовые узлы (жирный/иконка `>` разобраны ядром
            словаря, `lib/langPack.ts::superFormatter`) — отдельный React-only
            `superFormatter.tsx` этой карточке не нужен, см. отчёт задачи. */}
        {(['Login.QR.Help1', 'Login.QR.Help2', 'Login.QR.Help3'] as const).map((key, i) => (
          <li class={styles.qrDescriptionItem}>
            <span class={styles.qrDescriptionMarker}>{i + 1}</span>
            {i18n(key)}
          </li>
        ))}
      </ol>

      {/* tweb SignQRCard.tsx:233-240 — bare Button с `text`. НАХОДКА 4 ревью
          задачи 5: прежняя редакция подставляла свои ключи `Login.ByPhone`/
          `Login.Passkey.Action` — БЕЗ стрелки. У tweb она ЕСТЬ и приходит
          ИЗ САМИХ КЛЮЧЕЙ (langSign.ts: `Login.QR.Cancel` = 'Log in by phone
          number >', :56; `Login.Passkey` = 'Log in by passkey >', :35) —
          висящий ` >` разбирает `superFormatter` (`lib/langPack.ts:600-606`,
          `IconMap['>'] = 'next'`) в `span.tgico.inline-icon`. Заведены НОВЫЕ
          ключи 1:1 с tweb (см. `lang.ts`). Старый `Login.ByPhone` (без
          стрелки) снесён задачей 6 волны 3 — единственным потребителем была
          React-версия этой карточки, которой больше нет. `Login.Passkey.
          Action` жив — им пользуется `SignInCard.solid.tsx` (кнопка входа
          по ключу доступа на карточке номера, другой предмет). */}
      <Button
        class="btn-primary btn-secondary btn-primary-transparent primary"
        onClick={() => navigate({ name: 'signIn' })}
        text="Login.QR.Cancel"
      />
      {/* tweb :241 — `getCurrentAccount() === 1 && <LanguageChangeButton />`
          здесь НЕ портирован: это МУЛЬТИАККАУНТ-специфичная кнопка (нет
          предложенного сервером языка, `lib/accounts/*` у нас нет вовсе — тот
          же вычет, что уже сделан у `SignInCard.solid.tsx` для соседней
          карточки). Дальше — `<PasskeyLoginButton />` tweb (:242), у нас
          begin/finish поверх REST, см. докблок файла «Наши расширения». */}
      <Show when={isWebAuthnSupported()}>
        <Button
          class="btn-primary btn-secondary btn-primary-transparent primary"
          disabled={passkeyBusy()}
          onClick={() => void passkeyLogin()}
          text="Login.Passkey"
        />
      </Show>
    </AuthCard>
  )
}
