/** @jsxImportSource solid-js */
// SignQRCard — вход по QR-коду. Solid-порт tweb `pages/cards/SignQRCard.tsx`
// (цикл `iterate`, :135-192) поверх нашего REST: `auth.exportLoginToken` у нас —
// `managers.auth.exportLoginToken(loginKey)`.
//
// ── Один цикл, как у tweb ───────────────────────────────────────────────────
// `iterate()` опрашивает сервер, рисует QR ТОЛЬКО при смене токена (:162-166),
// и пауза до следующего опроса — `diff > FETCH_INTERVAL ? 3 с : diff`, где
// `diff = expires − now` (:169-171). Выпуск, опрос и ротацию кода делает сам
// сервер: протухший код он заменяет новым прямо в ответе. Прежние два
// независимых интервала (`ROTATE_MS`/`POLL_MS`) и ветка `expired` удалены.
//
// ── Ключ входа ──────────────────────────────────────────────────────────────
// Экран при монтировании генерирует ключ входа (32 случайных байта, hex) и шлёт
// его заголовком `X-Login-Key` в каждом `exportLoginToken`. Право забрать
// сессию принадлежит ключу, а не коду: код нарисован в QR и виден любому, кто
// смотрит на экран. Ключ не попадает ни в QR, ни в URL, ни в хранилище.
//
// ── Шаг пароля ──────────────────────────────────────────────────────────────
// Аккаунт с облачным паролем: `exportLoginToken` отвечает `status: 'password'`
// (`auth.loginTokenSuccess{authorization: auth.passwordNeeded}`) — карточка
// уходит на шаг пароля с `token` и `hint` (tweb :174-178, там это ошибка
// `SESSION_PASSWORD_NEEDED` плюс состояние сессии на сервере; у REST состояния
// нет, поэтому токен шага едет в ответе).
//
// ── Остановка ───────────────────────────────────────────────────────────────
// `onCleanup` в самой карточке (:212-216): `stopped = true`. Подписка tweb на
// `user_auth` (:67-72) — наш `rt:logged_in`: вход останавливает цикл. Вход ключом
// доступа в самой карточке гасит цикл тем же флагом.
//
// ── Какие ошибки цикл переживает ────────────────────────────────────────────
// `AUTH_TOKEN_EXPIRED` (:179-181) — `console.warn` и дальше без паузы.
// Сбой сети/5xx/429/420 — у tweb такое переотправляет сам `invokeApi`, поэтому
// в ветку `default:` они не попадают; у нас им соответствует `status: 'retry'`
// (классификацию ошибки решает `authManager` в воркере — одним местом) —
// пауза шага и повтор.
//
// ── Отказ виден, а не проглочен ─────────────────────────────────────────────
// Ветка `default:` разбора ошибки у tweb (:181-184) — `console.error` плюс
// `stopped = true`; сверх неё — видимый отказ: `toastNew` (ключ словаря) и
// подзаголовок с текстом отказа, иначе остался бы вечный прелоадер без
// объяснения.
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js'
import Button from '@components/buttonTsx.solid'
import { toastNew } from '@components/toast'
import { i18n } from '@lib/langPack'
import pause from '@helpers/schedulers/pause'
import rootScope from '@lib/rootScope'
import { RT } from '@core/realtime/events'
import { isWebAuthnSupported, getPasskeyAssertion } from '@core/webauthnBrowser'
import AuthCard from '../AuthCard.solid'
import MediaHeader from '@components/mediaHeader.solid'
import mediaHeaderStyles from '@components/mediaHeader.module.scss'
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
// tweb SignQRCard.tsx:30.
const FETCH_INTERVAL = 3

// Ключ входа: 32 случайных байта, hex нижнего регистра (формат X-Login-Key).
const makeLoginKey = (): string =>
  [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')

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
  // Как `let stopped` у tweb (:41): цикл и вход ключом доступа гасят его.
  let stopped = false
  // Вход уже состоялся (другим путём) либо карточку убрали. Отдельно от
  // `stopped`: тот гасится ещё и сбоем опроса QR (`fail()`), а кнопка ключа после
  // сбоя остаётся запасным путём входа.
  let gone = false
  // tweb `rootScope.addEventListener('user_auth', …, {once: true})` (:67-72).
  const onUserAuth = () => { stopped = true; gone = true }
  rootScope.addEventListener(RT.loggedIn, onUserAuth, { once: true })
  onCleanup(() => {
    stopped = true
    gone = true
    rootScope.removeEventListener(RT.loggedIn, onUserAuth)
  })

  onMount(() => {
    const loginKey = makeLoginKey()
    let prevToken = ''

    // Ветка `default:` разбора ошибки у tweb (`SignQRCard.tsx:181-184`):
    // `console.error` + `stopped = true`, плюс всплывашка — иначе на экране
    // остался бы бесконечно крутящийся прелоадер без объяснения.
    const fail = (err: unknown) => {
      console.error('SignQRCard: exportLoginToken error:', err)
      stopped = true
      setFailed(true)
      toastNew({ langPackKey: 'Login.Error.Generic' })
    }

    // tweb `iterate()` (:135-192); true — выйти из цикла.
    const iterate = async (): Promise<boolean> => {
      try {
        const r = await managers.auth.exportLoginToken(loginKey)
        if (stopped) return true // карточку убрали, пока ответ летел
        if (r.status === 'success') {
          stopped = true
          void toIm() // сессия уже сохранена внутри exportLoginToken
          return true
        }
        if (r.status === 'password') {
          stopped = true
          navigate({ name: 'password', payload: { token: r.passwordToken, hint: r.hint } })
          return true
        }
        if (r.status === 'expired') {
          console.warn('SignQRCard: AUTH_TOKEN_EXPIRED') // tweb :179-181: цикл идёт дальше
          return false
        }
        if (r.status === 'retry') {
          // Сбой сети/5xx/429: у tweb переотправляет сам `invokeApi`; у нас —
          // пауза шага и тот же вызов (иначе одна икота сети убивала бы QR).
          await pause(1e3 * FETCH_INTERVAL)
          return false
        }
        // Перерисовка только при смене токена (:162-166). URL для сканера
        // строим от реального origin — с бэка он не едет.
        if (r.token !== prevToken) {
          prevToken = r.token
          setQrUrl(`${location.origin}/qr/${r.token}`)
        }
        const diff = r.expires - Date.now() / 1000
        // ОТСТУПЛЕНИЕ ОТ TWEB, согласовано с пользователем 2026-10-13: tweb
        // вычитает смещение серверного времени — `diff = expires − now −
        // getServerTimeOffset()` (:170); у клиента такого смещения нет, `diff`
        // считается от `Date.now()`. При `diff <= 0` (часы клиента спешат) ждём
        // полный шаг 3 с, а не 0 — иначе горячий цикл. Худший случай: смена QR
        // запаздывает не больше чем на 3 с.
        await pause(diff > FETCH_INTERVAL || diff <= 0 ? 1e3 * FETCH_INTERVAL : (1e3 * diff) | 0)
      } catch (err) {
        if (stopped) return true
        fail(err)
        return true
      }
      return false
    }

    void (async () => {
      while (!stopped) {
        if ((await iterate()) || stopped) break
      }
    })()
  })

  // Вход по ключу доступа (WebAuthn discoverable credential) — tweb держит эту
  // кнопку на обеих стартовых карточках (signQR и signIn); см. SignInCard.solid.
  const [passkeyBusy, setPasskeyBusy] = createSignal(false)
  const passkeyLogin = async () => {
    if (passkeyBusy()) return
    setPasskeyBusy(true)
    try {
      const { session, options } = await managers.auth.passkeyLoginBegin()
      const assertion = await getPasskeyAssertion(JSON.parse(options.data))
      // QR могли подтвердить с телефона, пока открыт системный диалог: второй вход
      // выпустил бы лишнюю серверную сессию. Сужает окно гонки, не закрывает: если
      // вход придёт, пока летит finish, лишняя сессия всё равно возможна.
      if (gone) {
        setPasskeyBusy(false)
        return
      }
      const res = await managers.auth.passkeyLoginFinish(session, assertion, 'web', 'browser')
      // Отказ сервера — строкой из результата (PASSKEY_CREDENTIAL_NOT_FOUND и
      // прочие): тост, в мессенджер не пускаем, цикл QR продолжается.
      if ('error' in res) {
        reportPasskeyLoginError('SignQRCard', res.error)
        setPasskeyBusy(false)
        return
      }
      if (!res.passwordNeeded && !res.user) throw new Error('unexpected passkey login outcome')
      stopped = true // вход (или шаг пароля) состоялся — цикл экспорта больше не нужен (tweb: `user_auth`)
      // Облачный пароль — шаг пароля, а не вход (tweb `passkeyLoginButton.tsx:69-71`).
      if (res.passwordNeeded) {
        navigate({ name: 'password', payload: { token: res.passwordToken, hint: res.hint } })
        return
      }
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
          <MediaHeader.Sticker size={QR_SIZE} class={styles.qrContainer} element={() => (<>
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
          </>)} />
          {/* tweb SignQRCard.tsx:228-233 — голый h1 с классом заголовка модуля, не MediaHeader.Title */}
          <h1
            class={`${mediaHeaderStyles.title} text-center text-overflow-wrap`}
            style={{ 'margin-top': 0 }}
          >
            {i18n('Login.QR.Title')}
          </h1>
          <MediaHeader.Subtitle class="secondary">
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
