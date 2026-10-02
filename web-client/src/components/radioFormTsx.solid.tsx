/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/radioFormTsx.tsx` (812502980, 46 строк) — дословно:
 * `<form>` из строк `Row` с радио-полем (`RadioFieldTsx`, класс `disable-hover`),
 * заголовком и необязательной подписью. Первый потребитель — вкладка типа
 * чата (`sidebarRight/tabs/chatType.solid.tsx`).
 */
import { createUniqueId, For, Show, type JSX } from 'solid-js'
import { i18n, type LangPackKey } from '@lib/langPack'
import RadioFieldTsx from '@components/radioFieldTsx.solid'
import Row from '@components/rowTsx.solid'

export type RadioFormTsxValue<T extends number | string = number | string> = {
  checked?: boolean
  langPackKey?: LangPackKey
  subtitle?: JSX.Element
  text?: string
  textElement?: HTMLElement | DocumentFragment
  value: T
}

export default function RadioFormTsx<T extends number | string>(props: {
  name?: string
  onChange: (value: T, event: Event) => void
  selected?: T
  values: RadioFormTsxValue<T>[]
}) {
  const name = props.name || createUniqueId()

  return (
    <form>
      <For each={props.values}>{(item) => (
        <Row>
          <Row.RadioField>
            <RadioFieldTsx
              class="disable-hover"
              checked={props.selected === undefined ? item.checked : props.selected === item.value}
              name={name}
              value={String(item.value)}
              onChange={(checked, event) => checked && props.onChange(item.value, event)}
            />
          </Row.RadioField>
          <Row.Title>
            {item.langPackKey ? i18n(item.langPackKey) : item.textElement ?? item.text}
          </Row.Title>
          <Show when={item.subtitle !== undefined}>
            <Row.Subtitle>{item.subtitle}</Row.Subtitle>
          </Show>
        </Row>
      )}</For>
    </form>
  )
}
