/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/checkboxFields.tsx:1-346 (812502980) — дерево
 * тумблеров/чекбоксов: строка-группа с аккордеоном и счётчиком `N/M`, вложенные
 * поля, связь «группа ↔ вложенные» (`nestedTo`/`toggleWith`). Строки — Solid
 * `Row` HEAD (`rowTsx.solid.tsx`), каждая в своём `createRoot`, как у
 * оригинала: класс остаётся императивным (им пользуются императивно), узлы
 * отдаются вызывающему пачкой `nodes` для `append`.
 *
 *   label.row.accordion-row.accordion-toggler[.accordion-toggler-expanded]     ← группа (:151-163)
 *     div.row-row.row-title-row.with-delimiter
 *       div.row-title  «Заголовок» b.accordion-counter «N/M» span.accordion-icon.tgico (:170-185)
 *       div.row-title.row-title-right > span.checkbox-field-toggle.row-checkbox-field-toggle
 *   div.accordion[.is-expanded][inert]                                         ← вложенные (:256-272)
 *     label.row.accordion-row > span.checkbox-field.row-checkbox-field + div.row-title
 *
 * Щелчок по строке группы: по тумблеру — переключить всех вложенных
 * (`checked = !checked` у каждого, `change` всплывает до формы), по остальному —
 * раскрыть/свернуть аккордеон (`cancelEvent`, чтобы label не переключил поле,
 * :107-128). Поле группы выключено всегда (`input.disabled`, :275-277): его
 * значение выводится из вложенных (`processNestedTo`, :312-316).
 *
 * Расхождения с оригиналом — объём вызывающих (у нас один: «Энергосбережение»,
 * `sidebarLeft/tabs/powerSaving.solid.tsx`; прочие вызывающие tweb — права
 * группы `groupPermissions/sharedPermissions.ts`, `chatAutomation.tsx`,
 * `popups/deleteMegagroupMessages.tsx` — у нас ещё не портированы):
 *  1. Круглая форма (`round`: чекбокс слева + кнопка-шеврон `accordion-right-button`
 *     со счётчиком и a11y `ensureButtonSemantics`/`aria-controls`, :104-111,
 *     :189-218, :262-265) не перенесена вместе с опцией `round` и
 *     `rightButtonIcon`/`nestedRightButtonIcon` — вызывающий у неё права группы.
 *  2. Ограничения (`asRestrictions`, `restrictionText` → замок `premium_lock` и тост,
 *     :140-143, :248-254, :293-295) не перенесены — у нашего `CheckboxFieldTsx`
 *     нет `restriction` (его шапка, п. 1); вызывающие — права группы.
 *  3. `description` (подзаголовок строки), `textArgs`, `middleware`,
 *     `onRowCreation`, `onAnyChange`, `onExpand`, своя `setNestedCounter` у поля —
 *     вызывающих нет; время жизни корней — только `listenerSetter.addCleanup`
 *     (ветка без `middleware`, :233-237).
 *  4. `listenerSetter` в `CheckboxFieldTsx` не передаётся — у нашего поля нет
 *     этого пропа (привязки `stateKey` к стору тоже нет, шапка поля, п. 1).
 *  5. `input.disabled = true` у поля группы (:276) ставится эффектом в корне
 *     строки, а не строкой после него. Строки создаются изнутри Solid-эффекта
 *     (`onMount` вкладки), и эффекты нового корня встают в ОБЩУЮ очередь — эффект
 *     поля `toggleDisability(!!props.disabled)` (`checkboxFieldTsx.tsx`)
 *     отработал бы ПОСЛЕ прямой записи и снял бы `disabled`. У оригинала так и
 *     выходит во вкладке (его тест `rowTsxController.test.tsx:445-470` зовёт
 *     `createField` вне Solid и этого не видит); тогда щелчок по тумблеру группы
 *     шёл бы в ветку «не выключено» (:118-120) и переключал только саму группу,
 *     а активация label возвращала бы её обратно. Эффект, созданный после поля,
 *     идёт в очереди после его эффекта — замысел оригинала («will control it
 *     myself») держится в обоих случаях.
 *  6. Выключенное поле группы не принимает указатель
 *     (`styles/tweb/_row.scss`, `.accordion-toggler … .checkbox-field-input:disabled`):
 *     оно лежит поверх тумблера, а по выключенному полю Chrome не шлёт click —
 *     щелчок по тумблеру группы на стенде пропадал целиком. Цель щелчка —
 *     `.checkbox-toggle`, ветка «поле выключено» (:113-117) переключает вложенные.
 */
import { createEffect, createRoot, createSignal, type Accessor, type Setter } from 'solid-js'
import { i18n, type LangPackKey } from '@lib/langPack'
import cancelEvent from '@helpers/dom/cancelEvent'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import type ListenerSetter from '@helpers/listenerSetter'
import type CheckboxField from '@components/checkboxField'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import { IconTsx } from '@components/iconTsx.solid'
import Row from '@components/rowTsx.solid'
import { unwrapSolidElement } from '@helpers/solid/wrapSolidComponent'

export type CheckboxFieldsRow = {
  container: HTMLElement
  title?: HTMLElement
  toggleDisability: (disable?: boolean) => VoidFunction
}

export type CheckboxFieldsField = {
  text?: LangPackKey
  checkboxField?: CheckboxField
  checked?: boolean
  nested?: CheckboxFieldsField[]
  nestedTo?: CheckboxFieldsField
  nestedCounter?: HTMLElement
  toggleWith?: { checked?: CheckboxFieldsField[], unchecked?: CheckboxFieldsField[] }
  name?: string
  row?: CheckboxFieldsRow
}

export default class CheckboxFields<K extends CheckboxFieldsField = CheckboxFieldsField> {
  public fields: Array<K>
  protected listenerSetter: ListenerSetter

  constructor(options: {
    fields: Array<K>
    listenerSetter: ListenerSetter
  }) {
    this.fields = options.fields
    this.listenerSetter = options.listenerSetter
  }

  public createField(info: CheckboxFieldsField, isNested?: boolean): { row: CheckboxFieldsRow, nodes: HTMLElement[] } | undefined {
    if(info.nestedTo && !isNested) {
      return
    }

    let accordion!: HTMLElement
    let expanded!: Accessor<boolean>
    let setExpanded!: Setter<boolean>
    const updateAccordionHeight = () => {
      accordion.style.setProperty('--max-height', accordion.scrollHeight + 'px')
    }
    const setAccordionExpanded = (expanded: boolean) => {
      updateAccordionHeight()
      setExpanded(expanded)
      accordion.classList.toggle('is-expanded', expanded)
      // Свёрнутый — `height: 0` с обрезкой: вложенные не видны, но их поля
      // остались бы в порядке Tab и в дереве доступности (tweb :86-89).
      accordion.toggleAttribute('inert', !expanded)
    }

    let title: HTMLElement | undefined
    let checkboxField!: CheckboxField
    let disposeRoot!: VoidFunction
    let disabled!: Accessor<boolean>
    let setDisabled!: Setter<boolean>
    let disposed = false
    const titleContent = info.text ? i18n(info.text) : undefined
    const isToggle = !isNested
    const nested = info.nested
    const onClick = nested ? (e: MouseEvent) => {
      if(findUpAsChild(e.target as HTMLElement, checkboxField.label)) {
        if(checkboxField.input.disabled) {
          const checked = checkboxField.checked
          nested.forEach((field) => {
            field.checkboxField!.checked = !checked
          })
        } else {
          checkboxField.checked = !checkboxField.checked
        }

        return
      }

      cancelEvent(e)

      setAccordionExpanded(!accordion.classList.contains('is-expanded'))
    } : undefined

    const rowElement = createRoot((dispose) => {
      disposeRoot = dispose;
      [expanded, setExpanded] = createSignal(false);
      [disabled, setDisabled] = createSignal(false)

      const field = (
        <CheckboxFieldTsx
          checked={nested ? false : info.checked}
          toggle={!isNested}
          name={info.name}
          ref={(createdField) => {
            checkboxField = info.checkboxField = createdField
            createdField.label.classList.add('disable-hover')
          }}
        />
      )

      const element = (
        <Row
          clickable={onClick}
          disabled={disabled()}
          aria-disabled={disabled()}
          classList={{
            'accordion-row': true,
            'accordion-toggler': !!nested,
            'accordion-toggler-expanded': expanded(),
          }}
        >
          {/* Row.Title забирает уже зарегистрированный тумблер в свою правую колонку. */}
          {isToggle ? (
            <Row.CheckboxFieldToggle>{field}</Row.CheckboxFieldToggle>
          ) : (
            <Row.CheckboxField>{field}</Row.CheckboxField>
          )}
          {(titleContent || nested) && (
            <Row.Title
              ref={(element) => title = element}
              rowClass={nested ? 'with-delimiter' : undefined}
            >
              {titleContent}
              {nested && (
                <>
                  {' '}
                  <b ref={(element) => info.nestedCounter = element} class="accordion-counter" />
                  {' '}
                  <IconTsx icon="down" class="accordion-icon" />
                </>
              )}
            </Row.Title>
          )}
        </Row>
      )

      if(nested) {
        // Расхождение 5: поле группы выключено всегда (tweb :275-277) — и ПОСЛЕ
        // эффекта `toggleDisability(!!props.disabled)` самого поля.
        createEffect(() => {
          checkboxField.input.disabled = true
        })
      }

      return unwrapSolidElement(element) as HTMLElement
    })

    const dispose = () => {
      if(disposed) return

      disposed = true
      disposeRoot()
    }
    // корень Solid живёт столько же, сколько слушатели владельца (tweb :231-237,
    // ветка без `middleware`)
    this.listenerSetter.addCleanup(dispose)

    const row: CheckboxFieldsRow = info.row = {
      container: rowElement,
      title,
      toggleDisability: (disable = !disabled()) => {
        setDisabled(disable)
        return () => setDisabled(!disable)
      },
    }

    const nodes: HTMLElement[] = [row.container]
    if(nested) {
      const container = accordion = document.createElement('div')
      container.classList.add('accordion')
      // свёрнут с рождения — см. setAccordionExpanded
      container.toggleAttribute('inert', true)
      const _info = info
      nested.forEach((info) => {
        info.nestedTo ??= _info
        container.append(...this.createField(info, true)!.nodes)
      })
      nodes.push(container)

      this.setNestedCounter(info)

      // * will control it myself, otherwise on mobiles it will be toggled everytime
      // (сам `disabled` — эффектом в корне строки выше, расхождение 5)
      checkboxField.setValueSilently(this.getNestedCheckedLength(info) === nested.length)

      info.toggleWith ??= { checked: nested, unchecked: nested }
    }

    if(info.toggleWith || info.nestedTo) {
      const processToggleWith = info.toggleWith ? (info: CheckboxFieldsField) => {
        const { toggleWith, nested } = info
        const value = info.checkboxField!.checked
        const arr = value ? toggleWith!.checked : toggleWith!.unchecked
        if(!arr) {
          return
        }

        const other = this.fields.filter((i) => arr.includes(i))
        other.forEach((info) => {
          info.checkboxField!.setValueSilently(value)
          if(info.nestedTo && !nested) {
            this.setNestedCounter(info.nestedTo)
          }

          if(info.toggleWith) {
            processToggleWith!(info)
          }
        })

        if(info.nested) {
          this.setNestedCounter(info)
        }
      } : undefined

      const nestedTo = info.nestedTo
      const processNestedTo = nestedTo ? () => {
        const length = this.getNestedCheckedLength(nestedTo)
        nestedTo.checkboxField!.setValueSilently(length === nestedTo.nested!.length)
        this.setNestedCounter(nestedTo, length)
      } : undefined

      this.listenerSetter.add(info.checkboxField!.input)('change', () => {
        processToggleWith?.(info)
        processNestedTo?.()
      })
    }

    return { row, nodes }
  }

  protected getNestedCheckedLength(info: CheckboxFieldsField) {
    return info.nested!.reduce((acc, v) => acc + +v.checkboxField!.checked, 0)
  }

  public setNestedCounter(info: CheckboxFieldsField, count = this.getNestedCheckedLength(info)) {
    info.nestedCounter!.textContent = `${count}/${info.nested!.length}`
  }
}
