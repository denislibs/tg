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
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import Button from '@components/buttonTsx.solid'
import { i18n } from '@lib/langPack'
import { isWebAuthnSupported, getPasskeyAssertion } from '@core/webauthnBrowser'
import AuthCard from '../AuthCard.solid'
import MediaHeader from '../MediaHeader.solid'
import Preloader from '../Preloader.solid'
import QrCode from '../QrCode.solid'
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
  let qrToken = ''

  onMount(() => {
    let alive = true
    let rotate: ReturnType<typeof setInterval> | undefined
    let poll: ReturnType<typeof setInterval> | undefined

    const regen = async () => {
      try {
        const token = await managers.auth.qrNew('web')
        if (!alive) return
        qrToken = token
        // URL для сканера строим от реального origin — с бэка он не едет
        // (за nginx мог потерять порт из Host-заголовков прокси).
        setQrUrl(`${location.origin}/qr/${token}`)
      } catch {
        /* следующая ротация повторит попытку — прелоадер остаётся на месте */
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
      } catch {
        /* транзиентная ошибка — продолжаем опрос */
      }
    }
    const cleanup = () => {
      alive = false
      if (rotate) clearInterval(rotate)
      if (poll) clearInterval(poll)
    }

    void regen()
    rotate = setInterval(() => void regen(), ROTATE_MS)
    poll = setInterval(() => void tick(), POLL_MS)

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
    } catch {
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
          <MediaHeader.Subtitle secondary>{i18n('Login.QR.Subtitle')}</MediaHeader.Subtitle>
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

      {/* tweb SignQRCard.tsx:233-240 — bare Button с `text`, БЕЗ arrow (наша
          React AuthButton добавляла стрелку от себя, не из tweb; ключа
          `Login.QR.Cancel` в словаре нет — используем уже принятый в
          React-версии `Login.ByPhone`). */}
      <Button
        class="btn-primary btn-secondary btn-primary-transparent primary"
        onClick={() => navigate({ name: 'signIn' })}
        text="Login.ByPhone"
      />
      <Show when={isWebAuthnSupported()}>
        <Button
          class="btn-primary btn-secondary btn-primary-transparent primary"
          disabled={passkeyBusy()}
          onClick={() => void passkeyLogin()}
          text="Login.Passkey.Action"
        />
      </Show>
    </AuthCard>
  )
}
