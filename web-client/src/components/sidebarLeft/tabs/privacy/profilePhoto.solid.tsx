/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacy/profilePhoto.tsx:1-170 (812502980) —
 * вкладка правила `profile_photo` (`AppPrivacyProfilePhotoTab`, `solidJsTabs/tabs.ts`).
 *
 * Расхождения с оригиналом:
 *  1. (О-35) Секции «Public Photo» (`buildFallbackSection`, `:19-156`: поставить /
 *     обновить / удалить фото для тех, кому настоящее не видно) нет: у нас нет
 *     `fallback_photo` ни в модели, ни на проводе (`peerProfileAvatars.ts` —
 *     тот же пробел), нет `photos.uploadProfilePhoto({fallback})` и
 *     `clearFallbackProfilePhoto`.
 *  2. Ключ правила — наш `PrivacyKey` (шапка `components/privacySection.solid.tsx`).
 */
import privacyTab from './privacyTab.solid'
import PrivacySection from '@components/privacySection.solid'
import type { LangPackKey } from '@lib/langPack'

const caption: LangPackKey = 'PrivacySettingsController.ProfilePhoto.CustomHelp'

export default privacyTab('privacy-profile-photo', (tab) => {
  new PrivacySection({
    tab,
    title: 'PrivacyProfilePhotoTitle',
    inputKey: 'profile_photo',
    captions: [caption, caption, caption],
    exceptionTexts: ['PrivacySettingsController.NeverShare', 'PrivacySettingsController.AlwaysShare'],
    appendTo: tab.scrollable,
    managers: tab.managers!,
  })
})
