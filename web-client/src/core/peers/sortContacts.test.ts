// Порт tweb `src/tests/sortContacts.test.ts` (812502980, коммит ee6f7f9c2) — те же случаи и
// ожидания; карточки — наш `UserReal`, `toPeerId()`/`toUserId()` сняты (ключи — числа).
import { describe, expect, it } from 'vitest'
import removeAccents from '@helpers/string/removeAccents'
import type { UserReal, UserStatus } from '@core/peers/peer'
import sortContacts, { getNameSortKey, getNameSortSection, getUserSortName } from './sortContacts'

const NOW = 1_700_000_000

let lastId = 0
function makeUser(firstName: string, lastName?: string, status?: UserStatus): UserReal {
  return {
    _: 'user',
    id: ++lastId,
    first_name: firstName,
    last_name: lastName,
    pFlags: {},
    status,
  }
}

function sort(users: UserReal[], mode: Parameters<typeof sortContacts>[1]) {
  const byId = new Map(users.map((user) => [user.id, user]))
  const result = sortContacts(users.map((user) => user.id), mode, (userId) => byId.get(userId))
  return {
    names: result.peerIds.map((peerId) => getUserSortName(byId.get(peerId)!)),
    sections: result.sections,
  }
}

describe('removeAccents', () => {
  it('folds accented letters down to the plain ones, lower case as tdesktop\'s table has them', () => {
    expect(removeAccents('Émile Zoë Łukasz Ølga')).toBe('emile Zoe lukasz olga')
  })

  it('drops combining marks', () => {
    expect(removeAccents('é')).toBe('e')
  })

  it('keeps tdesktop\'s own quirks - Ĺ folds to a, and ё but not Ё to е', () => {
    expect(removeAccents('Ĺ')).toBe('a')
    expect(removeAccents('ё')).toBe('е')
    expect(removeAccents('Ё')).toBe('Ё')
    expect(removeAccents('й')).toBe('й')
  })

  it('lets a surrogate pair through as it is', () => {
    expect(removeAccents('😀 é')).toBe('😀 e')
  })
})

describe('contacts sort key', () => {
  it('is "first last", or the last name alone for a blank first one', () => {
    expect(getUserSortName(makeUser('Anna', 'Smith'))).toBe('Anna Smith')
    expect(getUserSortName(makeUser('Anna'))).toBe('Anna')
    expect(getUserSortName(makeUser(' ', 'Smith'))).toBe('Smith')
  })

  it('is the name without accents, in lower case', () => {
    expect(getNameSortKey('Émile Smith')).toBe('emile smith')
  })

  it('is sectioned by its first letter in upper case, and by # otherwise', () => {
    expect(getNameSortSection('emile')).toBe('E')
    expect(getNameSortSection('юрий')).toBe('Ю')
    expect(getNameSortSection('(mom)')).toBe('#')
    expect(getNameSortSection('123')).toBe('#')
    expect(getNameSortSection('')).toBe('#')
    // half of a surrogate pair is no letter
    expect(getNameSortSection('😀 smile')).toBe('#')
    // one unit stays one unit
    expect(getNameSortSection('ßtefan')).toBe('ß')
  })
})

describe('sortContacts', () => {
  it('orders by name unit by unit, not by locale - latin before cyrillic, case and accents folded', () => {
    const { names, sections } = sort([
      makeUser('Юрий'),
      makeUser('bob'),
      makeUser('Émile'),
      makeUser('Anna'),
      makeUser('Борис'),
      makeUser('(Mom)'),
    ], 'name')

    expect(names).toEqual(['Anna', 'bob', 'Émile', 'Борис', 'Юрий', '(Mom)'])
    expect(sections).toEqual(['A', 'B', 'E', 'Б', 'Ю', '#'])
  })

  it('gathers every name that does not start with a letter in one # section at the end', () => {
    // in tdesktop's order the digit comes before the letters and the emoji after all of them
    const { names, sections } = sort([
      makeUser('😀 Smile'),
      makeUser('Anna'),
      makeUser('123 Pizza'),
      makeUser('Юрий'),
      makeUser('_under'),
    ], 'name')

    expect(names).toEqual(['Anna', 'Юрий', '123 Pizza', '_under', '😀 Smile'])
    expect(sections).toEqual(['A', 'Ю', '#', '#', '#'])
  })

  it('orders by last seen, the ones seen alike in the order by name', () => {
    const { names, sections } = sort([
      makeUser('Carl', undefined, { _: 'userStatusOffline', was_online: NOW - 60 }),
      makeUser('Zoe', undefined, { _: 'userStatusOnline', expires: NOW + 60 }),
      makeUser('Bob', undefined, { _: 'userStatusRecently', pFlags: {} }),
      makeUser('Anna', undefined, { _: 'userStatusRecently', pFlags: {} }),
      makeUser('Dora'),
      makeUser('Eve', undefined, { _: 'userStatusLastMonth', pFlags: {} }),
    ], 'online')

    expect(names).toEqual(['Zoe', 'Carl', 'Anna', 'Bob', 'Eve', 'Dora'])
    expect(sections).toBeUndefined()
  })
})
