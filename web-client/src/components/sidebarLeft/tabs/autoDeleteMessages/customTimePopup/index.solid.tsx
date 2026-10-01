/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/autoDeleteMessages/customTimePopup/index.tsx:1-41`
 * (812502980) — попап «Auto-delete messages» со своим сроком: барабан в теле,
 * «Save» отдаёт выбранный срок в `onFinish`, «Cancel» — закрывает без записи.
 *
 * Расхождение с оригиналом: аргумента `HotReloadGuard` и `import.meta.hot` нет —
 * HMR у нас нет (`shared/solid/defineSolidElement.solid.tsx`, расхождение 1).
 */
import type { LangPackKey } from '@lib/langPack'
import PopupElement, { createPopup } from '@components/popups/indexTsx.solid'
import { AutoDeleteMessagesCustomTimePopupContent } from '@components/sidebarLeft/tabs/autoDeleteMessages/customTimePopup/content.solid'

type Args = {
  descriptionLangKey: LangPackKey
  period: number
  onFinish: (period: number) => void
}

export default function showAutoDeleteMessagesCustomTimePopup({ descriptionLangKey, period, onFinish }: Args) {
  let currentPeriod = period

  const content = new AutoDeleteMessagesCustomTimePopupContent()
  content.feedProps({
    initialPeriod: period || 0,
    descriptionLangKey,
    onChange: (newPeriod) => {
      currentPeriod = newPeriod
    },
  })

  createPopup(() => (
    <PopupElement class="auto-delete-messages-custom-time-popup" closable old>
      <PopupElement.Header>
        <PopupElement.CloseButton />
        <PopupElement.Title title="AutoDeleteMessages" />
      </PopupElement.Header>
      <PopupElement.Body>{content}</PopupElement.Body>
      <PopupElement.Buttons>
        <PopupElement.Button langKey="Save" callback={() => onFinish(currentPeriod)} />
        <PopupElement.Button langKey="Cancel" cancel />
      </PopupElement.Buttons>
    </PopupElement>
  ))
}
