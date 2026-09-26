/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/passcodeLock/shortcutBuilder.tsx:1-72
 * (812502980) — сборщик сочетания блокировки: четыре клавиши-модификатора
 * (`Ctrl`, `Alt`, `Shift`, `Meta` — глиф ⌘ на Apple, ⊞ иначе) в ряд, «+» и
 * целевая клавиша. Щелчок переключает модификатор; снять последний нельзя — на
 * его место встаёт случайный другой (`:32-40`). Потребитель — вкладка
 * «Код-пароль» (`mainTab.solid.tsx`), значение — `settings.passcodeLockShortcut`.
 *
 * Расхождения с оригиналом:
 *  1. `ripple; // keep` (`:6`) → `void ripple` (oxlint `no-unused-expressions`,
 *     тот же приём у `inlineSelect.solid.tsx`).
 *  2. `classList={{[props.class]: !!props.class}}` → `[props.class as string]`
 *     (наш strict: ключ `undefined` не индексирует объект).
 */
import { type Component, createSelector, type JSX } from 'solid-js'
import { IS_APPLE } from '@environment/userAgent'
import { IconTsx } from '@components/iconTsx.solid'
import ripple from '@components/ripple'
import styles from '@components/sidebarLeft/tabs/passcodeLock/shortcutBuilder.module.scss'

void ripple

export type ShortcutKey = 'Ctrl' | 'Alt' | 'Shift' | 'Meta'

const shortcutKeys: ShortcutKey[] = ['Ctrl', 'Alt', 'Shift', 'Meta']

const ShortcutBuilder: Component<{
  class?: string
  value: ShortcutKey[]
  onChange: (value: ShortcutKey[]) => void
  key: string
}> = (props) => {
  const isSelected = createSelector(() => props.value, (value: ShortcutKey, shortcuts) => shortcuts.includes(value))

  const getKeyContent = (key: ShortcutKey): JSX.Element => {
    if(key === 'Meta') {
      return <IconTsx icon={IS_APPLE ? 'mac_command_key' : 'win_key_filled'} />
    }
    return <span>{key}</span>
  }

  const onKeyClick = (key: ShortcutKey) => {
    if(props.value.includes(key)) {
      const newValue = props.value.filter((k) => k !== key)

      if(!newValue.length) {
        const indicies = [0, 1, 2, 3].filter((i) => i !== shortcutKeys.indexOf(key))
        newValue.push(shortcutKeys[indicies[Math.floor(Math.random() * indicies.length)]])
      }

      props.onChange(newValue)
    } else {
      props.onChange([...props.value, key])
    }
  }

  return (
    <div class={styles.Container} classList={{ [props.class as string]: !!props.class }}>
      <div class={styles.KeysContainer}>
        {/* oxlint-disable-next-line react/jsx-key -- у Solid `key` нет: список статичен, `map` исполняется один раз (tweb :53) */}
        {shortcutKeys.map((key, idx, array) => (
          <button
            use:ripple
            class={styles.KeyButton}
            classList={{
              [styles.selected]: isSelected(key),
              [styles.KeyButtonFirst]: idx === 0,
              [styles.KeyButtonLast]: idx === array.length - 1,
            }}
            aria-pressed={isSelected(key)}
            onClick={[onKeyClick, key]}
          >
            {getKeyContent(key)}
          </button>
        ))}
      </div>
      <IconTsx class={styles.PlusIcon} icon="plus" />
      <div class={styles.TargetKey}>
        {props.key}
      </div>
    </div>
  )
}

export default ShortcutBuilder
