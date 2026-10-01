/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/saveButton.tsx:1-38` (812502980) — кнопка-галочка
 * «Сохранить» в шапке вкладки (`Portal` в `tab.header`), видна только при
 * изменениях; появляется и прячется масштабом (`AppearZoomTransition`).
 * `hasChanges` пропущен через throttle 200 мс — иначе шапка дёргается.
 *
 * Расхождение с оригиналом: `keepMe(ripple)` — `void ripple`, как у нас принято
 * держать импорт директивы (`emptySearchPlaceholder.solid.tsx`).
 */
import { Show, type Component } from 'solid-js'
import { IconTsx } from '@components/iconTsx.solid'
import ripple from '@components/ripple'
import AppearZoomTransition from '@components/sidebarLeft/tabs/privacy/messages/appearZoomTransition.solid'
import { createThrottled } from '@helpers/solid/createScheduled'
import I18n from '@lib/langPack'

void ripple

const SaveButton: Component<{
  hasChanges: boolean
  onClick: () => void
}> = (props) => {
  // Note: the header is jerking if updating the hasChanges too quickly
  const hasChanges = createThrottled(() => props.hasChanges, 200, true)

  return (
    <AppearZoomTransition>
      <Show when={hasChanges()}>
        <button
          use:ripple
          class="btn-icon blue"
          aria-label={I18n.format('Save', true)}
          onClick={props.onClick}
        >
          <IconTsx icon="check" />
        </button>
      </Show>
    </AppearZoomTransition>
  )
}

export default SaveButton
