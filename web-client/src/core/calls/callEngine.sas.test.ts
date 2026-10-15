// Б-1 (М3-1): эмодзи звонка 1:1 считаются от DH и обещанных отпечатков DTLS обеих сторон под
// коммитментом звонящего; любой провал протокола фатален (без отката на звонок без бейджа).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPair, exportPublicKey, b64FromBytes } from '../secret/crypto'
import {
  connectPair, createNet, FakePC, fpOfTag, PEER_OF, pcOf, sdpWithFp, settle, startPair, until, type Frame, type Net,
} from './callTestKit'

let net: Net

beforeEach(() => {
  FakePC.reset()
  vi.stubGlobal('RTCPeerConnection', FakePC)
  net = createNet()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('../../client/bootstrap')
  vi.doUnmock('../audio/sounds')
})

const FAKE_FP = 'sha-256 DE:AD:BE:EF'
const reasonsOf = (frames: Frame[]) => frames.map((f) => f.data.reason)

describe('честный звонок', () => {
  it('у обеих сторон одинаковые 12 эмодзи; pc создан со своим сертификатом', async () => {
    const { A, B } = await connectPair(net)
    const ea = A.call()!.e2eFingerprint!
    const eb = B.call()!.e2eFingerprint!
    expect(ea).toHaveLength(12)
    expect(ea).toEqual(eb)
    await until(() => !!pcOf(A)?.remoteDescription && !!pcOf(B)?.remoteDescription, 'sdp round trip')
    const pa = pcOf(A)!
    const pb = pcOf(B)!
    expect(pa.remoteDescription!.type).toBe('answer')
    expect(pb.remoteDescription!.type).toBe('offer')
    // обещанное = сертификат, с которым создан pc
    expect(A.frames('call_signal').find((f) => f.data.dh_reveal)!.data.dtls).toEqual([fpOfTag(pa.cert)])
    expect(B.frames('call_accept')[0].data.dtls).toEqual([fpOfTag(pb.cert)])
  })

  it('call_request несёт dh_hash и не несёт dh; сертификат сгенерирован до кадра', async () => {
    const A = await net.side(1)
    const gen = vi.fn(FakePC.generateCertificate)
    FakePC.generateCertificate = gen
    A.engine.startOutgoing(PEER_OF(2), false)
    await until(() => A.frames('call_request').length === 1, 'call_request')
    const req = A.frames('call_request')[0].data
    expect(typeof req.dh_hash).toBe('string')
    expect(req.dh).toBeUndefined()
    expect(gen).toHaveBeenCalledTimes(1)
    A.engine.hangup()
  })

  it('звонящий раскрывает ключ первым кадром call_signal, до своего SDP', async () => {
    const { A } = await connectPair(net)
    await until(() => A.frames('call_signal').some((f) => f.data.sdp), 'offer')
    const sigs = A.frames('call_signal')
    expect(sigs[0].data.dh_reveal).toBeTypeOf('string')
    expect(sigs[0].data.dtls).toBeInstanceOf(Array)
    expect(sigs.findIndex((f) => f.data.sdp)).toBeGreaterThan(0)
  })
})

describe('подмена отпечатков после обещания (посредник на реле)', () => {
  it('а) dtls в dh_reveal заменён: отвечающий видит провал коммитмента, SAS не выставлен', async () => {
    net.tamper = (_f, _t, f) => [f.type === 'call_signal' && f.data.dh_reveal ? { ...f, data: { ...f.data, dtls: [FAKE_FP] } } : f]
    const A = await net.side(1); const B = await net.side(2)
    A.engine.startOutgoing(PEER_OF(2), false)
    await until(() => B.call()?.phase === 'incoming', 'incoming')
    B.engine.accept()
    await until(() => B.call()?.endReason === 'failed', 'B failed')
    expect(B.call()!.e2eFingerprint).toBeUndefined()
    expect(reasonsOf(B.frames('call_end'))).toEqual(['disconnect'])
  })

  it('а2) подмена согласованная: dtls в dh_reveal и a=fingerprint в offer одним набором — коммитмент ловит', async () => {
    net.tamper = (_f, to, f) => {
      if (to !== 2 || f.type !== 'call_signal') return [f]
      if (f.data.dh_reveal) return [{ ...f, data: { ...f.data, dtls: [FAKE_FP] } }]
      if ((f.data.sdp as { type?: string } | undefined)?.type === 'offer') {
        return [{ ...f, data: { ...f.data, sdp: { type: 'offer', sdp: sdpWithFp(FAKE_FP) } } }]
      }
      return [f]
    }
    const { B } = await startPair(net)
    await until(() => B.call()?.endReason === 'failed', 'B failed on commitment')
    expect(B.call()!.e2eFingerprint).toBeUndefined()
    expect(pcOf(B)?.remoteDescription ?? null).toBeNull()
  })

  it('б) dtls в call_accept заменён: настоящий answer не совпадает с обещанным, звонок рвётся', async () => {
    net.tamper = (_f, _t, f) => [f.type === 'call_accept' ? { ...f, data: { ...f.data, dtls: [FAKE_FP] } } : f]
    const A = await net.side(1); const B = await net.side(2)
    A.engine.startOutgoing(PEER_OF(2), false)
    await until(() => B.call()?.phase === 'incoming', 'incoming')
    B.engine.accept()
    await until(() => A.call()?.endReason === 'failed', 'A failed')
    expect(A.call()!.e2eFingerprint).toBeUndefined()
    expect(reasonsOf(A.frames('call_end'))).toEqual(['disconnect'])
  })

  it('б2) подмена согласованная (call_accept и SDP-answer одним посредником): эмодзи у сторон РАЗНЫЕ', async () => {
    net.tamper = (_f, to, f) => {
      if (f.type === 'call_accept') return [{ ...f, data: { ...f.data, dtls: [FAKE_FP] } }]
      // весь SDP отвечающего (его offer при glare и answer) — с отпечатком посредника
      const sdp = f.data.sdp as { type?: RTCSdpType } | undefined
      if (to === 1 && f.type === 'call_signal' && sdp?.type) {
        return [{ ...f, data: { ...f.data, sdp: { type: sdp.type, sdp: sdpWithFp(FAKE_FP) } } }]
      }
      return [f]
    }
    const { A, B } = await connectPair(net)
    // звонок «соединяется» с посредником, но сверка голосом выдаёт подмену
    expect(A.call()!.e2eFingerprint).not.toEqual(B.call()!.e2eFingerprint)
  })

  it('в) a=fingerprint в SDP заменён, dtls нетронут: получатель рвёт звонок', async () => {
    net.tamper = (_f, to, f) => {
      const sdp = f.data.sdp as { type?: string } | undefined
      if (to === 2 && f.type === 'call_signal' && sdp?.type === 'offer') {
        return [{ ...f, data: { ...f.data, sdp: { type: 'offer', sdp: sdpWithFp(FAKE_FP) } } }]
      }
      return [f]
    }
    const { B } = await startPair(net)
    await until(() => B.call()?.endReason === 'failed', 'B failed on forged offer')
    expect(B.call()!.e2eFingerprint).toBeUndefined()
    expect(reasonsOf(B.frames('call_end'))).toEqual(['disconnect'])
  })

  it('SDP-answer с чужим отпечатком рвёт звонок у звонящего', async () => {
    net.tamper = (_f, to, f) => {
      const sdp = f.data.sdp as { type?: string } | undefined
      if (to === 1 && f.type === 'call_signal' && sdp?.type === 'answer') {
        return [{ ...f, data: { ...f.data, sdp: { type: 'answer', sdp: sdpWithFp(FAKE_FP) } } }]
      }
      return [f]
    }
    const { A } = await startPair(net)
    await until(() => A.call()?.endReason === 'failed', 'A failed on forged answer')
    expect(reasonsOf(A.frames('call_end'))).toEqual(['disconnect'])
  })

  it('повторный offer по ходу звонка с необещанным отпечатком рвёт звонок', async () => {
    const { B } = await connectPair(net)
    await until(() => !!pcOf(B)?.remoteDescription, 'first offer applied')
    B.engine.handleFrame({
      t: 'call_signal',
      d: { call_id: B.call()!.callId, from_user_id: 1, sdp: { type: 'offer', sdp: sdpWithFp(FAKE_FP) } },
    } as never)
    await until(() => B.call()?.endReason === 'failed', 'B failed on renegotiation')
  })
})

describe('скрытый отпечаток в SDP (браузер разбирает мягче нашего регэкспа)', () => {
  it.each([
    ['пробел после двоеточия', (fp: string) => `a=fingerprint: ${fp}`],
    ['табуляция', (fp: string) => `a=fingerprint:\t${fp}`],
    ['хвостовой пробел', (fp: string) => `a=fingerprint:${fp} `],
  ])('offer с обещанным отпечатком и скрытым вторым (%s): звонок рвётся', async (_n, hidden) => {
    net.tamper = (_f, to, f) => {
      const sdp = f.data.sdp as { type?: string; sdp?: string } | undefined
      if (to === 2 && f.type === 'call_signal' && sdp?.type === 'offer') {
        return [{ ...f, data: { ...f.data, sdp: { type: 'offer', sdp: `${sdp.sdp}${hidden(FAKE_FP)}\r\n` } } }]
      }
      return [f]
    }
    const { B } = await startPair(net)
    await until(() => B.call()?.endReason === 'failed', 'B failed on hidden fingerprint')
    expect(reasonsOf(B.frames('call_end'))).toEqual(['disconnect'])
  })
})

describe('порядок и гонки очереди', () => {
  it('call_signal отвечающего сразу за call_accept не теряется (встаёт в очередь за звеном звонящего)', async () => {
    net.tamper = (_f, to, f) => {
      if (to === 1 && f.type === 'call_signal' && f.data.media) return [] // настоящие media-state отвечающего не мешают
      if (to !== 1 || f.type !== 'call_accept') return [f]
      const media: Frame = { type: 'call_signal', data: { to_user_id: 1, call_id: f.data.call_id, media: { muted: true, cam_on: false } } }
      return [f, media]
    }
    const { A } = await connectPair(net)
    await until(() => A.call()?.remoteMuted === true, 'media-state after call_accept applied')
  })

  it('ранний call_accept до отправки call_request игнорируется и не снимает таймер звонка', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const A = await net.side(1)
      FakePC.generateCertificate = () => new Promise(() => {}) // подготовка не завершится
      A.engine.startOutgoing(PEER_OF(2), false)
      A.engine.handleFrame({ t: 'call_accept', d: { call_id: A.call()!.callId, from_user_id: 2, dh: 'x', dtls: ['sha-256 AA'] } } as never)
      expect(A.call()!.phase).toBe('outgoing')
      await vi.advanceTimersByTimeAsync(45_000)
      expect(reasonsOf(A.frames('call_end'))).toEqual(['missed'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('повторный accept() не отправляет второй call_accept', async () => {
    const A = await net.side(1); const B = await net.side(2)
    A.engine.startOutgoing(PEER_OF(2), false)
    await until(() => B.call()?.phase === 'incoming', 'incoming')
    B.engine.accept()
    B.engine.accept()
    await until(() => B.frames('call_accept').length > 0, 'call_accept')
    await settle()
    expect(B.frames('call_accept')).toHaveLength(1)
  })

  it('свой localDescription с чужим отпечатком: call_end disconnect, SDP наружу не уходит', async () => {
    const orig = FakePC.prototype.setLocalDescription
    FakePC.prototype.setLocalDescription = async function (this: FakePC) {
      await orig.call(this)
      this.localDescription = { type: this.localDescription!.type, sdp: sdpWithFp(FAKE_FP), toJSON() { return { type: this.type, sdp: this.sdp } } }
    }
    try {
      const { A, B } = await startPair(net)
      // подмена действует на pc обеих сторон; хотя бы одна рвёт звонок, SDP с чужим отпечатком наружу не уходит
      await until(() => A.call()?.endReason === 'failed' || B.call()?.endReason === 'failed', 'someone failed on own sdp')
      expect([...A.frames('call_signal'), ...B.frames('call_signal')].filter((f) => f.data.sdp)).toHaveLength(0)
      expect([...reasonsOf(A.frames('call_end')), ...reasonsOf(B.frames('call_end'))]).toContain('disconnect')
    } finally {
      FakePC.prototype.setLocalDescription = orig
    }
  })
})

describe('раскрытие ключа', () => {
  it('dh_reveal с чужим ключом: call_end disconnect, failed', async () => {
    const other = await generateKeyPair()
    const otherPub = b64FromBytes(await exportPublicKey(other.publicKey))
    net.tamper = (_f, _t, f) => [f.type === 'call_signal' && f.data.dh_reveal ? { ...f, data: { ...f.data, dh_reveal: otherPub } } : f]
    const A = await net.side(1); const B = await net.side(2)
    A.engine.startOutgoing(PEER_OF(2), false)
    await until(() => B.call()?.phase === 'incoming', 'incoming')
    B.engine.accept()
    await until(() => B.call()?.endReason === 'failed', 'B failed')
    expect(reasonsOf(B.frames('call_end'))).toEqual(['disconnect'])
  })

  it('dh_reveal не base64 / не точка кривой: failed', async () => {
    net.tamper = (_f, _t, f) => [f.type === 'call_signal' && f.data.dh_reveal ? { ...f, data: { ...f.data, dh_reveal: '***' } } : f]
    const A = await net.side(1); const B = await net.side(2)
    A.engine.startOutgoing(PEER_OF(2), false)
    await until(() => B.call()?.phase === 'incoming', 'incoming')
    B.engine.accept()
    await until(() => B.call()?.endReason === 'failed', 'B failed')
  })

  // Хватает кадры dh_reveal и offer на пути к Бобу (остальные идут как есть) и отдаёт оба сразу.
  function holdRevealAndOffer(order: (reveal: Frame, offer: Frame) => Frame[]) {
    let reveal: Frame | null = null
    let offer: Frame | null = null
    net.tamper = (_f, to, f) => {
      if (to !== 2 || f.type !== 'call_signal') return [f]
      const isOffer = (f.data.sdp as { type?: string } | undefined)?.type === 'offer'
      if (!f.data.dh_reveal && !isOffer) return [f]
      if (f.data.dh_reveal) reveal = f
      else offer = f
      return reveal && offer ? order(reveal, offer) : []
    }
  }

  it('dh_reveal и offer доставлены в одном тике: очередь не обгоняет, звонок не рвётся', async () => {
    holdRevealAndOffer((r, o) => [r, o])
    const { A, B } = await connectPair(net)
    await until(() => !!pcOf(B)?.remoteDescription, 'offer applied')
    await settle()
    expect(B.call()!.endReason).toBeUndefined()
    expect(A.call()!.e2eFingerprint).toEqual(B.call()!.e2eFingerprint)
  })

  it('offer раньше dh_reveal (звонящий нарушил порядок): failed', async () => {
    holdRevealAndOffer((r, o) => [o, r])
    const { B } = await startPair(net)
    await until(() => B.call()?.endReason === 'failed', 'B failed')
    expect(B.call()!.e2eFingerprint).toBeUndefined()
    expect(reasonsOf(B.frames('call_end'))).toEqual(['disconnect'])
  })
})

describe('старый клиент и недоступный WebCrypto/DTLS: без молчаливого отката', () => {
  it('входящий call_request без dh_hash: accept() шлёт call_decline missed, failed, call_accept не уходит', async () => {
    const B = await net.side(2)
    B.engine.handleFrame({ t: 'call_request', d: { call_id: 'c1', from_user_id: 1, video: false, dh: 'old' } } as never)
    B.engine.accept()
    expect(reasonsOf(B.frames('call_decline'))).toEqual(['missed'])
    expect(B.frames('call_accept')).toHaveLength(0)
    expect(B.call()!.endReason).toBe('failed')
  })

  it('call_accept без dtls (старый отвечающий): звонящий шлёт call_end disconnect, failed', async () => {
    net.tamper = (_f, _t, f) => {
      if (f.type !== 'call_accept') return [f]
      const { dtls: _d, ...rest } = f.data
      return [{ ...f, data: rest }]
    }
    const A = await net.side(1); const B = await net.side(2)
    A.engine.startOutgoing(PEER_OF(2), false)
    await until(() => B.call()?.phase === 'incoming', 'incoming')
    B.engine.accept()
    await until(() => A.call()?.endReason === 'failed', 'A failed')
    expect(reasonsOf(A.frames('call_end'))).toEqual(['disconnect'])
    expect(A.call()!.e2eFingerprint).toBeUndefined()
  })

  it('call_accept без dh: failed', async () => {
    net.tamper = (_f, _t, f) => {
      if (f.type !== 'call_accept') return [f]
      const { dh: _d, ...rest } = f.data
      return [{ ...f, data: rest }]
    }
    const A = await net.side(1); const B = await net.side(2)
    A.engine.startOutgoing(PEER_OF(2), false)
    await until(() => B.call()?.phase === 'incoming', 'incoming')
    B.engine.accept()
    await until(() => A.call()?.endReason === 'failed', 'A failed')
  })

  it('call_accept с неканоническим dtls (перевод строки в значении): failed', async () => {
    net.tamper = (_f, _t, f) => [f.type === 'call_accept' ? { ...f, data: { ...f.data, dtls: ['sha-256 AA\nsha-256 BB'] } } : f]
    const A = await net.side(1); const B = await net.side(2)
    A.engine.startOutgoing(PEER_OF(2), false)
    await until(() => B.call()?.phase === 'incoming', 'incoming')
    B.engine.accept()
    await until(() => A.call()?.endReason === 'failed', 'A failed')
  })

  it('generateCertificate бросает: исходящий не шлёт call_request, failed', async () => {
    FakePC.generateCertificate = async () => { throw new Error('unsupported') }
    const A = await net.side(1)
    A.engine.startOutgoing(PEER_OF(2), false)
    await until(() => A.call()?.endReason === 'failed', 'A failed')
    await settle()
    expect(A.frames('call_request')).toHaveLength(0)
  })

  it('generateCertificate бросает у отвечающего: call_decline missed, failed', async () => {
    const A = await net.side(1); const B = await net.side(2)
    A.engine.startOutgoing(PEER_OF(2), false)
    await until(() => B.call()?.phase === 'incoming', 'incoming')
    FakePC.generateCertificate = async () => { throw new Error('unsupported') }
    B.engine.accept()
    await until(() => B.call()?.endReason === 'failed', 'B failed')
    expect(reasonsOf(B.frames('call_decline'))).toEqual(['missed'])
    expect(B.frames('call_accept')).toHaveLength(0)
  })

  it('в SDP временного pc нет a=fingerprint: failed без call_request', async () => {
    vi.spyOn(FakePC.prototype, 'createOffer').mockResolvedValue({ type: 'offer', sdp: 'v=0\r\n' })
    const A = await net.side(1)
    A.engine.startOutgoing(PEER_OF(2), false)
    await until(() => A.call()?.endReason === 'failed', 'A failed')
    expect(A.frames('call_request')).toHaveLength(0)
    vi.restoreAllMocks()
  })
})

describe('getUserMedia вне очереди кадров', () => {
  afterEach(() => { Reflect.deleteProperty(navigator, 'mediaDevices') })

  it('окно разрешения микрофона открыто: media-state, ICE и call_end обрабатываются сразу, busy — сразу', async () => {
    let resolveGum: (s: unknown) => void = () => {}
    const stop = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => new Promise((r) => { resolveGum = r }) },
    })
    const { A, B } = await connectPair(net)
    await until(() => FakePC.mains().length >= 1, 'pc exists')
    // очередь свободна, хотя getUserMedia висит
    A.engine.handleFrame({ t: 'call_signal', d: { call_id: A.call()!.callId, from_user_id: 2, media: { muted: true, cam_on: false } } } as never)
    await until(() => A.call()?.remoteMuted === true, 'media-state applied while gUM pending')
    // чужой новый звонок получает busy сразу
    A.engine.handleFrame({ t: 'call_request', d: { call_id: 'other', from_user_id: 9, video: false } } as never)
    expect(A.frames('call_decline').map((f) => f.data.reason)).toEqual(['busy'])
    // call_end собеседника закрывает звонок сразу
    A.engine.handleFrame({ t: 'call_end', d: { call_id: A.call()!.callId, from_user_id: 2, reason: 'hangup' } } as never)
    expect(A.call()?.phase).toBe('ended')
    // поздний ответ getUserMedia: треки остановлены, в закрытый pc ничего не добавляется
    resolveGum({ getTracks: () => [{ stop, kind: 'audio' }], getVideoTracks: () => [] })
    await settle()
    expect(stop).toHaveBeenCalled()
    void B
  })

  it('ICE обрабатывается, пока getUserMedia висит', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => new Promise(() => {}) },
    })
    const { A, B } = await connectPair(net)
    const callerFps = (A.frames('call_signal').find((f) => f.data.dh_reveal)!.data.dtls as string[])[0]
    const callId = B.call()!.callId
    B.engine.handleFrame({ t: 'call_signal', d: { call_id: callId, from_user_id: 1, sdp: { type: 'offer', sdp: sdpWithFp(callerFps) } } } as never)
    await until(() => !!pcOf(B)?.remoteDescription, 'offer applied while gUM pending')
    B.engine.handleFrame({ t: 'call_signal', d: { call_id: callId, from_user_id: 1, ice: { candidate: 'x' } } } as never)
    await until(() => pcOf(B)!.ice.length === 1, 'ice applied while gUM pending')
  })

  it('поздний getUserMedia прошлого звонка не добавляет треки в pc нового', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const resolvers: Array<(s: unknown) => void> = []
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: () => new Promise((r) => { resolvers.push(r) }) },
      })
      const stop = vi.fn()
      const oldTrack = { kind: 'audio', stop }
      const { A } = await connectPair(net)
      A.engine.hangup()
      await vi.advanceTimersByTimeAsync(2000) // экран прошлого звонка убран
      expect(A.call()).toBeNull()
      const B2 = net.sides.get(2)!
      await vi.advanceTimersByTimeAsync(2000)
      expect(B2.call()).toBeNull()
      A.engine.startOutgoing(PEER_OF(2), false)
      await until(() => B2.call()?.phase === 'incoming', 'second call incoming')
      B2.engine.accept()
      await until(() => !!A.call()?.e2eFingerprint && FakePC.mains().length >= 4, 'second call connecting')
      resolvers[0]({ getTracks: () => [oldTrack], getVideoTracks: () => [] })
      await settle()
      expect(stop).toHaveBeenCalled()
      expect(FakePC.mains().every((p) => !p.tracks.includes(oldTrack))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
