import { create } from 'zustand'
import type { HealthStatus } from '../core/managers/healthManager'

interface ConnectionState {
  backendOk: boolean | null
  setBackendOk: (ok: boolean) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  backendOk: null,
  setBackendOk: (ok) => set({ backendOk: ok }),
}))

// Ping the backend through the worker; called once at startup.
export async function pingBackend(managers: { health: { check(): Promise<HealthStatus> } }): Promise<void> {
  try {
    const h = await managers.health.check()
    useConnectionStore.getState().setBackendOk(h.status === 'ok')
  } catch {
    useConnectionStore.getState().setBackendOk(false)
  }
}
