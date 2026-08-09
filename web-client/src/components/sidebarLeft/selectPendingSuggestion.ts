// Порт tweb `src/components/sidebarLeft/selectPendingSuggestion.ts` — какую из
// плашек показать: первую доступную по фиксированному приоритету.
//
// У tweb список длиннее:
//   ['frozen', 'notifications', 'passkey', 'birthdayContacts', 'birthdaySetup']
// Все, кроме 'notifications', приходят с сервера через appPromoManager
// (`help.getPromoData().pendingSuggestions` + `help.dismissSuggestion`). У нас
// такого менеджера нет, поэтому источник данных есть только у уведомлений —
// остальные варианты не портированы (заглушки не держим, см. CLAUDE.md).
export const PENDING_SUGGESTION_PRIORITY = ['notifications'] as const

export type PendingSuggestionType = typeof PENDING_SUGGESTION_PRIORITY[number]

export default function selectPendingSuggestion(
  available: Partial<Record<PendingSuggestionType, boolean>>,
): PendingSuggestionType | undefined {
  return PENDING_SUGGESTION_PRIORITY.find((type) => available[type])
}
