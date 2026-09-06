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
 * Прототип-метка «это RPC-хендл, а не данные».
 *
 * Рантаймы, которые сами решают, что можно завернуть, отличают «обычный
 * объект» по прототипу: у Solid-стора `isWrappable(obj)` истинна, когда
 * прототип — ровно `Object.prototype` (плюс массивы и уже обёрнутые объекты)
 * (`solid-js/store@1.9.15 dist/store.js:37-40`, та же проверка в `dev.js:41-44`
 * и в SSR-сборке `server.js:2-4`). Инстанс класса и DOM-узел под неё не
 * попадают и едут ПО ССЫЛКЕ — ровно то, что нужно хендлу.
 *
 * Цель наших прокси поэтому создаётся не литералом `{}`, а
 * `Object.create(HANDLE_PROTO)`: прототип — не `Object.prototype`, значит
 * `createStore` в мосте `mountSolid` не заворачивает `props.managers` своим
 * прокси и не пишет на нашу цель служебные свойства, а компонент получает
 * РОВНО тот объект, который ему передали (`props.managers === managers`).
 * Это снимает весь класс проблемы, а не один символ; ловушки ниже держат
 * инвариант прокси и на случай, если чужой рантайм всё-таки полезет внутрь.
 */
const HANDLE_PROTO: object = Object.freeze({})

/**
 * UI side: managers.<name>.<method>(...args) -> RPC invoke.
 * Прокси-объекты менеджеров и их методы мемоизируются: `managers.x` и
 * `managers.x.y` возвращают стабильную ссылку между обращениями (раньше каждый
 * доступ создавал новый Proxy/функцию). Это и убирает аллокацию на каждый вызов
 * (188 обращений по коду), и даёт стабильную идентичность метода — безопасно
 * класть в deps хуков / прокидывать в мемоизированные компоненты.
 *
 * Символьные ключи обе ловушки отдают через `Reflect.get`, то есть ровно то,
 * что РЕАЛЬНО лежит на цели, — и ничего не выдумывают. Правило закрывает две
 * противоположные поломки сразу:
 *
 *  • Символа на цели нет → `undefined`. Имена менеджеров и методов на проводе
 *    (`ManagerCall`) всегда строки, а символы приходят от чужих рантаймов как
 *    служебный протокол (`$RAW`/`$PROXY`/`$NODE` у Solid-стора,
 *    `Symbol.toPrimitive`, `Symbol.iterator`). Ответ «да, есть» на такой ключ
 *    рантайм принимает за настоящее служебное значение: `unwrap` в
 *    `createStore` подменял ответом на `$RAW` сам объект менеджеров, и в
 *    компоненте `managers.auth` становился `undefined` — весь экран входа гас.
 *
 *  • Символ на цели есть → его настоящее значение. Своё служебное свойство
 *    рантайм кладёт через `Object.defineProperty`, а ловушки `defineProperty`
 *    у нас нет — значит свойство ложится прямо на цель, и по умолчанию оно
 *    non-writable + non-configurable. Для таких свойств спецификация ТРЕБУЕТ,
 *    чтобы `get` вернул их значение (ECMA-262, §10.5.8, шаг 10.b.i): ответ
 *    `undefined` — нарушение инварианта, движок бросает `TypeError: 'get' on
 *    proxy: property … is a read-only and non-configurable data property`.
 *    Именно так гас экран входа во второй раз: первое чтение `props.managers`
 *    определяло `Symbol(solid-proxy)` на цели, второе — падало.
 */
export function createManagers<T extends object>(smp: SuperMessagePort): T {
  const mgrCache = new Map<string, object>()
  return new Proxy(Object.create(HANDLE_PROTO) as object, {
    get: (target, name: string | symbol) => {
      if (typeof name === 'symbol') return Reflect.get(target, name)
      let mgr = mgrCache.get(name)
      if (!mgr) {
        const methodCache = new Map<string, (...args: unknown[]) => Promise<unknown>>()
        mgr = new Proxy(Object.create(HANDLE_PROTO) as object, {
          get: (mgrTarget, method: string | symbol) => {
            if (typeof method === 'symbol') return Reflect.get(mgrTarget, method)
            let fn = methodCache.get(method)
            if (!fn) {
              fn = (...args: unknown[]) => smp.invoke('manager', { name, method, args })
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
