// Тумблер — разметка tweb `checkboxField.ts:36-133` (ветка `options.toggle`):
//   label.checkbox-field.checkbox-without-caption.checkbox-field-toggle
//        [.checkbox-field-toggle-restriction][.checkbox-disabled][.disable-hover]
//     > input.checkbox-field-input[type=checkbox]
//     + div.checkbox-toggle > div.checkbox-toggle-circle
// Подписей мы не рендерим, поэтому `checkbox-without-caption` стоит всегда
// (tweb вешает его, когда нет `options.text`). Вся геометрия и анимация —
// CSS из портированного `styles/tweb/_checkbox.scss`; своего модуля нет.
//
// Отступление от tweb (то же, что у `shared/ui/Checkbox`): клик по <label>
// гасим preventDefault'ом — иначе браузер форвардит активацию на вложенный
// input, и обработчик клика владельца строки (`.row-clickable`) сработал бы
// дважды. Состояние ведёт React, у tweb — нативный input + `change`-листенер.
import type { MouseEvent } from 'react'
import classNames from '../shared/lib/classNames'

export default function TgSwitch({
  checked,
  disabled = false,
  /** tweb `options.restriction` — тумблер-ограничение (серый «выкл», как в правах) */
  restriction = false,
  className,
}: {
  checked: boolean
  disabled?: boolean
  restriction?: boolean
  className?: string
}) {
  return (
    <label
      className={classNames(
        'checkbox-field',
        'checkbox-without-caption',
        'checkbox-field-toggle',
        restriction ? 'checkbox-field-toggle-restriction' : '',
        disabled ? 'checkbox-disabled' : '',
        className ?? '',
      )}
      onClick={(e: MouseEvent) => e.preventDefault()}
    >
      <input
        className="checkbox-field-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        readOnly
        tabIndex={-1}
      />
      <div className="checkbox-toggle">
        <div className="checkbox-toggle-circle" />
      </div>
    </label>
  )
}
