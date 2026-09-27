/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacy/addToGroups.tsx:1-17 (812502980)
 * дословно — вкладка правила `chat_invite` (`AppPrivacyAddToGroupsTab`, `solidJsTabs/tabs.ts`). Отличий
 * нет, кроме ключа правила — наш `PrivacyKey` вместо `inputPrivacyKey*`
 * (шапка `components/privacySection.solid.tsx`).
 */
import privacyTab from './privacyTab.solid'
import PrivacySection from '@components/privacySection.solid'
import type { LangPackKey } from '@lib/langPack'

const caption: LangPackKey = 'PrivacySettingsController.GroupDescription'

export default privacyTab('privacy-add-to-groups', (tab) => {
  new PrivacySection({
    tab,
    title: 'WhoCanAddMe',
    inputKey: 'chat_invite',
    captions: [caption, caption, caption],
    exceptionTexts: ['PrivacySettingsController.NeverAllow', 'PrivacySettingsController.AlwaysAllow'],
    appendTo: tab.scrollable,
    managers: tab.managers!,
  })
})
