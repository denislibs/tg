// Настройки приватности на конструкторах схемы.
//
// Пин держит ровно то, ради чего порт делался:
//
//  • ключ адресуется КОНСТРУКТОРОМ (`privacyKeyStatusTimestamp`), а не нашей
//    строкой `last_seen`, и спрашивается по одному — как `account.getPrivacy`;
//  • настройка едет ВЕКТОРОМ правил, а не записью «значение строкой плюс два
//    списка исключений рядом»;
//  • исключения стоят ПЕРЕД базовым значением: правило после «всем» уже ничего
//    не изменило бы.
import { describe, expect, it, vi } from 'vitest'
import type { RestClient } from '../net/restClient'

import { fromPrivacyRules, newPrivacyManager, toPrivacyRules, type PrivacyRule } from './privacyManager'

const rules = (r: PrivacyRule) => ({ _: 'account.privacyRules', rules: toPrivacyRules(r), chats: [], users: [] })

describe('privacyManager', () => {
  // Реестр RPC зовёт метод ОТВЯЗАННЫМ (`rpc/managersProxy.ts`: `fn(...args)`), поэтому
  // метод менеджера не смеет опираться на `this`: `rules()` через `this.rule` падал в
  // воркере TypeError, `loadPrivacy` глотал отказ, стор правил не загружался никогда,
  // и хаб «Конфиденциальность» висел на «Загрузка…» (задача 23 плана 2D, стенд).
  it('rules() работает и отвязанным — так его зовёт реестр RPC', async () => {
    const get = vi.fn(async () => rules({ key: 'about', value: 'everybody', allowUserIds: [], denyUserIds: [] }))
    // oxlint-disable-next-line typescript/unbound-method -- отвязанный вызов и есть предмет теста
    const { rules: detached } = newPrivacyManager({ rest: { get } as unknown as RestClient })

    const list = await detached()

    expect(list).toHaveLength(12)
    expect(get).toHaveBeenCalledWith('/me/privacy/privacyKeyStatusTimestamp')
  })

  it('спрашивает ОДИН ключ и адресует его конструктором', async () => {
    const get = vi.fn(async () => rules({ key: 'last_seen', value: 'contacts', allowUserIds: [], denyUserIds: [] }))
    const mgr = newPrivacyManager({ rest: { get } as unknown as RestClient })

    const rule = await mgr.rule('last_seen')

    expect(get).toHaveBeenCalledWith('/me/privacy/privacyKeyStatusTimestamp')
    expect(rule).toEqual({ key: 'last_seen', value: 'contacts', allowUserIds: [], denyUserIds: [] })
  })

  it('сохранение шлёт ВЕКТОР правил, а не запись со строкой и двумя списками', async () => {
    const put = vi.fn(async () => rules({ key: 'about', value: 'nobody', allowUserIds: [7], denyUserIds: [] }))
    const mgr = newPrivacyManager({ rest: { put } as unknown as RestClient })

    await mgr.setRule({ key: 'about', value: 'nobody', allowUserIds: [7], denyUserIds: [8] })

    expect(put).toHaveBeenCalledWith('/me/privacy/privacyKeyAbout', {
      rules: [
        { _: 'privacyValueAllowUsers', users: [7] },
        { _: 'privacyValueDisallowUsers', users: [8] },
        { _: 'privacyValueDisallowAll' },
      ],
    })
  })

  it('исключения идут ПЕРЕД базовым значением', () => {
    const tags = toPrivacyRules({ key: 'about', value: 'everybody', allowUserIds: [1], denyUserIds: [2] }).map((r) => r._)
    expect(tags).toEqual(['privacyValueAllowUsers', 'privacyValueDisallowUsers', 'privacyValueAllowAll'])
  })

  it('круг «экран → вектор → экран» сходится', () => {
    for (const value of ['everybody', 'contacts', 'nobody'] as const) {
      const rule: PrivacyRule = { key: 'calls', value, allowUserIds: [3], denyUserIds: [4] }
      expect(fromPrivacyRules('calls', toPrivacyRules(rule))).toEqual(rule)
    }
  })

  // Два ключа адресуются НАШИМИ конструкторами: у оригинала предмет есть, но
  // двузначный (флаги globalPrivacySettings), а экран предлагает им тот же
  // выбор из трёх, что и остальным.
  it('наши два ключа тоже адресуются конструктором', async () => {
    const get = vi.fn(async () => rules({ key: 'messages', value: 'contacts', allowUserIds: [], denyUserIds: [] }))
    const mgr = newPrivacyManager({ rest: { get } as unknown as RestClient })

    await mgr.rule('messages')
    await mgr.rule('read_time')

    expect(get.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      '/me/privacy/privacyKeyMessages',
      '/me/privacy/privacyKeyReadTime',
    ])
  })

  // Порт `appProfileManager.getProfile` (tweb): ответ `users.getFullUser` несёт
  // вектор `users`, и оригинал сохраняет его (`saveApiUsers`) — вместе с
  // карточкой приезжает статус собеседника. Прежде вектор отбрасывался.
  it('чужой профиль сохраняет вектор users владельцу карточек', async () => {
    const bob = { _: 'user', id: 2, first_name: 'Боб', status: { _: 'userStatusOnline', expires: 100 } }
    const get = vi.fn(async () => ({ _: 'users.userFull', full_user: { _: 'userFull', id: 2 }, chats: [], users: [bob], can_message: true }))
    const saveApiPeers = vi.fn()
    const mgr = newPrivacyManager({ rest: { get } as unknown as RestClient, peers: { saveApiPeers } })

    const profile = await mgr.profile(2)

    expect(saveApiPeers).toHaveBeenCalledWith({ chats: [], users: [bob] })
    expect(profile.user).toEqual(bob)
  })

  // Порт `appUsersManager.getBlocked` (tweb :1128-1138): векторы ответа уходят
  // владельцу карточек (`saveApiUsers`/`saveApiChats`), наружу — пары
  // «сколько всего» и ключи пиров по порядку ответа.
  it('чёрный список: карточки — владельцу, наружу — count и peerIds', async () => {
    const alice = { _: 'user', id: 5, first_name: 'Алиса' }
    const bob = { _: 'user', id: 9, first_name: 'Боб' }
    const get = vi.fn(async () => ({
      _: 'contacts.blockedSlice',
      count: 7,
      blocked: [
        { _: 'peerBlocked', peer_id: { _: 'peerUser', user_id: 9 }, date: 1 },
        { _: 'peerBlocked', peer_id: { _: 'peerUser', user_id: 5 }, date: 2 },
      ],
      chats: [],
      users: [alice, bob],
    }))
    const saveApiPeers = vi.fn()
    const mgr = newPrivacyManager({ rest: { get } as unknown as RestClient, peers: { saveApiPeers } })

    const res = await mgr.getBlocked(50, 50)

    expect(get).toHaveBeenCalledWith('/me/blocked?offset=50&limit=50')
    expect(saveApiPeers).toHaveBeenCalledWith({ chats: [], users: [alice, bob] })
    expect(res).toEqual({ count: 7, peerIds: [9, 5] })
  })

  // Порт `appUsersManager.toggleBlock` (tweb :520-536): после ответа сервера —
  // МЕСТНЫЙ апдейт `updatePeerBlocked`, из которого воркер разводит `peer_block`
  // (`onUpdatePeerBlocked`, `appProfileManager.ts:1506-1532`): `blocked` в
  // `pFlags` есть только при блокировке.
  it('toggleBlock: блокировка — POST, разблокировка — DELETE; после ответа — местный updatePeerBlocked', async () => {
    const post = vi.fn(async () => ({ _: 'boolTrue' }))
    const del = vi.fn(async () => ({ _: 'boolTrue' }))
    const processLocalUpdate = vi.fn()
    const mgr = newPrivacyManager({ rest: { post, del } as unknown as RestClient, processLocalUpdate })

    await mgr.toggleBlock(9, true)
    expect(post).toHaveBeenCalledWith('/me/blocked', { user_id: 9 })
    expect(processLocalUpdate).toHaveBeenLastCalledWith({
      _: 'updatePeerBlocked', peer_id: { _: 'peerUser', user_id: 9 }, pFlags: { blocked: true },
    })

    await mgr.toggleBlock(9, false)
    expect(del).toHaveBeenCalledWith('/me/blocked/9')
    const last = processLocalUpdate.mock.lastCall![0]
    expect(last).toEqual({ _: 'updatePeerBlocked', peer_id: { _: 'peerUser', user_id: 9 } })
    expect(last).not.toHaveProperty('pFlags')
  })

  it('toggleBlock: отказ сервера — без апдейта', async () => {
    const post = vi.fn(async () => { throw new Error('user not found') })
    const processLocalUpdate = vi.fn()
    const mgr = newPrivacyManager({ rest: { post } as unknown as RestClient, processLocalUpdate })

    await expect(mgr.toggleBlock(9, true)).rejects.toThrow()
    expect(processLocalUpdate).not.toHaveBeenCalled()
  })

  // Порт `appPrivacyManager.setPrivacy` (:30-56): после ответа — местный
  // `updatePrivacy{key, rules}`, по которому воркер обновляет кэш и шлёт
  // `privacy_update`.
  it('setRule: после ответа — местный updatePrivacy с ключом-конструктором и вектором правил', async () => {
    const saved = { key: 'last_seen' as const, value: 'nobody' as const, allowUserIds: [7], denyUserIds: [] }
    const put = vi.fn(async () => rules(saved))
    const processLocalUpdate = vi.fn()
    const mgr = newPrivacyManager({ rest: { put } as unknown as RestClient, processLocalUpdate })

    const res = await mgr.setRule(saved)

    expect(res).toEqual(saved)
    expect(processLocalUpdate).toHaveBeenCalledTimes(1)
    expect(processLocalUpdate).toHaveBeenCalledWith({
      _: 'updatePrivacy',
      key: { _: 'privacyKeyStatusTimestamp' },
      rules: toPrivacyRules(saved),
    })
  })

  it('setRule: отказ сервера — без апдейта', async () => {
    const put = vi.fn(async () => { throw new Error('bad rule') })
    const processLocalUpdate = vi.fn()
    const mgr = newPrivacyManager({ rest: { put } as unknown as RestClient, processLocalUpdate })

    await expect(mgr.setRule({ key: 'about', value: 'nobody', allowUserIds: [], denyUserIds: [] })).rejects.toThrow()
    expect(processLocalUpdate).not.toHaveBeenCalled()
  })

  // Наш сервер шлёт кадр и инициатору (у Telegram он приходит в ответе). Если
  // кадр этого ключа успел прийти, пока шёл PUT, он НЕ старее ответа (или
  // новее — от другого устройства): местный апдейт затёр бы его.
  it('setRule: кадр этого ключа пришёл во время запроса — местный апдейт пропускается', async () => {
    const saved = { key: 'last_seen' as const, value: 'nobody' as const, allowUserIds: [], denyUserIds: [] }
    let version = 0
    const put = vi.fn(async () => { version++; return rules(saved) })
    const processLocalUpdate = vi.fn()
    const mgr = newPrivacyManager({
      rest: { put } as unknown as RestClient, processLocalUpdate, frameVersion: () => version,
    })

    const res = await mgr.setRule(saved)

    expect(res).toEqual(saved) // ответ вызывающему возвращается в любом случае
    expect(processLocalUpdate).not.toHaveBeenCalled()
  })

  it('toggleBlock: кадр этого пира пришёл во время запроса — местный апдейт пропускается', async () => {
    let version = 0
    const post = vi.fn(async () => { version++; return { _: 'boolTrue' } })
    const processLocalUpdate = vi.fn()
    const mgr = newPrivacyManager({
      rest: { post } as unknown as RestClient, processLocalUpdate, frameVersion: () => version,
    })

    await mgr.toggleBlock(9, true)

    expect(processLocalUpdate).not.toHaveBeenCalled()
  })
})
