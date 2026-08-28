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
//
// Fix (финальное ревью, Important #3 + Minor #1): вместо снятого мёртвого
// `hydratedFromCache` в BootData/bootPrefetch() ездит `dialogsReady` — промис
// уже запущенного boot'ом сетевого догона, на котором висит сид презенса
// (useAppBootstrap). Он так же одноразов, как `me`, и потому подчиняется тому
// же правилу инвалидации.
import { describe, expect, it, beforeEach } from 'vitest'
import { bootPrefetch, invalidateBootPrefetch, setBootData } from './bootData'
import type { PeerProfile } from '../core/managers/authManager'

const me = Promise.resolve(null as PeerProfile | null)
const dialogsReady = Promise.resolve()

beforeEach(() => {
  setBootData({ me, dialogsReady, hasToken: true, locked: false })
})

describe('bootPrefetch', () => {
  it('отдаёт префетч старта, пока сессия не менялась', () => {
    // Именно ПО ССЫЛКЕ: `toEqual` двум разным промисам без собственных полей
    // не различает (у Promise нет перечислимых свойств), а подмена
    // `dialogsReady` на свежий `Promise.resolve()` — ровно тот дефект, из-за
    // которого презенс сеялся бы до ответа сети (Important #3).
    const pre = bootPrefetch()
    expect(pre?.me).toBe(me)
    expect(pre?.dialogsReady).toBe(dialogsReady)
  })

  it('после смены сессии — null: второй потребитель пойдёт в сеть под текущим токеном', () => {
    invalidateBootPrefetch()
    expect(bootPrefetch()).toBeNull()
  })

  it('под пасскодом — null: там префетча не делали, в bootData пустышки', () => {
    setBootData({ me, dialogsReady, hasToken: true, locked: true })
    expect(bootPrefetch()).toBeNull()
  })

  it('новый boot возвращает действительность: перезагрузка подняла свежий префетч', () => {
    invalidateBootPrefetch()
    setBootData({ me, dialogsReady, hasToken: true, locked: false })
    expect(bootPrefetch()?.dialogsReady).toBe(dialogsReady)
  })
})
