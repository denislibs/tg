// src/core/realtime/eventCatalog.test.ts
import { describe, it, expect } from 'vitest'
import { EVENT_CATALOG, PASS_THROUGH } from './eventCatalog'

describe('eventCatalog', () => {
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
