// ФОЛБЭК на первый кадр, НЕ источник истины: реальный каталог (74 реакции,
// premium/inactive-флаги, media-роли для чипа и эффекта) теперь приходит с
// бэка — GET /reactions, core/managers/reactionsManager.ts, доступ из React
// через core/hooks/useReactions.ts. Эти семь эмодзи остаются здесь только как
// то, что рисуется до первого ответа сети (см. useReactions — до загрузки
// отдаёт пустой список, поэтому вызывающей стороне нужен свой фолбэк).
export const REACTIONS = ['❤️', '👍', '👎', '🔥', '🥰', '👏', '😁']

/**
 * Быстрая реакция — та, что показывается кружком у бабла при наведении
 * (tweb `bubble-hover-reaction`). В tweb это первая доступная реакция чата с
 * поднятой наверх «быстрой» из настроек (`getAvailableReactionsByMessage(msg,
 * unshiftQuickReaction=true)`); своей настройки у нас пока нет, поэтому берём
 * первую из списка — как и полоска в меню.
 */
export const QUICK_REACTION = REACTIONS[0]
