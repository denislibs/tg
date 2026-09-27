/** @jsxImportSource solid-js */
/**
 * Вкладка «Сообщения» (`AppPrivacyMessagesTab`, `solidJsTabs/tabs.ts`) — на месте
 * tweb/src/components/sidebarLeft/tabs/privacy/messages/tab.tsx (812502980) в
 * объёме нашего бэкенда.
 *
 * У tweb предмет вкладки — два флага `globalPrivacySettings`
 * (`new_noncontact_peers_require_premium`, `noncontact_peers_paid_stars`) и
 * правило `inputPrivacyKeyNoPaidMessages` для исключений платных сообщений:
 * радио «Все / Контакты и Premium / Платно» (`optionsSection.tsx`), секция цены
 * и исключений (`paidSettingsSection.tsx`), кнопка «Сохранить» в шапке и
 * подтверждение при закрытии (`tab.tsx:41`, `:53-55`). У нас «кто может писать» —
 * обычное правило с тремя значениями и исключениями: ключ `messages`, наш
 * конструктор `privacyKeyMessages` (`core/managers/privacyManager.ts`), сервер
 * проверяет его при отправке (`backend/internal/usecase/chat/message.go`).
 * Поэтому вкладка — та же `PrivacySection`, что у соседних правил, и пишет на
 * `destroy`, как они.
 *
 * Не перенесено:
 *  1. (О-15) Платные сообщения: опция «Платно», цена в звёздах, исключения
 *     `inputPrivacyKeyNoPaidMessages` (`paidSettingsSection.tsx`,
 *     `starsRangeInput.tsx`, `useSaveSettings.ts:49-69`).
 *  2. (О-34) «Контакты и Premium» с премиум-замком (`optionsSection.tsx:25-73`,
 *     `:110-118`): наш сервер при «Мои контакты» премиум не пропускает, попап
 *     премиума — React (волна 2C).
 *  3. Кнопка «Сохранить» в шапке и подтверждение несохранённого (`tab.tsx:41`,
 *     `:53-55`) — у `PrivacySection` запись на закрытии, сохранять вручную нечего.
 *  4. Подпись — наш ключ `Privacy.MessagesCustomHelp`: у tweb подпись
 *     `Privacy.MessagesInfo` описывает «не контакты без Premium» со ссылкой на
 *     Premium — не наш смысл правила.
 */
import privacyTab from '../privacyTab.solid'
import PrivacySection from '@components/privacySection.solid'
import type { LangPackKey } from '@lib/langPack'

const caption: LangPackKey = 'Privacy.MessagesCustomHelp'

export default privacyTab('privacy-messages', (tab) => {
  new PrivacySection({
    tab,
    title: 'PrivacyMessagesTitle',
    inputKey: 'messages',
    captions: [caption, caption, caption],
    exceptionTexts: ['PrivacySettingsController.NeverAllow', 'PrivacySettingsController.AlwaysAllow'],
    appendTo: tab.scrollable,
    managers: tab.managers!,
  })
})
