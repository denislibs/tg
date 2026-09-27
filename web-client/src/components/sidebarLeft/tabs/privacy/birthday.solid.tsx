/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacy/birthday.tsx:1-17 (812502980)
 * дословно — вкладка правила `birthday` (`AppPrivacyBirthdayTab`, `solidJsTabs/tabs.ts`). Отличий
 * нет, кроме ключа правила — наш `PrivacyKey` вместо `inputPrivacyKey*`
 * (шапка `components/privacySection.solid.tsx`).
 */
import privacyTab from './privacyTab.solid'
import PrivacySection from '@components/privacySection.solid'
import type { LangPackKey } from '@lib/langPack'

const caption: LangPackKey = 'Privacy.BirthdayCaption'

export default privacyTab('privacy-birthday', (tab) => {
  new PrivacySection({
    tab,
    title: 'Privacy.Birthday',
    inputKey: 'birthday',
    captions: [caption, caption, caption],
    exceptionTexts: ['PrivacySettingsController.NeverAllow', 'PrivacySettingsController.AlwaysAllow'],
    appendTo: tab.scrollable,
    managers: tab.managers!,
  })
})
