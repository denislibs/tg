/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacy/voices.tsx:1-24 (812502980) —
 * вкладка правила `voice_messages` (`AppPrivacyVoicesTab`, `solidJsTabs/tabs.ts`).
 *
 * Расхождения с оригиналом:
 *  1. (О-34) Без премиум-замка: у tweb правило только для Premium (`premiumOnly`,
 *     `premiumCaption` со ссылкой на `showPremiumPopup`, `premiumError`, `:18-22`).
 *     Наш сервер правило голосовых премиумом не ограничивает
 *     (`backend/internal/usecase/chat/message.go`, проверка `PrivacyVoices`), попап
 *     премиума — React (волна 2C).
 *  2. Ключ правила — наш `PrivacyKey` (шапка `components/privacySection.solid.tsx`).
 */
import privacyTab from './privacyTab.solid'
import PrivacySection from '@components/privacySection.solid'
import type { LangPackKey } from '@lib/langPack'

const caption: LangPackKey = 'PrivacyVoiceMessagesInfo'

export default privacyTab('privacy-voices', (tab) => {
  new PrivacySection({
    tab,
    title: 'PrivacyVoiceMessagesTitle',
    inputKey: 'voice_messages',
    captions: [caption, caption, caption],
    exceptionTexts: ['PrivacySettingsController.NeverAllow', 'PrivacySettingsController.AlwaysAllow'],
    appendTo: tab.scrollable,
    managers: tab.managers!,
  })
})
