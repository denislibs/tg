// AuthCardsHost — каркас экрана авторизации, порт tweb `src/pages/AuthCardsHost.tsx`
// + `src/pages/mountAuthFlow.tsx`.
//
// Маунт как в tweb: в `body` кладётся `div#auth-flow-root[style="display:contents"]`
// (чтобы `#auth-pages` унаследовал бокс body для `.whole{height:100%}`), внутрь —
// `div.whole.host#auth-pages`. Вертикальное центрирование карточки делают ДВЕ
// flex-распорки внутри скроллера (`.placeholderTop` / `.placeholder`), а не
// `align-items:center` на оверлее: иначе на низком окне карточка залезает под
// фиксированные угловые кнопки.
//
// Карточки (`./cards/*`) сменяются CSS-переходом `.cardEnter/.cardEnterTo/
// .cardExit/.cardExitTo` в режиме tweb `<Transition mode="outin">`: уходящая
// доигрывает выход, только потом монтируется новая — в контейнере никогда не
// бывает двух карточек, каждая переигрывает mount/unmount на каждый визит.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import classNames from '../../shared/lib/classNames'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import {
  ANIMATE_AUTH_KEY,
  ANIMATE_MAIN_KEY,
  PREV_ACCOUNT_KEY,
  doubleRaf,
  playAuthHostEnter,
  playAuthHostExit,
} from '../../core/accountTransition'
import { COUNTRIES, countryByPhone, type Country } from './countries'
import SignQRCard from './cards/SignQRCard'
import SignInCard from './cards/SignInCard'
import AuthCodeCard from './cards/AuthCodeCard'
import PasswordCard from './cards/PasswordCard'
import type { ToggleMode } from '../../App'
import s from './AuthFlow.module.scss'

/** Имена карточек — как в tweb `CardSpec.name` (три оставшихся экрана tweb
 *  — signUp / emailRecover / signImport — у нашего бэкенда нет, см. отчёт). */
type Card = 'signQR' | 'signIn' | 'authCode' | 'password'

/** Длина кода подтверждения, который шлёт бэкенд. */
const CODE_LEN = 5

// Замер tweb (§3.2 dom-референса): выход ≈191 мс, вход ≈183 мс при заявленных
// `transition: opacity .18s ease, transform .2s ease` — ждём длинную из двух.
const CARD_TRANSITION_MS = 200

// Группировка цифр по маске страны (RU 9990000001 → «999 000 00 01») с обрезкой
// хвоста сверх маски. Без маски (у страны нет pattern в tweb-данных) — как есть.
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

/**
 * Маунт-узел auth-флоу: `div#auth-flow-root[style="display:contents"]` в `body`
 * (tweb `mountAuthFlow`). Заодно держит `body.has-auth-pages` — гейт правила
 * `body.animation-level-2:not(.has-auth-pages) .page-chats .main-column{transition}`
 * в `styles/tweb/pages/_chats.scss`.
 */
function useAuthFlowRoot(): HTMLDivElement {
  const [root] = useState(() => {
    const el = document.createElement('div')
    el.id = 'auth-flow-root'
    el.style.display = 'contents'
    return el
  })

  useLayoutEffect(() => {
    document.body.appendChild(root)
    document.body.classList.add('has-auth-pages')
    return () => {
      root.remove()
      // tweb снимает класс в bootstrapIm через doubleRaf — чтобы включение
      // transition на колонках не заанимировало первый кадр мессенджера.
      void doubleRaf().then(() => document.body.classList.remove('has-auth-pages'))
    }
  }, [root])

  return root
}

/** tweb `vendor/solid-transition-group/common.ts:nextFrame` — двойной rAF.
 *  Возвращает отмену. */
function nextFrame(fn: () => void): () => void {
  let inner = 0
  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(fn)
  })
  return () => {
    cancelAnimationFrame(outer)
    cancelAnimationFrame(inner)
  }
}

/**
 * Переход между карточками — порт `<Transition mode="outin">` из tweb: классы
 * вешаются на сам `div.card` (обёртки у tweb нет), смена `enter → enterTo` и
 * `exit → exitTo` — через `nextFrame`. Возвращает карточку, которая сейчас в DOM.
 */
function useCardTransition(card: Card, cardsRef: React.RefObject<HTMLDivElement | null>): Card {
  const [rendered, setRendered] = useState(card)
  const enteringRef = useRef(false)

  // Выход: exit + exitActive → (кадр) → exitActive + exitTo → свап карточки.
  useEffect(() => {
    if (card === rendered) return
    const el = cardsRef.current?.firstElementChild
    let cancelFrame: (() => void) | null = null
    if (el) {
      el.classList.add(s.cardExit, s.cardExitActive)
      cancelFrame = nextFrame(() => {
        el.classList.remove(s.cardExit)
        el.classList.add(s.cardExitTo)
      })
    }
    const timer = window.setTimeout(
      () => {
        enteringRef.current = true
        setRendered(card)
      },
      el ? CARD_TRANSITION_MS : 0,
    )
    return () => {
      cancelFrame?.()
      clearTimeout(timer)
    }
  }, [card, rendered, cardsRef])

  // Вход: enter + enterActive → (кадр) → enterActive + enterTo → классы сняты.
  // tweb `appear={false}` — первая карточка не анимируется, отсюда enteringRef.
  useLayoutEffect(() => {
    if (!enteringRef.current) return
    enteringRef.current = false
    const el = cardsRef.current?.firstElementChild
    if (!el) return
    el.classList.add(s.cardEnter, s.cardEnterActive)
    const cancelFrame = nextFrame(() => {
      el.classList.remove(s.cardEnter)
      el.classList.add(s.cardEnterTo)
    })
    const timer = window.setTimeout(() => {
      el.classList.remove(s.cardEnterActive, s.cardEnterTo)
    }, CARD_TRANSITION_MS)
    return () => {
      cancelFrame()
      clearTimeout(timer)
    }
  }, [rendered, cardsRef])

  return rendered
}

export default function AuthFlow({
  onComplete,
  onToggleMode,
}: {
  onComplete: () => void
  onToggleMode: ToggleMode
}) {
  const t = useT()
  const managers = useManagers()
  const root = useAuthFlowRoot()

  const hostRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)

  const [card, setCard] = useState<Card>('signIn')
  const renderedCard = useCardTransition(card, cardsRef)

  // Номер живёт в хосте: карточка кода показывает его в шапке и шлёт в sign_in,
  // а возврат «карандашом» на signIn не должен терять набранное.
  const [country, setCountry] = useState<Country>(() => COUNTRIES.find((c) => c.iso2 === 'RU')!)
  const [phone, setPhone] = useState('')
  const phoneDigits = phone.replace(/\D/g, '')
  const fullPhone = `${country.code}${phoneDigits}`

  // Одноразовый токен + подсказка из sign_in при включённом облачном пароле.
  const [pwToken, setPwToken] = useState('')
  const [pwHint, setPwHint] = useState('')

  // Ввод в поле телефона. Начали с «+» — набирается международный код:
  // автоопределяем страну по самому длинному совпадению (tweb telInputField /
  // formatPhoneNumber), после чего в поле остаётся национальная часть.
  const onPhoneInput = useCallback(
    (raw: string) => {
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
    },
    [country],
  )

  const onCountryChange = useCallback((c: Country) => {
    setCountry(c)
    setPhone((prev) => formatPhone(prev.replace(/\D/g, ''), c.pattern))
  }, [])

  const onPasswordNeeded = useCallback((token: string, hint: string) => {
    setPwToken(token)
    setPwHint(hint)
    setCard('password')
  }, [])

  // ---- добавление второго аккаунта (tweb showBackButton / hostEnter / hostExit) ----
  const [prevAccount] = useState<number | null>(() => {
    const v = localStorage.getItem(PREV_ACCOUNT_KEY)
    return v ? Number(v) : null
  })

  useLayoutEffect(() => {
    if (localStorage.getItem(ANIMATE_AUTH_KEY)) {
      localStorage.removeItem(ANIMATE_AUTH_KEY)
      playAuthHostEnter(hostRef.current)
    }
  }, [])

  // Возврат к прежнему аккаунту: hostExit → смена активного токена → reload,
  // после которого мессенджер въезжает main-screen-enter (флаг ANIMATE_MAIN).
  const backToAccount = async () => {
    if (prevAccount == null) return
    localStorage.setItem(ANIMATE_MAIN_KEY, '1')
    localStorage.removeItem(PREV_ACCOUNT_KEY)
    await playAuthHostExit(hostRef.current)
    await managers.auth.switchAccount(prevAccount)
    location.reload()
  }

  // tweb toggleTheme: центр волны — центр иконки, а не точка клика.
  const toggleTheme = (e: MouseEvent<HTMLButtonElement>) => {
    const icon = e.currentTarget.querySelector('.tgico') ?? e.currentTarget
    const r = icon.getBoundingClientRect()
    onToggleMode({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  }

  const cardNode =
    renderedCard === 'signQR' ? (
      <SignQRCard onSignIn={() => setCard('signIn')} onComplete={onComplete} />
    ) : renderedCard === 'authCode' ? (
      <AuthCodeCard
        phone={`${country.code} ${phone}`}
        fullPhone={fullPhone}
        length={CODE_LEN}
        onEditPhone={() => setCard('signIn')}
        onPasswordNeeded={onPasswordNeeded}
        onComplete={onComplete}
      />
    ) : renderedCard === 'password' ? (
      <PasswordCard token={pwToken} hint={pwHint} onComplete={onComplete} />
    ) : (
      <SignInCard
        country={country}
        phone={phone}
        fullPhone={fullPhone}
        onCountryChange={onCountryChange}
        onPhoneInput={onPhoneInput}
        onCodeSent={() => setCard('authCode')}
        onSignQR={() => setCard('signQR')}
        onComplete={onComplete}
      />
    )

  // Каркас — 1:1 из живого tweb (§1.3 dom-референса):
  //   div.whole.host#auth-pages
  //     button.btn-icon.back.closeButton.rp        (только при втором аккаунте)
  //     button.btn-icon.darkmode_filled.themeButton.rp
  //     div.scrollable.scrollable-y.scrollable(mod).no-scrollbar
  //       div.placeholder.placeholderTop / div.cardsContainer / div.placeholder
  return createPortal(
    <div ref={hostRef} className={classNames('whole', s.host)} id="auth-pages">
      {/* tweb рендерит `.closeButton` ТОЛЬКО при getCurrentAccount() !== 1 —
          то есть при добавлении второго аккаунта; «назад» между шагами в tweb
          делает не она, а карандаш у номера на карточке кода. */}
      {prevAccount != null && (
        <IconButton
          className={classNames('back', s.closeButton)}
          onClick={() => void backToAccount()}
          aria-label={t('Back')}
        >
          <TgIcon name="back" className="button-icon" />
        </IconButton>
      )}
      <IconButton
        className={classNames('darkmode_filled', s.themeButton)}
        onClick={toggleTheme}
        aria-label={t('Dark Mode')}
      >
        <TgIcon name="darkmode_filled" className="button-icon" />
      </IconButton>

      <div className={classNames('scrollable', 'scrollable-y', s.scrollable, 'no-scrollbar')}>
        {/* верхняя распорка выше нижней: она же отбивает фиксированные кнопки
            в углах (24 инсет + 40 кнопка + 16 зазор = min-height 80px) */}
        <div className={classNames(s.placeholder, s.placeholderTop)} />
        <div ref={cardsRef} className={s.cardsContainer}>
          {cardNode}
        </div>
        <div className={s.placeholder} />
      </div>
    </div>,
    root,
  )
}
