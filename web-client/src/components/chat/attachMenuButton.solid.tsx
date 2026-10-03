/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/attachMenuButton.tsx` (812502980, 89 строк) —
// кнопка-скрепка меню вложений строки ввода. Custom element
// `attach-menu-button`: `ChatInput` строит его `new AttachMenuButton()` и
// вешает на него `ButtonMenuToggle({container: this.attachMenu, …})`
// (tweb `input.ts:1291-1347`), пункты меню — `attachMenuButtons` того же класса.
//
// Расхождения с оригиналом:
//  1. Состояние правки медиа — пропы `isReplacingMedia`, `isLoading`,
//     `loadingProgress`, `onCancel` (иконка `replace_squares`, кольцо
//     `ProgressCircleSVG` с отменой загрузки, класс `disabled`, подписи
//     `Edit`/`Cancel`) — не перенесено: правки медиа в сообщении нет (Б-38),
//     ставить эти пропы некому. Вернётся вместе с `editMessageMedia.ts`.
//  2. `attachHotClassName` → `classList.add`: снимать классы ей нужно только
//     при горячей замене модуля, а HMR у нас нет (`helpers/solid/classname.ts`).
import { IconTsx } from '@components/iconTsx.solid'
import ripple from '@components/ripple'
import defineSolidElement, { type PassedProps } from '@shared/solid/defineSolidElement.solid'
import I18n from '@lib/langPack'
import styles from './attachMenuButton.module.scss'

type Props = Record<string, never>

const AttachMenuButton = defineSolidElement({
  name: 'attach-menu-button',
  component: (props: PassedProps<Props>) => {
    props.element.classList.add(styles.Container, 'btn-menu-toggle', 'btn-icon')
    ripple(props.element, () => true)

    // tweb :29-32 — подпись без состояний правки медиа (расхождение 1)
    props.element.setAttribute('aria-label', I18n.format('Chat.Input.Attach', true))

    return (
      <IconTsx
        class={`${styles.Icon} button-icon`}
        icon="attach"
      />
    )
  },
})

export default AttachMenuButton
