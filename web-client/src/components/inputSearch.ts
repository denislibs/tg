/**
 * Порт tweb `src/components/inputSearch.ts` (812502980) — ванильное поле поиска
 * `div.input-search`: `InputField` в режиме `plainText`, лупа, крестик очистки,
 * свой плейсхолдер-узел. Потребители — поле селектора пиров
 * (`components/selectorSearch.solid.tsx`, tweb `selectorSearch.tsx:38-49`) и
 * поле шапки левой колонки (`sidebarLeft/index.ts`, tweb `:158`, `oldStyle`):
 * его спиннером и плейсхолдером водит автомат соединения
 * (`components/connectionStatus.ts` — `isLoading`/`toggleLoading`/`setPlaceholder`).
 *
 * Поведенческая половина оригинала (`onInput`/`onKeyDown`/`onClearClick`,
 * `value`, `remove`, :200-260) у нас уже есть — `InputSearchHandle`
 * (`shared/ui/InputSearch/inputSearchHandle.ts`), которую React-поле получает
 * готовыми узлами через `bind`. Здесь она та же: класс наследует её, строит узлы
 * конструктором оригинала (:39-117) и вызывает `bind` — второй копии
 * debounce-логики нет.
 *
 * Расхождения с оригиналом:
 *  1. (снято: `onDebounce` есть — поиск вкладки стикеров эмодзи-дропдауна.)
 *     `onFocusChange`/`onBack`/`verifyDebounce`/`alwaysShowClear`/`arrowBack` и
 *     `setArrowBack` (:119-133) — есть: их задаёт поиск по чату
 *     (`components/chat/topbarSearch.solid.tsx`, tweb `topbarSearch.tsx:476-490`).
 *  2. (снято задачей 2-1 волны 7: `setPlaceholder` — с кросс-фейдом старого
 *     узла и дедупом по ключу, как :175-198.)
 *  3. `set value` не шлёт синтетическое `input` — расхождение 2
 *     `InputSearchHandle`: `InputField.value` у нас его тоже не шлёт.
 */
import ButtonIcon from '@components/buttonIcon'
import Icon from '@components/icon'
import InputField from '@components/inputField'
import ProgressivePreloader from '@components/preloader'
import { setTransition } from '@core/dom/setTransition'
import { CONNECTION_ANIMATION_DURATION } from '@shared/ui/InputSearch/InputSearch'
import type { IconName } from '@core/tgico-icons'
import I18n, { i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import InputSearchHandle from '@shared/ui/InputSearch/inputSearchHandle'
import { attachClickEvent } from '@helpers/dom/clickEvent'

export default class InputSearch extends InputSearchHandle {
  public inputField: InputField
  public searchIcon: HTMLElement
  public currentPlaceholder?: HTMLElement
  public backBtn?: HTMLElement
  public onBack?: () => void

  private noPlaceholderAnimation?: boolean
  private alwaysShowClear?: boolean
  private arrowBack?: boolean
  private onFocusIn?: () => void
  private onFocusOut?: () => void
  private statusPreloader?: ProgressivePreloader
  private currentLangPackKey?: LangPackKey

  constructor(options: {
    placeholder?: LangPackKey,
    onChange?: (value: string) => void,
    onClear?: InputSearchHandle['onClear'],
    onEnter?: (value: string) => void,
    onFocusChange?: (isFocused: boolean) => void,
    onDebounce?: (start: boolean) => void,
    onBack?: () => void,
    alwaysShowClear?: boolean,
    verifyDebounce?: InputSearchHandle['verifyDebounce'],
    arrowBack?: boolean,
    noBorder?: boolean,
    noFocusEffect?: boolean,
    debounceTime?: number,
    oldStyle?: boolean,
    noPlaceholderAnimation?: boolean
  } = {}) {
    super()

    // :57-60
    this.inputField = new InputField({
      plainText: true,
      withBorder: !options.noBorder,
    })

    // :62-64
    const container = this.inputField.container
    container.classList.remove('input-field')
    container.classList.add('input-search')

    if(options.oldStyle) {
      container.classList.add('old-style')
    }

    // :70-78
    this.onChange = options.onChange
    this.onClear = options.onClear
    this.onEnter = options.onEnter
    this.onDebounce = options.onDebounce
    this.onBack = options.onBack
    this.debounceTime = options.debounceTime ?? 300
    this.verifyDebounce = options.verifyDebounce
    this.alwaysShowClear = options.alwaysShowClear
    this.noPlaceholderAnimation = options.noPlaceholderAnimation

    // :80-85
    const input = this.inputField.input as HTMLInputElement
    input.classList.add('input-search-input')

    if(!options.noFocusEffect) {
      input.classList.add('with-focus-effect')
    }

    // :87-89
    const searchIcon = this.searchIcon = this.createIcon('search', 'input-search-icon')
    const clearBtn = this.createButtonIcon('close', 'input-search-clear')
    clearBtn.setAttribute('aria-label', I18n.format('Clear', true))

    // :91-93 — слушатели вешает поведенческая половина
    this.bind(container, input, clearBtn)

    // :95-98
    if(options.placeholder) {
      input.placeholder = ' '
      this.setPlaceholder(options.placeholder)
    }

    // :100-108
    const { onFocusChange } = options
    if(onFocusChange) {
      this.onFocusIn = () => onFocusChange(true)
      this.onFocusOut = () => onFocusChange(false)
      input.addEventListener('focusin', this.onFocusIn)
      input.addEventListener('focusout', this.onFocusOut)
    }

    // :110
    container.append(searchIcon, clearBtn)

    // :112
    this.setArrowBack(!!options.arrowBack)
  }

  // :115-129
  public setArrowBack = (arrowBack: boolean) => {
    if(this.arrowBack === arrowBack) return
    this.arrowBack = arrowBack

    this.container.classList.toggle('with-arrow-back', arrowBack)

    if(arrowBack && !this.backBtn) {
      this.backBtn = this.createButtonIcon('arrow_prev', 'input-search-icon', 'input-search-back')
      this.container.append(this.backBtn)
      attachClickEvent(this.backBtn, () => this.onBack?.(), { cancelMouseDown: true })
    }

    this.searchIcon.classList.toggle('hide', arrowBack)
    this.backBtn?.classList.toggle('hide', !arrowBack)
    this.clearBtn.classList.toggle('always-visible', !arrowBack && !!this.alwaysShowClear)
  }

  // :131-135
  public createButtonIcon(icon: IconName, ...args: string[]) {
    args.push('input-search-part', 'input-search-button')
    return ButtonIcon(icon + ' ' + args.join(' '), { noRipple: true })
  }

  // :137-139
  public createIcon(icon: IconName, ...args: string[]) {
    return Icon(icon, 'input-search-part', ...args)
  }

  // :143-145
  public isLoading() {
    return this.container.classList.contains('is-connecting')
  }

  // :147-173
  public toggleLoading(loading: boolean) {
    const another = this.arrowBack ? this.clearBtn : this.searchIcon
    if(!this.statusPreloader) {
      this.statusPreloader = new ProgressivePreloader({ cancelable: false })
      this.statusPreloader.constructContainer({ color: 'transparent', bold: true })
      this.statusPreloader.construct?.()
      this.statusPreloader.preloader.classList.add('is-visible', 'will-animate')
      another.classList.add('will-animate')
    }

    const preloader = this.statusPreloader.preloader
    if(loading && !preloader.parentElement) {
      this.container.append(preloader)
    }

    preloader.classList.toggle('is-hiding', !loading)
    another.classList.toggle('is-hiding', loading || (another === this.clearBtn && this.inputField.isEmpty()))
    setTransition({
      element: this.container,
      className: 'is-connecting',
      forwards: loading,
      duration: CONNECTION_ANIMATION_DURATION,
      onTransitionEnd: loading ? undefined : () => {
        preloader.remove()
      },
    })
  }

  // :175-198
  public setPlaceholder = (langPackKey: LangPackKey, args?: FormatterArguments) => {
    if(this.currentLangPackKey === langPackKey) return
    this.currentLangPackKey = langPackKey

    const oldPlaceholder = this.currentPlaceholder
    if(oldPlaceholder) {
      setTransition({
        element: oldPlaceholder,
        className: 'is-hiding',
        forwards: true,
        duration: CONNECTION_ANIMATION_DURATION,
        onTransitionEnd: () => {
          oldPlaceholder.remove()
        },
      })
    }

    this.currentPlaceholder = i18n(langPackKey, args)
    this.currentPlaceholder.classList.add('input-search-placeholder')
    if(!this.noPlaceholderAnimation) {
      this.currentPlaceholder.classList.add('will-animate')
    }
    this.container.append(this.currentPlaceholder)

    // The visible placeholder is a custom element, not the native attribute,
    // so the input has no accessible name without this.
    this.input.setAttribute('aria-label', I18n.format(langPackKey, true))
  }

  // :251-255 — плюс слушатели фокуса этого класса (у оригинала они в общем `listenerSetter`)
  public remove() {
    super.remove()
    if(this.onFocusIn) this.input.removeEventListener('focusin', this.onFocusIn)
    if(this.onFocusOut) this.input.removeEventListener('focusout', this.onFocusOut)
  }
}
