/** @jsxImportSource solid-js */
/**
 * Вкладка «Время прочтения» (`AppPrivacyReadTimeTab`, `solidJsTabs/tabs.ts`) —
 * НАША, своей вкладки у tweb нет. Предмет у оригинала — флаг
 * `globalPrivacySettings.hide_read_marks`, тумблер «Hide Read Time» на вкладке
 * «Был в сети» (`privacy/lastSeen.tsx:18`, `:64-74`); у нас это самостоятельное
 * правило `read_time` с тремя значениями и исключениями (наш конструктор
 * `privacyKeyReadTime`, `core/managers/privacyManager.ts`), которое сервер
 * проверяет взаимно (`backend/internal/usecase/chat/message.go`, «Reciprocity»).
 * Собрана как соседние вкладки правил — `privacyTab` + `PrivacySection`,
 * запись на `destroy`. Судьба строки хаба — задача 23 плана 2D (О-18).
 */
import privacyTab from './privacyTab.solid'
import PrivacySection from '@components/privacySection.solid'
import type { LangPackKey } from '@lib/langPack'

const caption: LangPackKey = 'Privacy.ReadTimeCaption'

export default privacyTab('privacy-read-time', (tab) => {
  new PrivacySection({
    tab,
    title: 'PrivacyReadTimeTitle',
    inputKey: 'read_time',
    captions: [caption, caption, caption],
    exceptionTexts: ['PrivacySettingsController.NeverShare', 'PrivacySettingsController.AlwaysShare'],
    appendTo: tab.scrollable,
    managers: tab.managers!,
  })
})
