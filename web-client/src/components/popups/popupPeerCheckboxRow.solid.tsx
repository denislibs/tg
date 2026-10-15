/** @jsxImportSource solid-js */
/**
 * Строка чекбокса попапа `PopupPeer` — tweb `src/components/popups/peer.tsx:144-156`
 * (812502980):
 *
 *   <RowTsx class="popup-peer-checkbox-row">
 *     <RowTsx.Title>{i18n(checkbox.text, checkbox.textArgs)}</RowTsx.Title>
 *     <RowTsx.CheckboxField><CheckboxFieldTsx ref=…/></RowTsx.CheckboxField>
 *   </RowTsx>
 *
 * У HEAD чекбокс — «только контрол» (`checkboxField.ts:10-13`), подпись принадлежит
 * строке; `.checkbox-caption` стилей больше нет. `PopupPeer` у нас императивный
 * класс, поэтому строку монтирует `mountSolidComponent` (tweb `wrapSolidComponent`,
 * `helpers/solid/wrapSolidComponent.ts`): корень гаснет на middleware попапа.
 */
import Row from '@components/rowTsx.solid'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import type CheckboxField from '@components/checkboxField'
import { i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import { mountSolidComponent } from '@helpers/solid/wrapSolidComponent'
import type { Middleware } from '@helpers/middleware'

export function createPopupPeerCheckboxRow(
  options: { text: LangPackKey, textArgs?: FormatterArguments, checked?: boolean },
  middleware: Middleware,
): { element: HTMLElement, checkboxField: CheckboxField } {
  let checkboxField!: CheckboxField
  const { element } = mountSolidComponent(() => (
    <Row class="popup-peer-checkbox-row">
      <Row.Title>{i18n(options.text, options.textArgs)}</Row.Title>
      <Row.CheckboxField>
        <CheckboxFieldTsx
          checked={options.checked}
          ref={(field) => checkboxField = field}
        />
      </Row.CheckboxField>
    </Row>
  ), middleware)
  return { element, checkboxField }
}
