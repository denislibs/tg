/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacy/calls.tsx:1-28 (812502980) —
 * вкладка правила `calls` (`AppPrivacyCallsTab`, `solidJsTabs/tabs.ts`).
 *
 * Расхождения с оригиналом:
 *  1. (О-16) Второй секции «Peer-to-Peer» (`inputPrivacyKeyPhoneP2P`, `:6`,
 *     `:19-27`) нет: ключа P2P на бэкенде нет (`backend/internal/domain/privacy.go`).
 *  2. Ключ правила — наш `PrivacyKey` (шапка `components/privacySection.solid.tsx`).
 */
import privacyTab from './privacyTab.solid'
import PrivacySection from '@components/privacySection.solid'
import type { LangPackKey } from '@lib/langPack'

const callCaption: LangPackKey = 'PrivacySettingsController.PhoneCallDescription'

export default privacyTab('privacy-calls', (tab) => {
  new PrivacySection({
    tab,
    title: 'WhoCanCallMe',
    inputKey: 'calls',
    captions: [callCaption, callCaption, callCaption],
    exceptionTexts: ['PrivacySettingsController.NeverAllow', 'PrivacySettingsController.AlwaysAllow'],
    appendTo: tab.scrollable,
    managers: tab.managers!,
  })
})
