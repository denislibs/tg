// Реестр маршрутизации кадров сверяется с ОБЕИМИ сторонами провода.
//
// Прежде полнота проверялась только внутри клиента: два рукописных списка
// (каталог типов и реестр APPLY) сверялись друг с другом компилятором, и
// сходились они даже тогда, когда оба разошлись с бэкендом. Здесь сверка идёт
// с источниками:
//
//  1. со СХЕМОЙ — каждый ключ реестра обязан быть конструктором (схемным либо
//     нашим, объявленным в schema_additional_params.json);
//  2. с ДОМЕНОМ БЭКЕНДА — набор ключей обязан совпадать с объединением Update,
//     которое бэкенд объявляет и производит (в домене объявлено ровно то, что
//     производится, — см. докблок над списком тегов).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import schema from '../../../../schema/schema.json'
import additionalParams from '../../../../schema/schema_additional_params.json'

import { CHANNEL_CURSOR, UPDATE_RT, channelPeerId, channelTwin, frameKey, updatePredicate } from './updateCatalog'
import { LOGGED_WITHOUT_CONSTRUCTOR, TRANSPORT_FRAMES } from './transportFrames'

const schemaPredicates = new Set(
  (schema.API.constructors as { predicate: string }[]).map((c) => c.predicate),
)
const ownPredicates = new Set(
  (additionalParams as { predicate: string; id?: string }[])
    .filter((c) => c.id !== undefined)
    .map((c) => c.predicate),
)

/** Теги объединения Update, объявленные доменом бэкенда. */
function backendUpdateTags(): string[] {
  // Путь от корня web-client (там же лежит vitest.config.ts, откуда идёт прогон).
  const src = readFileSync(resolve(process.cwd(), '../backend/internal/domain/mtupdate.go'), 'utf8')
  return [...src.matchAll(/^\tUpdate\w+Tag\s+= "(update\w+)"$/gm)].map((m) => m[1])
}

describe('updateCatalog', () => {
  it('каждый ключ реестра — конструктор схемы либо наш объявленный', () => {
    for (const predicate of Object.keys(UPDATE_RT)) {
      expect(
        schemaPredicates.has(predicate) || ownPredicates.has(predicate),
        `${predicate} не объявлен ни в схеме, ни в надстройках`,
      ).toBe(true)
    }
  })

  it('реестр покрывает РОВНО те конструкторы, что объявляет домен бэкенда', () => {
    expect(Object.keys(UPDATE_RT).sort()).toEqual(backendUpdateTags().sort())
  })

  it('каждому конструктору назначено rt-событие', () => {
    for (const rt of Object.values(UPDATE_RT)) expect(rt).toMatch(/^rt:/)
  })

  it('канальный курсор — только у канальных конструкторов, и все они в реестре', () => {
    for (const predicate of CHANNEL_CURSOR) {
      expect(Object.keys(UPDATE_RT)).toContain(predicate)
      expect(predicate).toMatch(/Channel/)
    }
    // Пара «предмет один, журнала два» обязана быть разведена: одноимённые
    // конструкторы пер-юзерного журнала в канальный набор не попадают.
    expect(CHANNEL_CURSOR.has('updateNewMessage')).toBe(false)
    expect(CHANNEL_CURSOR.has('updateChatFullSnapshot')).toBe(false)
  })

  it('updatePredicate узнаёт кадр по дискриминатору и молчит на чужом теле', () => {
    expect(updatePredicate({ _: 'updateDialogPinned' })).toBe('updateDialogPinned')
    expect(updatePredicate({ _: 'сочинённыйКонструктор' })).toBeUndefined()
    expect(updatePredicate({ id: 1, title: 'папка' })).toBeUndefined()
    expect(updatePredicate(null)).toBeUndefined()
  })

  it('frameKey берёт КОНСТРУКТОР, а тип конверта — только у кадра без него', () => {
    expect(frameKey('dialog_pin', { _: 'updateDialogPinned' })).toBe('updateDialogPinned')
    // Единственный запасной ответ — непортированный предмет (#51).
    expect(frameKey(LOGGED_WITHOUT_CONSTRUCTOR, { id: 1, title: 'папка' })).toBe(LOGGED_WITHOUT_CONSTRUCTOR)
  })

  it('кадры без конструктора и кадры-апдейты не пересекаются', () => {
    for (const t of Object.keys(TRANSPORT_FRAMES)) expect(UPDATE_RT).not.toHaveProperty(t)
  })
})

// Ф-2: правка, удаление и закреп поста broadcast-канала едут журналом канала
// своими конструкторами схемы. Курсор у них канальный, а предмет — тот же, что
// у пер-юзерной пары: tweb разбирает обе одним обработчиком.
describe('канальные близнецы', () => {
  it('канальные — в канальном курсоре, ключ канала читается', () => {
    for (const p of ['updateEditChannelMessage', 'updateDeleteChannelMessages', 'updatePinnedChannelMessages']) {
      expect(CHANNEL_CURSOR.has(p)).toBe(true)
    }
    expect(CHANNEL_CURSOR.has('updateEditMessage')).toBe(false)
    expect(channelPeerId({ _: 'updateDeleteChannelMessages', channel_id: 42, messages: [3], pts: 9 })).toBe(-42)
    expect(channelPeerId({ _: 'updatePinnedChannelMessages', channel_id: 42, messages: [3], pts: 9 })).toBe(-42)
    expect(channelPeerId({
      _: 'updateEditChannelMessage', pts: 9,
      message: { _: 'message', id: 3, date: 1, message: 'x', peer_id: { _: 'peerChannel', channel_id: 42 }, pFlags: {} },
    } as never)).toBe(-42)
  })

  it('channelTwin переводит в форму пары, сохраняя номера, бит и pts', () => {
    expect(channelTwin({ _: 'updateDeleteChannelMessages', channel_id: 42, messages: [3, 4], pts: 9 })).toEqual({
      _: 'updateDeletePeerMessages', peer: { _: 'peerChannel', channel_id: 42 }, messages: [3, 4], pts: 9,
    })
    expect(channelTwin({ _: 'updatePinnedChannelMessages', pFlags: { pinned: true }, channel_id: 42, messages: [3], pts: 10 })).toEqual({
      _: 'updatePinnedMessages', pFlags: { pinned: true }, peer: { _: 'peerChannel', channel_id: 42 }, messages: [3], pts: 10,
    })
    // «Открепили» — отсутствие бита и у пары.
    expect(channelTwin({ _: 'updatePinnedChannelMessages', channel_id: 42, messages: [3], pts: 11 })).not.toHaveProperty('pFlags')
    const msg = { _: 'message', id: 3, date: 1, message: 'x', peer_id: { _: 'peerChannel', channel_id: 42 }, pFlags: {} }
    expect(channelTwin({ _: 'updateEditChannelMessage', message: msg, pts: 12 } as never)).toEqual({ _: 'updateEditMessage', message: msg, pts: 12 })
    expect(channelTwin({ _: 'updateEditMessage', message: msg, pts: 12 } as never)).toBeUndefined()
  })
})
