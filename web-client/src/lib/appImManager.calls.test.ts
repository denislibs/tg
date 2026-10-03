// Пины блока H `AppImManager` (звонки, tweb `appImManager.ts:2227-2605`, пачка П-4):
// `callUser` и подтверждение «покинуть текущий звонок» (`discardCurrentCall` →
// `discard*Confirmation` → `discardAnyCallConfirmation`), `joinGroupCall` по праву
// `manage_call`, `joinLiveStream`, очередь переходов `callTransitions`.
//
// Движки звонков (`core/calls/*`) и попап подтверждения — заглушки; сторы звонков —
// настоящие: по ним блок H узнаёт, во что мы сейчас звоним (расхождение З1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { useCallStore, type ActiveCall } from '@stores/callStore'
import { useGroupCallStore } from '@stores/groupCallStore'
import { useLivestreamStore } from '@stores/livestreamStore'
import type { Managers } from '@/client/bootstrap'
import { AppImManager } from './appImManager'

const engine = vi.hoisted(() => ({
  startOutgoing: vi.fn(),
  hangup: vi.fn(),
  joinGroupCall: vi.fn(async() => {}),
  leaveGroupCall: vi.fn(),
  watchLivestream: vi.fn(),
  leaveLivestream: vi.fn(),
  confirmationPopup: vi.fn(async(_options: { titleLangKey?: string, descriptionLangKey?: string }) => {}),
}))

vi.mock('@core/calls/callEngine', async(importOriginal) => ({
  ...await importOriginal<object>(), startOutgoing: engine.startOutgoing, hangup: engine.hangup,
}))
vi.mock('@core/calls/groupCallEngine', async(importOriginal) => ({
  ...await importOriginal<object>(), joinGroupCall: engine.joinGroupCall, leaveGroupCall: engine.leaveGroupCall,
}))
vi.mock('@core/calls/livestreamEngine', async(importOriginal) => ({
  ...await importOriginal<object>(), watchLivestream: engine.watchLivestream, leaveLivestream: engine.leaveLivestream,
}))
vi.mock('@components/popups/popupPeer', async(importOriginal) => ({
  ...await importOriginal<object>(), confirmationPopup: engine.confirmationPopup,
}))

const ALICE: PeerId = 7
const BOB: PeerId = 9
const GROUP: PeerId = -100
const MY_GROUP: PeerId = -300
const CHANNEL: PeerId = -200

let im: AppImManager

function inCallWith(peerId: PeerId) {
  useCallStore.getState().set({ callId: 'c1', peer: { id: peerId, name: 'Боб', avatar: '' }, phase: 'active' } as ActiveCall)
}

beforeEach(() => {
  Object.values(engine).forEach((fn) => fn.mockClear())
  engine.confirmationPopup.mockImplementation(async() => {})
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} },
    { _: 'user', id: BOB, first_name: 'Боб', pFlags: {} },
    { _: 'channel', id: 100, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, participants_count: 5, pFlags: { megagroup: true } },
    { _: 'channel', id: 300, title: 'Моя группа', photo: { _: 'chatPhotoEmpty' }, date: 0, participants_count: 3, pFlags: { megagroup: true, creator: true } },
    { _: 'channel', id: 200, title: 'Канал', photo: { _: 'chatPhotoEmpty' }, date: 0, participants_count: 9, pFlags: { broadcast: true } },
  ] }])
  useCallStore.getState().set(null)
  useGroupCallStore.setState({ peerId: null, activeByChat: {} })
  useLivestreamStore.setState({ watchingPeerId: null, activeByChat: {} })
  im = new AppImManager()
  im.managers = { peers: { fillMirror: async() => {} } } as unknown as Managers
})

afterEach(() => {
  useCallStore.getState().set(null)
})

describe('AppImManager.callUser (tweb :2227-2267)', () => {
  it('не в звонке: сразу звонит, без подтверждения', async() => {
    await im.callUser(ALICE, 'video')
    expect(engine.confirmationPopup).not.toHaveBeenCalled()
    expect(engine.startOutgoing).toHaveBeenCalledTimes(1)
    expect(engine.startOutgoing).toHaveBeenCalledWith(expect.objectContaining({ id: ALICE, name: 'Алиса' }), true)
  })

  it('уже говорим с этим же человеком (`getCallByUserId`) — ничего', async() => {
    inCallWith(ALICE)
    await im.callUser(ALICE, 'voice')
    expect(engine.confirmationPopup).not.toHaveBeenCalled()
    expect(engine.startOutgoing).not.toHaveBeenCalled()
  })

  it('говорим с другим: «Call in Progress» с именами обоих, после «OK» — сброс и новый звонок', async() => {
    inCallWith(BOB)
    engine.hangup.mockImplementation(() => useCallStore.getState().set(null))
    await im.callUser(ALICE, 'voice')

    const [options] = engine.confirmationPopup.mock.calls[0] as unknown as [{ titleLangKey: string, descriptionLangKey: string, descriptionLangArgs: HTMLElement[] }]
    expect(options.titleLangKey).toBe('Call.Confirm.Discard.Call.Header')
    expect(options.descriptionLangKey).toBe('Call.Confirm.Discard.Call.ToCall.Text')
    expect(options.descriptionLangArgs.map((el) => el.textContent)).toEqual(['Боб', 'Алиса'])
    expect(engine.hangup).toHaveBeenCalledTimes(1)
    expect(engine.hangup.mock.invocationCallOrder[0]).toBeLessThan(engine.startOutgoing.mock.invocationCallOrder[0])
    expect(engine.startOutgoing).toHaveBeenCalledWith(expect.objectContaining({ id: ALICE }), false)
  })

  it('в видеочате: подтверждение `Voice → Call`; отмена — ни выхода, ни звонка, промис отклонён', async() => {
    useGroupCallStore.setState({ peerId: GROUP })
    engine.confirmationPopup.mockRejectedValueOnce('canceled')
    await expect(im.callUser(ALICE, 'voice')).rejects.toThrow()

    expect(engine.confirmationPopup.mock.calls[0][0]).toMatchObject({
      titleLangKey: 'Call.Confirm.Discard.Voice.Header',
      descriptionLangKey: 'Call.Confirm.Discard.Voice.ToCall.Text',
    })
    expect(engine.leaveGroupCall).not.toHaveBeenCalled()
    expect(engine.startOutgoing).not.toHaveBeenCalled()
  })

  it('переходы идут очередью: второй звонок ждёт подтверждения первого', async() => {
    inCallWith(BOB)
    let confirm!: () => void
    engine.confirmationPopup.mockImplementationOnce(() => new Promise<void>((resolve) => { confirm = resolve }))
    engine.hangup.mockImplementation(() => useCallStore.getState().set(null))

    const first = im.callUser(ALICE, 'voice')
    const second = im.callUser(ALICE, 'voice')
    await Promise.resolve()
    expect(engine.startOutgoing).not.toHaveBeenCalled()

    confirm()
    await first
    // движок-заглушка стор не пишет — второй переход звонка не видит и звонит сразу
    await second
    expect(engine.confirmationPopup).toHaveBeenCalledTimes(1)
    expect(engine.startOutgoing).toHaveBeenCalledTimes(2)
  })
})

describe('AppImManager.joinGroupCall (tweb :2348-2389) — право `manage_call` (З3)', () => {
  it('участник без идущего видеочата — не заводит его', async() => {
    await im.joinGroupCall(GROUP)
    expect(engine.joinGroupCall).not.toHaveBeenCalled()
  })

  it('участник при идущем видеочате — входит', async() => {
    useGroupCallStore.setState({ activeByChat: { [GROUP]: [BOB] } })
    await im.joinGroupCall(GROUP)
    expect(engine.joinGroupCall).toHaveBeenCalledWith(GROUP)
  })

  it('создатель — заводит видеочат сам', async() => {
    await im.joinGroupCall(MY_GROUP)
    expect(engine.joinGroupCall).toHaveBeenCalledWith(MY_GROUP)
  })

  it('из 1:1 звонка — `Call → Voice`, сброс звонка до входа', async() => {
    inCallWith(BOB)
    engine.hangup.mockImplementation(() => useCallStore.getState().set(null))
    await im.joinGroupCall(MY_GROUP)
    expect(engine.confirmationPopup.mock.calls[0][0]).toMatchObject({ descriptionLangKey: 'Call.Confirm.Discard.Call.ToVoice.Text' })
    expect(engine.hangup.mock.invocationCallOrder[0]).toBeLessThan(engine.joinGroupCall.mock.invocationCallOrder[0])
  })
})

describe('AppImManager.joinLiveStream (tweb :2584-2605)', () => {
  it('смотрим другой эфир — `Live → Live`, выходим из него и смотрим новый', async() => {
    useLivestreamStore.setState({ watchingPeerId: GROUP })
    engine.leaveLivestream.mockImplementation(() => useLivestreamStore.setState({ watchingPeerId: null }))
    await im.joinLiveStream(CHANNEL)
    expect(engine.confirmationPopup.mock.calls[0][0]).toMatchObject({
      titleLangKey: 'Call.Confirm.Discard.Live.Header',
      descriptionLangKey: 'Call.Confirm.Discard.Live.ToLive.Text',
    })
    expect(engine.leaveLivestream).toHaveBeenCalledTimes(1)
    expect(engine.watchLivestream).toHaveBeenCalledWith(CHANNEL)
  })
})
