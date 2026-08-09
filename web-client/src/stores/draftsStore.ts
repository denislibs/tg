// Облачные черновики. Живут в State (tweb `drafts` в StateStorage) — читаются
// одним батчем на старте (client/boot.ts), поэтому текст композера доступен уже
// в первом кадре. Запись — write-through через setAppState, отдельного дебаунс-
// персиста больше нет. Форма хранения — массив (как в State), доступ по чату —
// через мемо-хук.
import { useMemo } from 'react'
import type { Draft } from '../core/models'
import { useAppStateKey, useAppStateStore, setAppState } from './appState'

/** Реактивное чтение черновиков по чатам — единственный способ получить их в UI. */
export function useDrafts(): Record<number, Draft> {
  const drafts = useAppStateKey('drafts')
  return useMemo(() => Object.fromEntries(drafts.map((d) => [d.chatId, d])), [drafts])
}

/** Чтение вне React (storeProjection/хуки композера). */
export function draftFor(chatId: number): Draft | undefined {
  return useAppStateStore.getState().drafts.find((d) => d.chatId === chatId)
}

export function setDraft(d: Draft): void {
  const rest = useAppStateStore.getState().drafts.filter((x) => x.chatId !== d.chatId)
  setAppState('drafts', [...rest, d])
}

export function removeDraft(chatId: number): void {
  setAppState('drafts', useAppStateStore.getState().drafts.filter((d) => d.chatId !== chatId))
}

export function setAllDrafts(list: Draft[]): void {
  setAppState('drafts', list)
}

export async function loadDrafts(managers: { drafts: { list(): Promise<Draft[]> } }): Promise<void> {
  // Персист тут больше НЕ читаем: State уже поднят в boot.ts до рендера.
  // Остаётся только реконсайл поверх свежими данными сети.
  try {
    setAllDrafts(await managers.drafts.list())
  } catch {
    /* оффлайн — остаёмся на черновиках из State */
  }
}
