// src/core/realtime/eventCatalog.test.ts
import { describe, it, expect } from 'vitest'
import { EVENT_CATALOG, FRAME_TYPES, PASS_THROUGH } from './eventCatalog'

describe('eventCatalog', () => {
  it('FRAME_TYPES covers every catalog wsType (no drift)', () => {
    expect(FRAME_TYPES.slice().sort()).toEqual(Object.keys(EVENT_CATALOG).sort())
  })

  it('includes the 13 types that FRAME_TYPES historically dropped', () => {
    // Регресс-гвард: раньше эти кадры молча дропались (не были в FRAME_TYPES),
    // logged-часть держалась на кросс-таб fake-эхо, снятом в Волне 4.
    const previouslyDropped = [
      'star_reaction', 'dialog_mute', 'checklist_update', 'chat_update', 'folder_update',
      'paid_media_unlock', 'balance_update', 'geo_live_update', 'suggested_post_update',
      'bot_callback_answer', 'story_new', 'story_deleted', 'story_reaction',
    ]
    for (const t of previouslyDropped) expect(FRAME_TYPES).toContain(t)
  })

  it('PASS_THROUGH = ровно эфемерные типы, каждый с rt', () => {
    const ephemeral = Object.entries(EVENT_CATALOG).filter(([, e]) => e.kind === 'ephemeral').map(([t]) => t)
    expect(Object.keys(PASS_THROUGH).sort()).toEqual(ephemeral.sort())
    for (const rt of Object.values(PASS_THROUGH)) expect(rt).toMatch(/^rt:/)
  })

  it('logged/bespoke типы НЕ попадают в PASS_THROUGH (идут через funnel/onFrame)', () => {
    expect(PASS_THROUGH['reaction']).toBeUndefined()   // logged
    expect(PASS_THROUGH['hello']).toBeUndefined()      // bespoke
    expect(PASS_THROUGH['new_message']).toBeUndefined() // bespoke
  })
})
