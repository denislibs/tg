/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacy/phoneNumber.tsx:1-63 (812502980) —
 * вкладка правил `phone_number` + `added_by_phone` (`AppPrivacyPhoneNumberTab`,
 * `solidJsTabs/tabs.ts`). Вторая секция «Кто может найти меня по номеру» (без
 * «Никто», без исключений) стоит сразу после первой и видна только при «Никто»
 * в первой; смена первой сбрасывает вторую на «Все» (`:39-42`) — как у оригинала.
 *
 * Расхождения с оригиналом:
 *  1. (О-36) Подпись первой секции — только `PrivacyPhoneInfo`, без второго
 *     абзаца `PrivacyPhoneInfo4` со ссылкой-копией `t.me/+<номер>`
 *     (`anchorCopy`, `:19-30`): публичной ссылки на чат по номеру у нас нет.
 *     Поэтому нет и `getSelf()` за номером, и `promiseCollector` (`:12`, `:18`,
 *     `:58`): сборка синхронная, в `onMount`, как у `privacyTab`.
 *  2. Ключи правил — наши `PrivacyKey` (шапка `components/privacySection.solid.tsx`).
 */
import privacyTab from './privacyTab.solid'
import PrivacySection, { PrivacyType } from '@components/privacySection.solid'
import type { LangPackKey } from '@lib/langPack'

export default privacyTab('privacy-phone-number', (tab) => {
  const caption: LangPackKey = 'PrivacyPhoneInfo'
  const phoneSection = new PrivacySection({
    tab,
    title: 'PrivacyPhoneTitle',
    inputKey: 'phone_number',
    captions: [caption, caption, ''],
    exceptionTexts: ['PrivacySettingsController.NeverShare', 'PrivacySettingsController.AlwaysShare'],
    appendTo: tab.scrollable,
    onRadioChange: (type) => {
      s.setRadio(PrivacyType.Everybody)
      s.radioSection.container.classList.toggle('hide', type !== PrivacyType.Nobody)
    },
    managers: tab.managers!,
  })

  const sCaption: LangPackKey = 'PrivacyPhoneInfo3'
  const s = new PrivacySection({
    tab,
    title: 'PrivacyPhoneTitle2',
    inputKey: 'added_by_phone',
    captions: [sCaption, sCaption, ''],
    noExceptions: true,
    skipTypes: [PrivacyType.Nobody],
    managers: tab.managers!,
  })

  tab.scrollable.container.insertBefore(s.radioSection.container, phoneSection.radioSection.container.nextSibling)
})
