// Префетч старта страницы одноразовый по смыслу (промис разрешён данными
// аккаунта, под которым страница загрузилась), но НЕ по коду: `Shell`
// монтируется заново на каждое `authed: false → true` (App.tsx рендерит его
// условно), вместе с ним заново отрабатывает `useAppBootstrap` — и второй раз
// тот же префетч уже врёт. `loadChats` записал бы личность прошлого
// аккаунта, затерев только что приехавший `rt:me` нового; детерминированной
// коррекции у этого нет. Поэтому единственный доступ — через bootPrefetch(),
// а переходы сессии его обесценивают (см. useAuthGate.test.tsx — там пинится,
// что обработчики это делают, и оба достижимых сценария порчи).
//
// Fix (ревью Task 6, Important #1): поле `dialogs` из BootData/bootPrefetch()
// снесено — диалогами владеет dialogsManager, префетчить их отдельно незачем
// (см. докблок bootPrefetch в bootData.ts).
import { describe, expect, it, beforeEach } from 'vitest'
import { bootPrefetch, invalidateBootPrefetch, setBootData } from './bootData'
import type { User } from '../core/managers/authManager'

const me = Promise.resolve(null as User | null)

beforeEach(() => {
  setBootData({ me, hydratedFromCache: false, hasToken: true, locked: false })
})

describe('bootPrefetch', () => {
  it('отдаёт префетч старта, пока сессия не менялась', () => {
    expect(bootPrefetch()).toEqual({ me })
  })

  it('после смены сессии — null: второй потребитель пойдёт в сеть под текущим токеном', () => {
    invalidateBootPrefetch()
    expect(bootPrefetch()).toBeNull()
  })

  it('под пасскодом — null: там префетча не делали, в bootData пустышки', () => {
    setBootData({ me, hydratedFromCache: false, hasToken: true, locked: true })
    expect(bootPrefetch()).toBeNull()
  })

  it('новый boot возвращает действительность: перезагрузка подняла свежий префетч', () => {
    invalidateBootPrefetch()
    setBootData({ me, hydratedFromCache: false, hasToken: true, locked: false })
    expect(bootPrefetch()).toEqual({ me })
  })
})
