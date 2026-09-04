/** @jsxImportSource solid-js */
// SignUpCard — регистрация нового номера. Solid-порт нашей React
// `cards/SignUpCard.tsx` (которая сама — порт tweb `pages/cards/SignUpCard.tsx`,
// 181 строка). Сюда ведёт ветка `signup_required` из `POST /auth/sign_in`:
// номер подтверждён кодом, аккаунта под ним ещё нет.
//
// Дерево близко к живому tweb/React-версии (dom-референс §2.5 React-версии):
//
//   div.card.pageSignUp
//     div                                   ← MediaHeader
//       div.sticker[style="--sticker-size: 120px"]
//         div.avatar-edit
//           canvas.avatar-edit-canvas#canvas-avatar
//           span.avatar-edit-icon.tgico
//       div.title.text-center.text-overflow-wrap             ← живой предпросмотр ФИО
//       div.subtitle.text-center                              ← БЕЗ .secondary
//     div.input-wrapper
//       div.input-field × 2
//       button.btn-primary.btn-color-primary.rp
//
// Ошибку tweb не выносит отдельной строкой: текст уезжает в надпись кнопки
// (`setSignUpKey(err.type)`) — здесь так же.
//
// ── Аватар: выбор ДО сабмита, заливка УЖЕ ПОД СЕССИЕЙ ────────────────────────
// Ровно как в tweb, где `sendAvatar()` живёт в ветке `auth.authorization`:
// файл выбирается сразу, но грузится ручками профиля (`media.upload` →
// `profile.addPhoto`) только ПОСЛЕ успешного `signUp` — до него грузить
// решительно некуда (ручки профиля под Bearer текущей сессии, а её ещё нет).
// Отказ заливки — НЕ повод не пустить в мессенджер (tweb: `.finally(() =>
// toIm())`) — здесь тот же `try {…} catch {}` вокруг `sendAvatar()`.
//
// ── Интерактивный кроппер — ВНЕ периметра (сознательное сужение, задача #127) ─
// У tweb выбор аватара — целый `PopupAvatar` (кадрирование/зум/поворот,
// vanilla DOM, framework-agnostic попап). Наша React-версия его тоже не
// портирует 1:1, а использует СВОЙ упрощённый `AvatarCropper` (React-хуки,
// drag-to-pan + zoom, `components/settings/AvatarCropper.tsx`) — компонент из
// другого рантайма, подключить его отсюда нельзя (граница `*.solid.tsx` не
// пускает React), а порт кроппера на Solid — самостоятельная задача (ЗАДАЧА
// #127), которой нет ни в брифе, ни в списке файлов задачи 5/6. Снести сам
// React-компонент при этом НЕЛЬЗЯ: он живой и нужен другим React-экранам
// (`EditProfile`/`NewGroupFlow`/`EditContactView`/`GroupEditFlow`, ещё не
// портированным на Solid), а обратного моста «React внутри Solid» в проекте
// нет (мост только в одну сторону — `<SolidIsland>`, см. `web-client/CLAUDE.md`);
// заводить его ради одной карточки было бы архитектурной отсебятиной сверх
// периметра. До ЗАДАЧИ #127 выбранный файл здесь не кадрируется и не
// уменьшается интерактивно — центр/масштаб задаёт исходное фото целиком, а не
// пользователь; `<canvas id="canvas-avatar">` рисует ЛУЧШЕЕ ИЗ ВОЗМОЖНОГО
// live-превью (best-effort через `Image.onload`, декодирование не гарантировано
// во всех окружениях и не участвует в данных отправки — если предпросмотр не
// нарисовался, аватар всё равно загрузится).
//
// ── Ресайз/JPEG/width-height — ЗАКРЫТО этой задачей (задача 6) ──────────────
// ДОЛГ ревью задачи 5 (заливка без ресайза, без конвертации в JPEG, без
// width/height) закрыт БЕЗ порта интерактивного кроппера — тем достаточен, что
// сам ресайз/конвертация/width-height не требуют кадрирования пользователем.
// `sendAvatar` прогоняет выбранный файл через `scaleImageForSend`
// (`core/media/scaleImageForSend.ts`, framework-agnostic порт tweb
// `newMedia.ts::scaleImageForTelegram`+`scaleMediaElement`, уже покрытый
// своими тестами и уже используемый composer'ом — `core/hooks/useChatSend.ts`):
// сторона > 2560px ужимается в бокс, HEIC/webp и прочие несовместимые с
// сервером форматы конвертируются в `image/jpeg`, тяжёлый lossless
// (png/bmp > 2 МБ) пережимается — и `width`/`height` итогового файла едут в
// `media.upload`. Раньше HEIC с айфона (частый источник аватара при
// регистрации с мобильного) уезжал КАК ЕСТЬ — браузер получателя такой файл
// вообще не показывает; теперь на выходе всегда jpeg, как и у снесённой
// React-версии. Прежний регресс (сравнение с React `AvatarCropper`, который
// СЧИТАЛ width/height САМ) закрыт для ЭТОЙ части; интерактивный кроп/зум/пан
// остаётся ЗАДАЧЕЙ #127.
//
// ── НАХОДКА 2 (ревью задачи 5): сетевой отказ на сабмите — не запертая кнопка ──
// `signUp` перебрасывает НЕ-`HttpError` наружу как есть (тот же приём, что у
// `signImport`/`confirmPasswordRecovery` — см. докблоки соседних карточек
// этой же задачи). Прежняя редакция звала её БЕЗ try/catch при уже взведённом
// `busy(true)`: сетевой отказ давал необработанное отклонение промиса, кнопка
// оставалась `disabled` навсегда с надписью «Please wait…». Образец
// правильной обработки — уже принятый в этом каталоге `PasswordCard.solid.
// tsx::submitPassword` (задача 4).
//
// ── «Заодно» (ревью задачи 5) ────────────────────────────────────────────────
// Автофокус имени заменён на `blurActiveElement()` — tweb `SignUpCard.tsx:151`
// снимает фокус (карточка приходит СРАЗУ после ввода кода, где было
// сфокусировано поле кода), а не автофокусит имя; прежняя редакция ставила
// `autoFocus` на первое поле, отступление от источника поведения. Заголовок-
// предпросмотр теперь разбирается через `wrapEmojiText` (tweb `SignUpCard.
// tsx:77-80`), а не кладётся голой строкой — кастомные эмодзи в имени
// отрисуются.
import { createSignal, onMount, type JSX } from 'solid-js'
import Button from '@components/buttonTsx.solid'
import { IconTsx } from '@components/iconTsx.solid'
import { i18n, type LangPackKey } from '@lib/langPack'
import blurActiveElement from '@helpers/dom/blurActiveElement'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import { scaleImageForSend } from '@core/media/scaleImageForSend'
import AuthCard from '../AuthCard.solid'
import MediaHeader from '../MediaHeader.solid'
import InputField from '../InputField.solid'
import { PreloaderCircular } from '../Preloader.solid'
import { useAuthFlow, type CardSpec } from '../authFlow.solid'
import styles from '../AuthFlow.module.scss'

type Spec = Extract<CardSpec, { name: 'signUp' }>

// tweb MediaHeader.Sticker size={120} на этой карточке (не 130).
const AVATAR_SIZE = 120

// tweb InputField maxLength: FirstName 70, LastName 64.
const FIRST_MAX = 70
const LAST_MAX = 64

export default function SignUpCard(props: { spec: Spec }): JSX.Element {
  const { managers, navigate, toIm } = useAuthFlow()
  const token = () => props.spec.payload.token

  const [first, setFirst] = createSignal('')
  const [last, setLast] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [errorKey, setErrorKey] = createSignal<LangPackKey | ''>('')

  let canvasEl: HTMLCanvasElement | undefined
  let fileEl: HTMLInputElement | undefined
  // Выбранный аватар ждёт сессии — грузить некуда, пока её нет (см. докблок).
  let pickedFile: File | undefined

  // tweb: снимает фокус на монтировании (карточка приходит сразу после
  // ввода кода, где было сфокусировано поле кода) — не автофокусит имя.
  onMount(() => blurActiveElement())

  // tweb: тайтл карточки — живой предпросмотр ФИО через wrapEmojiText
  // (кастомные эмодзи в имени отрисуются), пусто → «Your Name».
  const fullName = () => `${first()} ${last()}`.trim()
  const titleContent = () => {
    const name = fullName()
    return name ? wrapEmojiText(name) : i18n('YourName')
  }
  const tooLong = () => [...first()].length > FIRST_MAX || [...last()].length > LAST_MAX
  const nextLabel = () => {
    if (busy()) return i18n('PleaseWait')
    const key = errorKey()
    return key ? i18n(key) : i18n('StartMessaging')
  }

  const onFileChosen = (file: File) => {
    pickedFile = file
    const canvas = canvasEl
    if (!canvas) return
    // Live-превью — best-effort, см. докблок файла: декодирование картинки
    // не гарантировано во всех окружениях и не участвует в данных отправки.
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = AVATAR_SIZE * dpr
      canvas.height = AVATAR_SIZE * dpr
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }

  // Ручки — те же, что у экрана «Изменить профиль»: фото попадает в галерею
  // и становится аватаром. Отказ НЕ блокирует вход (tweb: `.finally`), но
  // не тонет молча — см. докблок файла, «Ресайз/JPEG/width-height».
  const sendAvatar = async () => {
    const file = pickedFile
    if (!file) return
    try {
      const prepared = await scaleImageForSend(file)
      const bytes = await prepared.file.arrayBuffer()
      const mediaId = await managers.media.upload({
        bytes,
        mime: prepared.file.type || 'image/jpeg',
        size: bytes.byteLength,
        width: prepared.width,
        height: prepared.height,
      })
      await managers.profile.addPhoto(mediaId)
    } catch (err) {
      // аватар — не повод не пустить в мессенджер (tweb: `.finally(() => toIm())`),
      // но глотать отказ БЕЗ следа нельзя — иначе никогда не узнаем, что аплоад не удался.
      console.error('SignUpCard: не удалось загрузить аватар', err)
    }
  }

  const submit = async () => {
    if (busy() || tooLong()) return
    if (!first().trim()) {
      setErrorKey('Login.Register.NameRequired')
      return
    }
    setBusy(true)
    setErrorKey('')
    try {
      const res = await managers.auth.signUp(token(), first().trim(), last().trim(), 'web', 'browser')
      if ('user' in res) {
        await sendAvatar()
        void toIm()
        return
      }
      // Токена больше нет — единственный путь дальше это заново подтвердить номер.
      if (res.error === 'signup_token_expired' || res.error === 'phone_number_occupied') {
        navigate({ name: 'signIn' })
        return
      }
      setErrorKey(
        res.error === 'first_name_required'
          ? 'Login.Register.NameRequired'
          : res.error === 'name_too_long'
            ? 'Login.Register.NameTooLong'
            : res.error === 'too_many_requests'
              ? 'Login.Error.FloodWait'
              : 'Login.Error.Generic',
      )
    } catch {
      setErrorKey('Login.Error.Generic')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard
      class={styles.pageSignUp}
      header={
        <MediaHeader>
          <MediaHeader.Sticker size={AVATAR_SIZE}>
            {/* Размер `.avatar-edit` завязан на `--sticker-size` родителя — как
                и у React-версии (в самом tweb правило живёт под `.page-chats` и
                на auth не действует, отчего аватар там схлопнут по высоте). */}
            <div class="avatar-edit" onClick={() => fileEl?.click()}>
              <canvas ref={canvasEl} id="canvas-avatar" class="avatar-edit-canvas" />
              <IconTsx icon="cameraadd" class="avatar-edit-icon" style={{ 'font-size': '3rem' }} />
            </div>
          </MediaHeader.Sticker>
          <MediaHeader.Title>{titleContent()}</MediaHeader.Title>
          {/* без .secondary — как у tweb на этой карточке */}
          <MediaHeader.Subtitle>{i18n('Login.Register.Subtitle')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      <InputField
        value={first()}
        maxLength={FIRST_MAX}
        label={i18n('FirstName')}
        onInput={(v) => {
          setErrorKey('')
          setFirst(v)
        }}
        onEnter={() => void submit()}
      />
      <InputField
        value={last()}
        maxLength={LAST_MAX}
        label={i18n('LastName')}
        onInput={(v) => {
          setErrorKey('')
          setLast(v)
        }}
        onEnter={() => void submit()}
      />
      <Button
        class="btn-primary btn-color-primary"
        disabled={busy() || tooLong()}
        onClick={() => void submit()}
      >
        {nextLabel()}
        {busy() && <PreloaderCircular />}
      </Button>

      {/* Выбор файла — скрытый инпут ВНЕ .avatar-edit, чтобы клик по иконке не
          дублировался кликом по самому input. */}
      <input
        ref={fileEl}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (f) onFileChosen(f)
        }}
      />
    </AuthCard>
  )
}
