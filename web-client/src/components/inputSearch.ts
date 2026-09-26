/**
 * Порт tweb `src/components/inputSearch.ts` (812502980) — ванильное поле поиска
 * `div.input-search`: `InputField` в режиме `plainText`, лупа, крестик очистки,
 * свой плейсхолдер-узел. Потребитель — поле селектора пиров
 * (`components/selectorSearch.solid.tsx`, tweb `selectorSearch.tsx:38-49`).
 *
 * Поведенческая половина оригинала (`onInput`/`onKeyDown`/`onClearClick`,
 * `value`, `remove`, :200-260) у нас уже есть — `InputSearchHandle`
 * (`shared/ui/InputSearch/inputSearchHandle.ts`), которую React-поле получает
 * готовыми узлами через `bind`. Здесь она та же: класс наследует её, строит узлы
 * конструктором оригинала (:39-117) и вызывает `bind` — второй копии
 * debounce-логики нет.
 *
 * Расхождения с оригиналом:
 *  1. Портирован объём селектора пиров: опций `onFocusChange`/`onDebounce`/
 *     `onBack`/`verifyDebounce`/`alwaysShowClear`/`arrowBack`/`oldStyle` нет,
 *     как и методов `setArrowBack`/`toggleLoading`/`isLoading` (:119-173) — у
 *     потребителя они не заданы, а стрелку «назад» и спиннер соединения держит
 *     поле шапки колонки (React `InputSearch.tsx` + `InputSearchHandle`).
 *     Состояние, которое `setArrowBack(undefined)` оставляет в конструкторе
 *     (:116), — «стрелки нет»: классы `with-arrow-back`/`hide`/`always-visible`
 *     при нём не ставятся, их здесь и нет.
 *  2. Смена плейсхолдера (`setPlaceholder`, :175-198) без кросс-фейда старого
 *     узла (`SetTransition … is-hiding`): плейсхолдер ставится один раз на
 *     конструкторе, старого узла не бывает.
 *  3. `set value` не шлёт синтетическое `input` — расхождение 2
 *     `InputSearchHandle`: `InputField.value` у нас его тоже не шлёт.
 */
import ButtonIcon from '@components/buttonIcon'
import Icon from '@components/icon'
import InputField from '@components/inputField'
import type { IconName } from '@core/tgico-icons'
import I18n, { i18n, type LangPackKey } from '@lib/langPack'
import InputSearchHandle from '@shared/ui/InputSearch/inputSearchHandle'

export default class InputSearch extends InputSearchHandle {
  public inputField: InputField
  public searchIcon: HTMLElement
  public currentPlaceholder?: HTMLElement

  private noPlaceholderAnimation?: boolean

  constructor(options: {
    placeholder?: LangPackKey,
    onChange?: (value: string) => void,
    onClear?: InputSearchHandle['onClear'],
    onEnter?: (value: string) => void,
    noBorder?: boolean,
    noFocusEffect?: boolean,
    debounceTime?: number,
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

    // :70-78
    this.onChange = options.onChange
    this.onClear = options.onClear
    this.onEnter = options.onEnter
    this.debounceTime = options.debounceTime ?? 300
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

    // :110
    container.append(searchIcon, clearBtn)
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

  // :175-198 без кросс-фейда (расхождение 2)
  public setPlaceholder = (langPackKey: LangPackKey) => {
    this.currentPlaceholder = i18n(langPackKey)
    this.currentPlaceholder.classList.add('input-search-placeholder')
    if(!this.noPlaceholderAnimation) {
      this.currentPlaceholder.classList.add('will-animate')
    }
    this.container.append(this.currentPlaceholder)

    // The visible placeholder is a custom element, not the native attribute,
    // so the input has no accessible name without this.
    this.input.setAttribute('aria-label', I18n.format(langPackKey, true))
  }
}
