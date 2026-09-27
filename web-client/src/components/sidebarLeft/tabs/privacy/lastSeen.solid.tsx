/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/privacy/lastSeen.tsx:1-89 (812502980) —
 * вкладка правила `last_seen` (`AppPrivacyLastSeenTab`, `solidJsTabs/tabs.ts`).
 *
 * Расхождения с оригиналом:
 *  1. (О-18) Секции «Hide Read Time» (`:18`, `:23-25`, `:38-40`, `:44-59`,
 *     `:64-74`) нет: у tweb это флаг `globalPrivacySettings.hide_read_marks`, его
 *     на бэкенде нет. Наш предмет «кто видит время прочтения» — отдельное правило
 *     `read_time` (свой конструктор `privacyKeyReadTime`, `privacyManager.ts`) со
 *     своей вкладкой `privacy/readTime.solid.tsx`. Отсюда же — нет полезной
 *     нагрузки `GlobalPrivacySettings` и события `privacy` у вкладки.
 *  2. (О-34) Секции с кнопкой «Premium: last seen» (`:75-84`, `showPremiumPopup`)
 *     нет: попап премиума — React (волна 2C), у сервера нет премиум-обхода
 *     правила «был в сети».
 *  3. Разметка — через `privacyTab`, как у соседних вкладок: без обеих секций
 *     компоненту нечего рисовать самому. Ключ правила — наш `PrivacyKey`
 *     (шапка `components/privacySection.solid.tsx`).
 */
import privacyTab from './privacyTab.solid'
import PrivacySection from '@components/privacySection.solid'
import type { LangPackKey } from '@lib/langPack'

const caption: LangPackKey = 'PrivacySettingsController.LastSeenDescription'

export default privacyTab('privacy-last-seen', (tab) => {
  new PrivacySection({
    tab,
    title: 'LastSeenTitle',
    inputKey: 'last_seen',
    captions: [caption, caption, caption],
    exceptionTexts: ['PrivacySettingsController.NeverShare', 'PrivacySettingsController.AlwaysShare'],
    appendTo: tab.scrollable,
    managers: tab.managers!,
  })
})
