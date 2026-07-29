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

/**
 * UI side: managers.<name>.<method>(...args) -> RPC invoke.
 * Прокси-объекты менеджеров и их методы мемоизируются: `managers.x` и
 * `managers.x.y` возвращают стабильную ссылку между обращениями (раньше каждый
 * доступ создавал новый Proxy/функцию). Это и убирает аллокацию на каждый вызов
 * (188 обращений по коду), и даёт стабильную идентичность метода — безопасно
 * класть в deps хуков / прокидывать в мемоизированные компоненты.
 */
export function createManagers<T extends object>(smp: SuperMessagePort): T {
  const mgrCache = new Map<PropertyKey, object>()
  return new Proxy({}, {
    get: (_t, name: PropertyKey) => {
      let mgr = mgrCache.get(name)
      if (!mgr) {
        const methodCache = new Map<PropertyKey, (...args: unknown[]) => Promise<unknown>>()
        mgr = new Proxy({}, {
          get: (_t2, method: PropertyKey) => {
            let fn = methodCache.get(method)
            if (!fn) {
              fn = (...args: unknown[]) => smp.invoke('manager', { name: name as string, method: method as string, args })
              methodCache.set(method, fn)
            }
            return fn
          },
        })
        mgrCache.set(name, mgr)
      }
      return mgr
    },
  }) as T
}
