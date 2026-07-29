// src/core/hooks/uiEvents.ts
//
// Типизированная шина UI-событий (НЕ realtime). Realtime-апдейты идут ТОЛЬКО через
// типизированный eventBus (realtime/eventBus.ts) — доменные события сюда больше не
// ре-эмитятся. Здесь — чистые UI-команды: глобальный тост и сигнал «теги
// изменились». UiEventMap даёт точный тип payload без ручного каста.

export interface UiEventMap {
  'ui:toast': string
  'ui:savedTagsChanged': void
}
type UiEvent = keyof UiEventMap

class Emitter {
  private map = new Map<UiEvent, Set<(p: never) => void>>()
  on<K extends UiEvent>(event: K, cb: (payload: UiEventMap[K]) => void): () => void {
    const set = this.map.get(event) ?? new Set()
    set.add(cb as (p: never) => void); this.map.set(event, set)
    return () => { set.delete(cb as (p: never) => void) }
  }
  emit<K extends UiEvent>(event: K, payload: UiEventMap[K]): void {
    for (const cb of this.map.get(event) ?? []) (cb as (p: UiEventMap[K]) => void)(payload)
  }
}

export const uiEvents = new Emitter()
