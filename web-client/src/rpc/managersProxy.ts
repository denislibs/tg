import type { SuperMessagePort } from './superMessagePort'

interface ManagerCall { name: string; method: string; args: unknown[] }

/** Worker side: dispatch invoke('manager', {name,method,args}) to a manager object. */
export function registerManagers(smp: SuperMessagePort, registry: Record<string, Record<string, (...a: unknown[]) => unknown>>): void {
  smp.handle('manager', (payload) => {
    const { name, method, args } = payload as ManagerCall
    const mgr = registry[name]
    if (!mgr || typeof mgr[method] !== 'function') throw new Error(`no manager method: ${name}.${method}`)
    return mgr[method](...args)
  })
}

/** UI side: managers.<name>.<method>(...args) -> RPC invoke. */
export function createManagers<T extends object>(smp: SuperMessagePort): T {
  return new Proxy({}, {
    get: (_t, name: string) =>
      new Proxy({}, {
        get: (_t2, method: string) =>
          (...args: unknown[]) => smp.invoke('manager', { name, method, args }),
      }),
  }) as T
}
