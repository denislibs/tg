/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacy/about.tsx:1-17 (812502980)
 * дословно — вкладка правила `about` (`AppPrivacyAboutTab`, `solidJsTabs/tabs.ts`). Отличий
 * нет, кроме ключа правила — наш `PrivacyKey` вместо `inputPrivacyKey*`
 * (шапка `components/privacySection.solid.tsx`).
 */
import privacyTab from './privacyTab.solid'
import PrivacySection from '@components/privacySection.solid'
import type { LangPackKey } from '@lib/langPack'

const caption: LangPackKey = 'Privacy.BioCaption'

export default privacyTab('privacy-about', (tab) => {
  new PrivacySection({
    tab,
    title: 'Privacy.Bio',
    inputKey: 'about',
    captions: [caption, caption, caption],
    exceptionTexts: ['PrivacySettingsController.NeverAllow', 'PrivacySettingsController.AlwaysAllow'],
    appendTo: tab.scrollable,
    managers: tab.managers!,
  })
})
