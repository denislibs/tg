/** @jsxImportSource solid-js */
// AuthCodeCard — ввод кода подтверждения. Solid-порт tweb
// `pages/cards/AuthCodeCard.tsx` (343 строки) в объёме нашего REST-бэкенда
// (без MTProto `sentCode`-веток: SMS/App/Call/Fragment/Email-варианты кода,
// сброс почты входа `auth.resetLoginEmail` — предмета на бэкенде нет,
// `POST /auth/request_code` всегда шлёт SMS фиксированной длины).
//
// Кнопки «Далее» на этой карточке в tweb НЕТ: код уходит на сервер, как только
// набрана последняя цифра (`onComplete`/`onFill`). «Назад» к вводу номера
// делает НЕ угловая кнопка, а карандаш рядом с номером в шапке карточки
// (`.phoneEdit` → navigate('signIn')) — портирован 1:1.
//
// Фокус на поле ставится БЕЗУСЛОВНО (`onMount`) — это НЕ то же упущение, что
// было у `SignInCard.solid.tsx` (там `IS_TOUCH_SUPPORTED`-гейт добавлен
// ревью): у tweb `AuthCodeCard.tsx:305-309` `focusWhenConnected(codeInputField.
// input)` тоже БЕЗ гейта — тач-проверку tweb ставит только на телефонном поле
// первой карточки (клавиатура сама всплывает от смены типа инпута), здесь
// пользователь уже коснулся экрана, отправляя номер, — форма ожидаема.
//
// ── Обезьянка (`TrackingMonkey`) — Solid-порт, долг закрыт ──────────────────
// tweb `monkeys/tracking.ts` — lottie-анимация (idle+tracking канвы, кадр по
// проценту набранного, закрывает глаза на blur/открывает на focus). У нас БЫЛ
// React-порт (`components/TrackingMonkey.tsx`), но задача 6 волны 3 снесла его
// вместе со всем React-экраном входа (не осталось ни одного живого
// потребителя), а Solid-версии тогда ещё не было — задача 4 переносила
// карточки и поля ввода отдельно от самой анимации. Фича была названа явным
// долгом (запись в бэклоге, закрыта и удалена вместе с портом ниже) и
// портирована с нуля из tweb, а не из снесённого React-кода
// (правило программы — `docs/superpowers/specs/2026-08-28-solid-migration-
// design.md § 6a`). Движок — tlottie, как в оригинале (`lottieLoader.
// loadAnimationAsAsset`, Этап 1 плана «один движок lottie»); устройство
// разобрано в докблоке `../TrackingMonkey.solid.tsx`.
//
// Проводка: `focused` — сигнал, который поднимает `CodeInput.onFocusChange`
// (tweb вешает `focus`/`blur` листенеры прямо на `inputField.input` — здесь
// то же самое одним уровнем выше, через проп).
//
// `value` vs `typedValue` — НЕ дубли (находка ревью, до правки была одна
// ошибка на оба потребителя). `value` — контролируемое значение ПОЛЯ,
// «catch» в `submitCode` тоже пишет в него программно (`setValue('')` на
// неверном коде) — прямой аналог tweb `codeInputField.value = ''`
// (AuthCodeCard.tsx:126/147), которое НЕ рождает DOM-событие `input`.
// `typedValue` — отдельный сигнал, который трогает ТОЛЬКО `onChange` (зовётся
// исключительно из настоящего `input`-события в `CodeInput.solid.tsx`), и
// именно его читает `TrackingMonkey` для пересчёта кадра — программный сброс
// поля до неё не доходит, ровно как `.value = ''` не долетает до листенера
// `input` в оригинале. Пин на регресс — `AuthCodeCard.solid.test.tsx` →
// «программный сброс значения... НЕ доводит до playAnimation».
import { createSignal, onMount, type JSX } from 'solid-js'
import { IconTsx } from '@components/iconTsx.solid'
import I18n, { i18n, type LangPackKey } from '@lib/langPack'
import AuthCard from '../AuthCard.solid'
import MediaHeader from '../MediaHeader.solid'
import CodeInput from '../CodeInput.solid'
import TrackingMonkey from '../TrackingMonkey.solid'
import { useAuthFlow, type CardSpec } from '../authFlow.solid'
import styles from '../AuthFlow.module.scss'

type Spec = Extract<CardSpec, { name: 'authCode' }>

// tweb: `mediaSizes.isMobile ? 100 : 130` — тот же выбор, что уже сделан у
// React-порта этой карточки (без реактивного пересчёта на resize).
const STICKER_SIZE = 130

// Длина кода, который шлёт наш бэкенд — фиксированная (нет предмета
// `sentCode.type.length` на REST). Совпадает с DEV_OTP_CODE (см. корневой
// CLAUDE.md): пятизначный код и в проде, и в dev-обходе.
const CODE_LEN = 5

export default function AuthCodeCard(props: { spec: Spec }): JSX.Element {
  const { managers, navigate, toIm } = useAuthFlow()
  const phone = () => props.spec.payload.phone
  const fullPhone = () => '+' + phone().replace(/\D/g, '')

  const [error, setError] = createSignal<LangPackKey | ''>('')
  const [busy, setBusy] = createSignal(false)
  const [value, setValue] = createSignal('')
  // Только для `TrackingMonkey` — см. докблок файла «`value` vs `typedValue`».
  // Пишет ТОЛЬКО `onChange` (настоящий ввод); программный сброс поля на
  // неверном коде (`setValue('')` в `catch` ниже) сюда не попадает.
  const [typedValue, setTypedValue] = createSignal('')
  const [focused, setFocused] = createSignal(false)

  let codeInputEl: HTMLInputElement | undefined
  onMount(() => codeInputEl?.focus())

  // Отдельный аксессор, а не `error() ? i18n(error()) : ''` инлайном: TS не
  // сужает `LangPackKey | ''` между двумя РАЗНЫМИ вызовами геттера сигнала —
  // локальная константа читает сигнал один раз, и сужение работает как обычно.
  const errorLabel = () => {
    const key = error()
    return key ? i18n(key) : ''
  }

  const submitCode = async (code: string) => {
    if (busy()) return
    setError('')
    setBusy(true)
    let refocus = false
    try {
      const res = await managers.auth.signIn(fullPhone(), code, 'web', 'browser')
      if (res.passwordNeeded) {
        navigate({ name: 'password', payload: { token: res.passwordToken, hint: res.hint } })
        return
      }
      if (res.signUpRequired) {
        navigate({ name: 'signUp', payload: { token: res.signUpToken } })
        return
      }
      void toIm()
    } catch {
      setError('PHONE_CODE_INVALID')
      setValue('')
      refocus = true
    } finally {
      setBusy(false)
      // tweb AuthCodeCard.tsx:144-149: `disabled = false` СНАЧАЛА (выключенный
      // инпут фокус не берёт), фокус — `fastRaf`, то есть кадром позже, когда
      // `disabled` уже реально снят в DOM. `setBusy(false)` выше пишет сигнал
      // синхронно, но реальный commit в DOM у Solid идёт отдельным проходом —
      // `requestAnimationFrame` даёт этому проходу случиться первым. Только
      // на ветке ошибки — успешный путь уводит с карточки, фокусить нечего.
      if (refocus) requestAnimationFrame(() => codeInputEl?.focus())
    }
  }

  return (
    <AuthCard
      class={styles.pageAuthCode}
      inputWrapper={false}
      header={
        <MediaHeader>
          <MediaHeader.Sticker size={STICKER_SIZE}>
            {/* tweb: `._sticker > stickerHost > .media-sticker-wrapper` — см.
                докблок файла и `../TrackingMonkey.solid.tsx` про устройство. */}
            <TrackingMonkey
              size={STICKER_SIZE}
              length={CODE_LEN}
              value={value}
              typedValue={typedValue}
              focused={focused}
            />
          </MediaHeader.Sticker>
          <MediaHeader.Title>
            <div class={styles.phoneWrapper}>
              <h4 class={styles.phone}>{phone()}</h4>
              {/* tweb .phoneEdit: правка номера — единственный путь назад отсюда */}
              <span
                class={styles.phoneEdit}
                onClick={() => navigate({ name: 'signIn' })}
                role="button"
                aria-label={I18n.format('Edit', true)}
              >
                <IconTsx icon="edit" style={{ 'font-size': '1.5rem' }} />
              </span>
            </div>
          </MediaHeader.Title>
          <MediaHeader.Subtitle secondary>{i18n('Login.Code.SentSms')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      <CodeInput
        class={styles.codeInputField}
        ref={(el) => (codeInputEl = el)}
        length={CODE_LEN}
        value={value()}
        onChange={(v) => {
          setError('')
          setValue(v)
          setTypedValue(v)
        }}
        onComplete={(v) => void submitCode(v)}
        onFocusChange={setFocused}
        error={!!error()}
        disabled={busy()}
      />

      {/* высота зарезервирована всегда — появление ошибки не двигает раскладку
          (tweb .errorLabel height: 1lh) */}
      <div class={styles.errorLabel}>{errorLabel()}</div>
    </AuthCard>
  )
}
