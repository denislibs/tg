// src/core/hooks/uiEvents.ts
type Cb = (payload: unknown) => void

class Emitter {
  private map = new Map<string, Set<Cb>>()
  on(event: string, cb: Cb): () => void {
    const set = this.map.get(event) ?? new Set()
    set.add(cb); this.map.set(event, set)
    return () => set.delete(cb)
  }
  emit(event: string, payload: unknown): void {
    for (const cb of this.map.get(event) ?? []) cb(payload)
  }
}

export const uiEvents = new Emitter()
