// src/stores/reactionEffectStore.ts
// Разовый сигнал «пользователь только что поставил СВОЮ реакцию» — эфемерное
// UI-событие для двух вещей, которые должны сыграть РОВНО один раз у этого
// конкретного чипа: select-анимация иконки (ReactionIcon `play`) и эффект
// вокруг (ReactionAroundEffect). Реакции, приехавшие по WebSocket от других
// участников чата, сюда не попадают — единственный писатель этого стора —
// клик-хендлер toggleReaction в useMessageActions.tsx (см. комментарий там).
//
// Не в feedFns (Chat.tsx): feedFns мемоизирован и раздаётся ВСЕМ MessageRow
// разом — если положить туда меняющееся состояние, любой клик по реакции
// пересобирал бы память всей ленты (CLAUDE.md: «Тяжёлые списки … не ломай
// стабильность пропсов/рефов»). Точечный Zustand-селектор внутри самого чипа
// (ReactionChip) перерисовывает только его, а не соседние сообщения.
//
// Хранилище — множество активных пар (не одна пара): пользователь может
// кликнуть реакцию на втором сообщении раньше, чем доиграл эффект у первого —
// оба должны доиграть независимо, а не обрывать друг друга.
import { create } from 'zustand'

const key = (msgId: number, emoji: string) => `${msgId}:${emoji}`

interface ReactionEffectState {
  active: Set<string>
  trigger: (msgId: number, emoji: string) => void
  clear: (msgId: number, emoji: string) => void
}

export const useReactionEffectStore = create<ReactionEffectState>((set) => ({
  active: new Set(),
  trigger: (msgId, emoji) =>
    set((s) => ({ active: new Set(s.active).add(key(msgId, emoji)) })),
  clear: (msgId, emoji) =>
    set((s) => {
      const k = key(msgId, emoji)
      if (!s.active.has(k)) return s // уже снято — не рождаем лишний рендер
      const next = new Set(s.active)
      next.delete(k)
      return { active: next }
    }),
}))
