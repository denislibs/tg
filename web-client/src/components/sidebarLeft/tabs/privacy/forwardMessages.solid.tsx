/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacy/forwardMessages.tsx:1-17 (812502980)
 * дословно — вкладка правила `forwards` (`AppPrivacyForwardMessagesTab`, `solidJsTabs/tabs.ts`). Отличий
 * нет, кроме ключа правила — наш `PrivacyKey` вместо `inputPrivacyKey*`
 * (шапка `components/privacySection.solid.tsx`).
 */
import privacyTab from './privacyTab.solid'
import PrivacySection from '@components/privacySection.solid'
import type { LangPackKey } from '@lib/langPack'

const caption: LangPackKey = 'PrivacySettingsController.Forwards.CustomHelp'

export default privacyTab('privacy-forward-messages', (tab) => {
  new PrivacySection({
    tab,
    title: 'PrivacyForwardsTitle',
    inputKey: 'forwards',
    captions: [caption, caption, caption],
    exceptionTexts: ['PrivacySettingsController.NeverAllow', 'PrivacySettingsController.AlwaysAllow'],
    appendTo: tab.scrollable,
    managers: tab.managers!,
  })
})
