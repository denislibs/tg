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
})
