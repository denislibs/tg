import type { SuperMessagePort } from './superMessagePort'

interface ManagerCall { name: string; method: string; args: unknown[] }

/**
 * Worker side: dispatch invoke('manager', {name,method,args}) to a manager object.
 * Принимает реестр как есть (объект менеджеров с любыми сигнатурами) — вызывающий
 * держит его типизированным, из этого же объекта выводится UI-тип Managers, так
 * что каст здесь локальный и не размывает контракт границы.
 */
export function registerManagers(smp: SuperMessagePort, registry: Record<string, object>): void {
  smp.handle('manager', (payload) => {
    const { name, method, args } = payload as ManagerCall
    const mgr = registry[name] as Record<string, unknown> | undefined
    const fn = mgr?.[method]
    if (typeof fn !== 'function') throw new Error(`no manager method: ${name}.${method}`)
    return (fn as (...a: unknown[]) => unknown)(...args)
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
