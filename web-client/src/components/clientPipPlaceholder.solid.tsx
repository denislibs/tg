/** @jsxImportSource solid-js */
// Порт tweb `src/components/clientPipPlaceholder.tsx` (812502980).
//
// Расхождение одно: `<I18nTsx key=… />` (`helpers/solid/i18n.tsx`) у нас нет —
// узел перевода ставится тем же `i18n(key)` (`IntlElement`, на котором стоит и
// `I18nTsx` оригинала), как в `archiveDialog.solid.tsx`.
import { i18n } from '@lib/langPack'
import classNames from '@helpers/string/classNames'
import styles from './clientPipPlaceholder.module.scss'

/**
 * Shown in the now-empty tab while the client is popped out into a Document Picture-in-Picture window,
 * so the tab doesn't read as a blank page. The button brings the client back without the user having
 * to find the PiP window's own close control.
 */
export default function ClientPipPlaceholder(props: { onReturn: () => void }) {
  return (
    <div class={styles.screen}>
      <div class={styles.content}>
        <div class={styles.title}>
          {i18n('ClientPip.PlaceholderTitle')}
        </div>
        <div class={styles.description}>
          {i18n('ClientPip.PlaceholderDescription')}
        </div>
        <button
          class={classNames('btn-primary', 'btn-color-primary', styles.button)}
          onClick={() => props.onReturn()}
        >
          {i18n('ClientPip.ReturnToTab')}
        </button>
      </div>
    </div>
  )
}
