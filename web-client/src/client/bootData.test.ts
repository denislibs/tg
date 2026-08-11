// Префетч старта страницы одноразовый по смыслу (промисы разрешены данными
// аккаунта, под которым страница загрузилась), но НЕ по коду: `Shell`
// монтируется заново на каждое `authed: false → true` (App.tsx рендерит его
// условно), вместе с ним заново отрабатывает `useAppBootstrap` — и второй раз
// тот же префетч уже врёт. `loadChats` записал бы личность и чаты прошлого
// аккаунта, затерев только что приехавший `rt:me` нового; детерминированной
// коррекции у этого нет. Поэтому единственный доступ — через bootPrefetch(),
// а переходы сессии его обесценивают (см. useAuthGate.test.tsx — там пинится,
// что обработчики это делают, и оба достижимых сценария порчи).
import { describe, expect, it, beforeEach } from 'vitest'
import { bootPrefetch, invalidateBootPrefetch, setBootData } from './bootData'
import type { User } from '../core/managers/authManager'
import type { Dialog } from '../core/models'

const me = Promise.resolve(null as User | null)
const dialogs = Promise.resolve([] as Dialog[])

beforeEach(() => {
  setBootData({ me, dialogs, hydratedFromCache: false, hasToken: true, locked: false })
})

describe('bootPrefetch', () => {
  it('отдаёт префетч старта, пока сессия не менялась', () => {
    expect(bootPrefetch()).toEqual({ me, dialogs })
  })

  it('после смены сессии — null: второй потребитель пойдёт в сеть под текущим токеном', () => {
    invalidateBootPrefetch()
    expect(bootPrefetch()).toBeNull()
  })

  it('под пасскодом — null: там префетча не делали, в bootData пустышки', () => {
    setBootData({ me, dialogs, hydratedFromCache: false, hasToken: true, locked: true })
    expect(bootPrefetch()).toBeNull()
  })

  it('новый boot возвращает действительность: перезагрузка подняла свежий префетч', () => {
    invalidateBootPrefetch()
    setBootData({ me, dialogs, hydratedFromCache: false, hasToken: true, locked: false })
    expect(bootPrefetch()).toEqual({ me, dialogs })
  })
})
