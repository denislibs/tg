// src/core/hooks/useManagers.tsx
//
// DI for the manager layer (the command/query surface to the worker). React code
// reads managers through useManagers() instead of calling startClient() directly,
// so presentation logic isn't bolted to the transport and hooks/components become
// testable with mock managers (renderHook inside a <ManagersProvider managers={…}>).
//
// Direct analogue of tweb's rootScope.managers (its DI handle). Non-React code
// (stores, worker setup, module-level utils) keeps calling startClient() — DI is
// only for the React tree.
import { createContext, useContext, type ReactNode } from 'react'
import type { Managers } from '../../client/bootstrap'

const ManagersContext = createContext<Managers | null>(null)

export function ManagersProvider({ managers, children }: { managers: Managers; children: ReactNode }) {
  return <ManagersContext.Provider value={managers}>{children}</ManagersContext.Provider>
}

export function useManagers(): Managers {
  const m = useContext(ManagersContext)
  if (!m) throw new Error('useManagers must be used within <ManagersProvider>')
  return m
}
