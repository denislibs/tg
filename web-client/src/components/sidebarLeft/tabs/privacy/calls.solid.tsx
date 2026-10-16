/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacy/calls.tsx:1-28 (812502980) —
 * вкладка правил `calls` и `phone_p2p` (`AppPrivacyCallsTab`, `solidJsTabs/tabs.ts`).
 *
 * Расхождение с оригиналом: ключ правила — наш `PrivacyKey` (шапка
 * `components/privacySection.solid.tsx`); `phone_p2p` = `inputPrivacyKeyPhoneP2P`.
 * Правило P2P читает сервер при каждом звонке и сам ставит звонку `p2p_allowed`
 * (`core/calls/callEngine.ts`): «никто» — звонки идут только через TURN.
 */
import privacyTab from './privacyTab.solid'
import PrivacySection from '@components/privacySection.solid'
import type { LangPackKey } from '@lib/langPack'

const callCaption: LangPackKey = 'PrivacySettingsController.PhoneCallDescription'
const p2pCaption: LangPackKey = 'PrivacySettingsController.P2p.Desc'

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

  new PrivacySection({
    tab,
    title: 'PrivacyP2PHeader',
    inputKey: 'phone_p2p',
    captions: [p2pCaption, p2pCaption, p2pCaption],
    exceptionTexts: ['PrivacySettingsController.NeverAllow', 'PrivacySettingsController.AlwaysAllow'],
    appendTo: tab.scrollable,
    managers: tab.managers!,
  })
})
