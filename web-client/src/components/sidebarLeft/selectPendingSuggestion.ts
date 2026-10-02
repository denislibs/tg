// Порт tweb `src/components/sidebarLeft/selectPendingSuggestion.ts`
// (812502980, 1-15) — какую из плашек показать: первую доступную по
// фиксированному приоритету.
//
// Расхождение с оригиналом одно — список короче. У tweb
//   ['frozen', 'notifications', 'passkey', 'birthdayContacts', 'birthdaySetup']
// и все виды, кроме 'notifications', берут данные с сервера: `frozen` —
// `appConfig.freeze_since_date`, остальные — `help.getPromoData().pendingSuggestions`
// (`stores/promo`, `appPromoManager.dismissSuggestion`). На нашем бэкенде нет ни
// заморозки аккаунта, ни промо-подсказок — О-108 волна 7. Виды без источника
// данных не заводятся (заглушки не держим); приедут с бэкендом на свои места
// этого списка.
export const PENDING_SUGGESTION_PRIORITY = [
  'notifications', // О-108 волна 7: 'frozen' перед ним, 'passkey', 'birthdayContacts', 'birthdaySetup' — после
] as const

export type PendingSuggestionType = typeof PENDING_SUGGESTION_PRIORITY[number]

export default function selectPendingSuggestion(
  available: Partial<Record<PendingSuggestionType, boolean>>,
): PendingSuggestionType | undefined {
  return PENDING_SUGGESTION_PRIORITY.find((type) => available[type])
}
