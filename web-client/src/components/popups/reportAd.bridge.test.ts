// Мост жалобы кладёт в стор ВСЕ выбранные сообщения (tweb reportAd.tsx:360-366
// шлёт messages.report с полным вектором), а не первое из них.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useReportStore } from '@stores/reportStore'
import { showMessageReport, showPeerReport } from './reportAd.bridge'

afterEach(() => useReportStore.getState().close())

describe('reportAd.bridge', () => {
  it('showMessageReport: в цель попадают все выбранные mid', () => {
    const onFinish = vi.fn()
    showMessageReport(-9 as PeerId, [101, 102], onFinish)

    expect(useReportStore.getState().target).toEqual({ peerId: -9, mids: [101, 102] })
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('showMessageReport: без сообщений попап не открывается', () => {
    showMessageReport(-9 as PeerId, [])

    expect(useReportStore.getState().target).toBeNull()
  })

  it('showPeerReport: жалоба на чат — пустой вектор', () => {
    showPeerReport(-9 as PeerId)

    expect(useReportStore.getState().target).toEqual({ peerId: -9, mids: [] })
  })
})
