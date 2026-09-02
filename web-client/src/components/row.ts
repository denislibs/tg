/**
 * Порт tweb `src/components/row.ts` — строка списка настроек, рабочая
 * лошадка вкладок настроек и правой панели. Разметка и порядок узлов
 * дословные. Классы сверены построчно (в `_row.scss` многие лежат как
 * SCSS-нестинг `&-x` внутри `.row`/`.row-title`/`.checkbox-field`, а не
 * литеральной строкой — грепом не находятся, сверка руками):
 *  • `tweb/src/scss/partials/_row.scss` (= наш уже портированный
 *    `web-client/src/styles/tweb/_row.scss`) — `row`, `no-subtitle`,
 *    `row-title(-row|-right(-secondary)?)`, `row-subtitle(-row|-right)`,
 *    `row-midtitle`, `row-with-(padding|icon)`, `row-icon`, `row-clickable`,
 *    `row-grid`, `row-right`, `row-media(-small|-medium|-big|-abitbigger|
 *    -bigger|-40)`, `row-sortable(-icon)?`, `cant-sort`, `is-disabled`,
 *    `checkbox-field-absolute` (там же, нестинг `.checkbox-field { &-absolute }`
 *    внутри `.row`);
 *  • `hover-effect` — `tweb/src/scss/base.scss:1182` (наш порт —
 *    `web-client/src/styles/tweb/_bridge.scss`), НЕ `_row.scss`;
 *  • `disable-hover` — `tweb/src/scss/components/_global.scss:199` (наш порт —
 *    `web-client/src/styles/tweb/_storiesList.scss`), тоже не `_row.scss`;
 *  • `row-with-toggle` — класс из САМОГО `row.ts` (:142), но стиля под него
 *    нет НИГДЕ в `tweb/src/scss` (проверено — ни в `_row.scss`, ни где-либо
 *    ещё). Это не наш недочёт порта, а факт оригинала: ветка формально жива
 *    (см. ниже), но визуально ничего не делает уже в tweb.
 *
 * ── Опущено (не объявлено в типе, не имитировано заглушкой) ─────────────────
 *  • `contextMenu` (#110) — требует `helpers/dom/createContextMenu`, которого в
 *    репозитории нет. У нас есть `contextMenuController` +
 *    `attachContextMenuListener` + `positionMenu`; вкладка «Устройства»
 *    (`sidebarLeft/tabs/activeSessions.solid.tsx`, шаг 7 плана волны 2) пользуется ими
 *    напрямую, минуя `Row`, — ровно как оригинал
 *    (`tweb components/sidebarLeft/tabs/activeSessions.tsx:13-16` строит
 *    контекстное меню тем же способом, а не опцией `Row`).
 *
 * ── `navigationTab` (tweb :74-79, :216-247) ─────────────────────────────────
 * Опция появилась здесь позже остального файла: она открывает вкладку на
 * `SidebarSlider`, а его до шага 5 плана волны не существовало. Смысл дословный:
 * строка — это кнопка «провалиться во вкладку», аргументы её `init` могут
 * готовиться заранее (`getInitArgs`, обычно статический метод самой вкладки) и
 * ПЕРЕГОТАВЛИВАЮТСЯ после разрушения вкладки (`destroyAfter`) — иначе повторное
 * открытие подставит устаревший снимок данных.
 *
 * ── Адаптации под наш стек ───────────────────────────────────────────────────
 *  • подписи строит `i18n(key, args)` ядра — дословно как оригинал (:111, :156,
 *    :183), вместе с `*LangArgs`-опциями и их именами: число и имя подставляет
 *    строка словаря, а не вызывающий;
 *  • наш `CheckboxField` (`checkboxField.ts`) не имеет `.span`, `.checked`,
 *    `.listenerSetter` и опции `listenerSetter` в конструкторе: проверка
 *    «есть подпись» — по `querySelector('.checkbox-caption')`, чтение
 *    состояния для `withCheckboxSubtitle` — `input.checked`, подписка на
 *    change ставится Row (как и в оригинале), а не конструктором чекбокса.
 *    Обе замены пинуются `row.test.ts` (кейсы «checkbox без подписи получает
 *    checkbox-field-absolute» и «withCheckboxSubtitle переключает подпись по
 *    input.checked»), мутация каждой ветки прогнана отдельно (раунд 1 ревью);
 *  • toggle-ветка (`checkbox-field-toggle` → `row-with-toggle`, `titleRight` =
 *    сам чекбокс) ДОСТИЖИМА с волны вкладок настроек: `toggle` у
 *    `CheckboxField` портирован (его докблок), и `checkboxFieldOptions:
 *    {toggle: true}` теперь доводит сюда настоящий toggle-чекбокс. Пин —
 *    `row.test.ts` («checkboxFieldOptions.toggle доводит строку до
 *    row-with-toggle»). Из #110 в этой строке не остаётся ничего;
 *  • `setDirection` — был неэкспортируемым в `helpers/dom/setInnerHTML.ts`
 *    (не было потребителя); Row стал первым, экспорт добавлен туда же;
 *  • `replaceContent` — вынесен отдельным хелпером
 *    (`helpers/dom/replaceContent.ts`, порт tweb 1:1), а не инлайнен —
 *    common-хелпер tweb, которым будут пользоваться и другие вкладки.
 */
import type SidebarSlider from '@components/slider'
import type SliderSuperTab from '@components/sliderTab'
import type { SliderSuperTabConstructable, SliderSuperTabEventable, SliderSuperTabEventableConstructable } from '@components/sliderTab'
import CheckboxField, { CheckboxFieldOptions } from '@components/checkboxField'
import RadioField from '@components/radioField'
import ripple from '@components/ripple'
import RadioForm from '@components/radioForm'
import Button from '@components/button'
import Icon from '@components/icon'
import type { IconName } from '@core/tgico-icons'
import { i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import setInnerHTML, { setDirection } from '@helpers/dom/setInnerHTML'
import replaceContent from '@helpers/dom/replaceContent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import type ListenerSetter from '@helpers/listenerSetter'

type K = string | HTMLElement | DocumentFragment | true

const setContent = (element: HTMLElement, content: K) => {
  if(content === true) {
    // пусто — контент положит вызывающий сам, Row лишь резервирует узел
  } else if(typeof(content) === 'string') {
    setInnerHTML(element, content)
  } else {
    element.append(content)
  }
}

export type RowMediaSizeType = 'small' | 'medium' | 'big' | 'abitbigger' | 'bigger' | '40'

/** tweb :31-33 — тип инстанса по типу конструктора вкладки */
type ConstructorP<T> = T extends { new (...args: any[]): infer U } ? U : never

export default class Row<T extends SliderSuperTabEventableConstructable = any> {
  public container: HTMLElement
  // Все поля ниже — опциональные ветки конструктора (титул/чекбокс/радио/медиа
  // не обязаны присутствовать сразу); `!` вместо `?`, чтобы не тащить
  // `| undefined` во все места чтения — так же решено в других классах-портах
  // репозитория (`audio.ts`, `preloader.ts`, `scrollable.ts`).
  public titleRow!: HTMLElement
  public titleRight!: HTMLElement
  public media!: HTMLElement

  public subtitleRow!: HTMLElement
  public subtitleRight!: HTMLElement

  public checkboxField!: CheckboxField
  public radioField!: RadioField

  public freezed = false

  public buttonRight!: HTMLElement

  private _title!: HTMLElement
  private _subtitle!: HTMLElement
  private _midtitle!: HTMLElement

  constructor(options: Partial<{
    icon: IconName,
    iconClasses: string[],
    subtitle: K,
    subtitleLangKey: LangPackKey,
    subtitleLangArgs: FormatterArguments,
    subtitleRight: K,
    radioField: Row['radioField'],
    checkboxField: Row['checkboxField'],
    checkboxFieldOptions: CheckboxFieldOptions,
    withCheckboxSubtitle: boolean,
    title: K,
    titleLangKey: LangPackKey,
    titleLangArgs: FormatterArguments,
    titleRight: K,
    titleRightSecondary: K,
    clickable: boolean | ((e: MouseEvent) => void),
    navigationTab: {
      constructor: T,
      slider: SidebarSlider,
      getInitArgs?: () => Promise<Parameters<ConstructorP<T>['init']>[0]> | Parameters<ConstructorP<T>['init']>[0]
      args?: any
    },
    havePadding: boolean,
    noRipple: boolean,
    noWrap: boolean,
    listenerSetter: ListenerSetter,
    buttonRight?: HTMLElement | boolean,
    buttonRightLangKey: LangPackKey,
    rightContent?: HTMLElement,
    rightTextContent?: string,
    asLink: boolean,
    asLabel: boolean,
    checkboxKeys: [LangPackKey, LangPackKey],
  }> = {}) {
    if(options.checkboxFieldOptions) {
      options.checkboxField = new CheckboxField(options.checkboxFieldOptions)
    }

    const tagName = options.asLink ? 'a' : (options.radioField || options.checkboxField || options.asLabel ? 'label' : 'div')
    this.container = document.createElement(tagName)
    this.container.classList.add('row', 'no-subtitle')

    if(options.noWrap) {
      this.container.classList.add('no-wrap')
    }

    if(options.subtitle || options.subtitleLangKey) {
      const subtitle = this.subtitle
      if(options.subtitleLangKey) {
        subtitle.append(i18n(options.subtitleLangKey, options.subtitleLangArgs))
      } else {
        // Внешний `if` уже требует subtitle||subtitleLangKey, а этот `else` —
        // ветка «subtitleLangKey не задан», так что subtitle точно есть.
        setContent(subtitle, options.subtitle!)
      }

      if(options.noWrap) subtitle.classList.add('no-wrap')

      if(options.subtitleRight) {
        this.container.append(this.subtitleRow = this.createRow())
        this.subtitleRow.classList.add('row-subtitle-row')
        const subtitleRight = this.subtitleRight = document.createElement('div')
        subtitleRight.classList.add('row-subtitle', 'row-subtitle-right')

        setContent(subtitleRight, options.subtitleRight)
        this.subtitleRow.append(subtitle, subtitleRight)
      }
    }

    let havePadding = !!options.havePadding
    if(options.radioField || options.checkboxField) {
      if(options.radioField) {
        this.radioField = options.radioField
        this.container.append(this.radioField.label)
        havePadding = true
      }

      if(options.checkboxField) {
        this.checkboxField = options.checkboxField

        const isToggle = options.checkboxField.label.classList.contains('checkbox-field-toggle')
        if(isToggle) {
          this.container.classList.add('row-with-toggle')
          options.titleRight = this.checkboxField.label
        } else {
          havePadding = true
          if(!this.checkboxField.label.querySelector('.checkbox-caption')) {
            this.checkboxField.label.classList.add('checkbox-field-absolute')
          }
          this.container.append(this.checkboxField.label)
        }

        if(options.withCheckboxSubtitle && !isToggle) {
          const [enabledKey, disabledKey] = options.checkboxKeys ?? ['Checkbox.Enabled', 'Checkbox.Disabled']
          const onChange = () => {
            replaceContent(this.subtitle, i18n(this.checkboxField.input.checked ? enabledKey : disabledKey))
          }

          if(options.listenerSetter) options.listenerSetter.add(this.checkboxField.input)('change', onChange)
          else this.checkboxField.input.addEventListener('change', onChange)
        }
      }

      // Внешний `if` уже требует radioField||checkboxField — один из них точно есть.
      const i = (options.radioField || options.checkboxField)!
      i.label.classList.add('disable-hover')
    }

    if(options.title || options.titleLangKey || options.titleRight || options.titleRightSecondary) {
      let c: HTMLElement
      const titleRightContent = options.titleRight || options.titleRightSecondary
      if(titleRightContent) {
        this.container.append(c = this.titleRow = this.createRow())
        this.titleRow.classList.add('row-title-row')
      } else {
        c = this.container
      }

      this._title = this.createTitle()
      if(options.noWrap) this.title.classList.add('no-wrap')
      if(options.title) {
        setContent(this.title, options.title)
      } else if(options.titleLangKey) {
        this.title.append(i18n(options.titleLangKey, options.titleLangArgs))
      }

      c.append(this.title)

      if(titleRightContent) {
        const titleRight = this.titleRight = document.createElement('div')
        titleRight.classList.add('row-title', 'row-title-right')

        if(options.titleRightSecondary) {
          titleRight.classList.add('row-title-right-secondary')
        }

        setContent(titleRight, titleRightContent)
        c.append(titleRight)
      }
    }

    if(options.icon) {
      havePadding = true
      if(options.iconClasses?.length) {
        this.container.append(Icon(options.icon, 'row-icon', ...options.iconClasses))
      } else {
        this.container.append(Icon(options.icon, 'row-icon'))
      }
      this.container.classList.add('row-with-icon')
    }

    if(havePadding) {
      this.container.classList.add('row-with-padding')
    }

    if(options.navigationTab) {
      const navigationTab = options.navigationTab
      let getInitArgs = navigationTab.getInitArgs
      if(!getInitArgs) {
        // Вкладка может объявить подготовку аргументов статическим методом —
        // тогда строке не нужно ничего знать про её данные (tweb :219-223).
        const g = (navigationTab.constructor as unknown as typeof SliderSuperTab).getInitArgs
        if(g) {
          getInitArgs = () => g()
        }
      }

      let args = navigationTab.args ?? getInitArgs?.()

      options.clickable = async() => {
        if(args instanceof Promise) {
          args = await args
        }

        const tab = navigationTab.slider.createTab(navigationTab.constructor as unknown as SliderSuperTabConstructable)
        void tab.open(args)

        // Данные, снятые ЗАРАНЕЕ, протухают вместе с закрытой вкладкой:
        // переготавливаем их после её разрушения, иначе повторное открытие
        // покажет старый снимок (tweb :240-245).
        const eventListener = (tab as SliderSuperTabEventable).eventListener
        const refresh = getInitArgs
        if(eventListener && refresh) {
          eventListener.addEventListener('destroyAfter', (promise) => {
            args = promise.then(() => refresh())
          })
        }
      }
    }

    if(options.clickable || options.radioField || options.checkboxField) {
      if(typeof(options.clickable) === 'function') {
        const clickable = options.clickable
        attachClickEvent(this.container, (e) => {
          if(this.freezed) return
          clickable(e)
        }, { listenerSetter: options.listenerSetter })
      }

      this.container.classList.add('row-clickable', 'hover-effect')

      if(!options.noRipple) {
        ripple(this.container)
      }
    }

    if(options.buttonRight || options.buttonRightLangKey) {
      options.rightContent = this.buttonRight = options.buttonRight instanceof HTMLElement ?
        options.buttonRight :
        Button('btn-primary btn-color-primary btn-control-small', { text: options.buttonRightLangKey })
    }

    if(options.rightTextContent) {
      options.rightContent = document.createElement('span')
      options.rightContent.classList.add('row-title-right-secondary')
      options.rightContent.textContent = options.rightTextContent
    }

    if(options.rightContent) {
      options.rightContent.classList.add('row-right')
      this.container.classList.add('row-grid')
      this.container.append(options.rightContent)
    }
  }

  public get title() {
    return this._title
  }

  public get subtitle() {
    return this._subtitle ??= this.createSubtitle()
  }

  public get midtitle() {
    return this._midtitle ??= this.createMidtitle()
  }

  private createRow() {
    const c = document.createElement('div')
    c.classList.add('row-row')
    return c
  }

  public createTitle() {
    const title = document.createElement('div')
    title.classList.add('row-title')
    setDirection(title)
    return title
  }

  private createSubtitle() {
    const subtitle = document.createElement('div')
    subtitle.classList.add('row-subtitle')
    setDirection(subtitle)
    if(this.title) this.title.after(subtitle)
    else this.container.prepend(subtitle)
    this.container.classList.remove('no-subtitle')
    return subtitle
  }

  private createMidtitle() {
    const midtitle = document.createElement('div')
    midtitle.classList.add('row-midtitle')
    this.subtitle.parentElement!.insertBefore(midtitle, this.subtitle)
    return midtitle
  }

  public createMedia(size?: RowMediaSizeType) {
    const media = document.createElement('div')
    return this.applyMediaElement(media, size)
  }

  public applyMediaElement(media: HTMLElement, size?: RowMediaSizeType) {
    this.container.classList.add('row-with-padding')

    this.media = media
    media.classList.add('row-media')

    if(size) {
      media.classList.add('row-media-' + size)
    }

    this.container.append(media)

    return media
  }

  public isDisabled() {
    return this.container.classList.contains('is-disabled')
  }

  public toggleDisability(disable = !this.container.classList.contains('is-disabled')) {
    this.container.classList.toggle('is-disabled', disable)
    return () => this.toggleDisability(!disable)
  }

  // `any` — как в оригинале: вызывающему безразличен тип результата, важно
  // только его завершение (снять disabled). `void` — файр-энд-форджет,
  // как `job.catch(...).finally(...)` в `core/audio/mediaPlaybackController.ts`.
  public disableWithPromise(promise: Promise<any>) {
    const toggle = this.toggleDisability(true)
    void promise.finally(() => {
      toggle()
    })
  }

  public makeSortable() {
    const sortIcon = Icon('menu', 'row-sortable-icon')
    this.container.classList.add('row-sortable')
    this.container.append(sortIcon)
  }

  public toggleSorting(enabled?: boolean) {
    this.container.classList.toggle('cant-sort', !enabled)
  }
}

export const RadioFormFromRows = (rows: Row[], onChange: (value: string) => void) => {
  return RadioForm(rows.map((r) => ({ container: r.container, input: r.radioField.input })), onChange)
}

export const RadioFormFromValues = (values: {
  // Имя поля — как в оригинале (tweb row.ts:395 `langPackKey`), а НЕ `langKey`
  // (RadioField.langKey, tweb radioField.ts:17): вкладки настроек копируются
  // из tweb почти дословно, и расхождение в имени поля здесь дало бы TS-ошибку
  // на месте порта, а не рабочий код.
  langPackKey?: LangPackKey,
  value: number | string,
  checked?: boolean,
  textElement?: ConstructorParameters<typeof RadioField>[0]['textElement']
}[], onChange: Parameters<typeof RadioFormFromRows>[1], fireInit?: boolean) => {
  const name = 'name-' + (Math.random() * 0x7FFFFF | 0)
  let checkedRadioField: RadioField | undefined
  const rows = values.map(({ langPackKey, value, checked, textElement }) => {
    const row = new Row({
      radioField: new RadioField({
        textElement,
        langKey: langPackKey,
        name,
        value: '' + value,
      }),
    })

    if(checked) {
      checkedRadioField = row.radioField
    }

    return row
  })

  const form = RadioFormFromRows(rows, onChange)
  if(checkedRadioField) {
    if(fireInit) checkedRadioField.checked = true
    else checkedRadioField.setValueSilently(true)
  }
  return form
}
