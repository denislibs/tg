// S10 — вкладочная половина канала код-пароля: слушатель событий воркера
// (`installPasscodeListener`, порт tweb `apiManagerProxy.ts:517-536`), замок
// с перезагрузкой (`lockAndReload`, tweb `apiManagerProxy.lock()` :1466-1470) и
// старт с ключом из передачи через перезагрузку (`PasscodeLockScreenController`,
// tweb `passcodeLockScreenController.tsx:29-70`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn(async(_type: string, _task: { method: string, payload?: unknown }): Promise<unknown> => undefined))
vi.mock('./bootstrap', () => ({ startClient: () => ({ smp: { invoke } }) }))
vi.mock('./passcodeServiceWorker', () => ({ sendPasscodeStateToServiceWorker: vi.fn(async() => {}) }))
vi.mock('@components/passcodeLock/passcodeLockScreen.solid', () => ({ default: () => null }))

beforeEach(() => {
  vi.resetModules()
  invoke.mockReset()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function fakeSmp() {
  const listeners = new Map<string, (e: unknown) => void>()
  const smpInvoke = vi.fn(async(_type: string, _task: unknown): Promise<unknown> => undefined)
  return {
    smp: { on: (event: string, cb: (e: unknown) => void) => { listeners.set(event, cb) }, invoke: smpInvoke },
    emit: (e: unknown) => listeners.get('passcode')!(e),
    smpInvoke,
  }
}

describe('installPasscodeListener', () => {
  it('настройки автоблокировки уходят воркеру на старте и на каждой их смене (lib/mainWorker/useAutoLock.ts, расхождение 1)', async() => {
    const { installPasscodeListener } = await import('./passcodeClient')
    const { useSettingsStore } = await import('@/settings')
    useSettingsStore.getState().update({ passcodeEnabled: true, passcodeAutoLockMins: 5 })
    const { smp, smpInvoke } = fakeSmp()
    installPasscodeListener(smp as never, { lock: vi.fn(), unlock: vi.fn() })
    expect(smpInvoke).toHaveBeenLastCalledWith('passcode', { method: 'setAutoLockSettings', payload: { enabled: true, autoLockTimeoutMins: 5 } })

    useSettingsStore.getState().update({ passcodeAutoLockMins: 0 })
    expect(smpInvoke).toHaveBeenLastCalledWith('passcode', { method: 'setAutoLockSettings', payload: { enabled: true, autoLockTimeoutMins: null } })
    const calls = smpInvoke.mock.calls.length
    useSettingsStore.getState().update({ tabsInSidebar: !useSettingsStore.getState().tabsInSidebar })
    expect(smpInvoke.mock.calls.length).toBe(calls)
  })

  it('saveEncryptionKey/toggleUsingPasscode кладут ключ и флаг в память вкладки; toggleLock зовёт замок', async() => {
    const { installPasscodeListener } = await import('./passcodeClient')
    const EncryptionKeyStore = (await import('@lib/passcode/keyStore')).default
    const DeferredIsUsingPasscode = (await import('@lib/passcode/deferredIsUsingPasscode')).default
    const lock = vi.fn()
    const unlock = vi.fn()
    const { smp, emit } = fakeSmp()
    installPasscodeListener(smp as never, { lock, unlock })
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])

    emit({ method: 'saveEncryptionKey', payload: key })
    expect(EncryptionKeyStore.getUndeferred()).toBe(key)

    emit({ method: 'toggleUsingPasscode', payload: { isUsingPasscode: false, encryptionKey: null } })
    expect(DeferredIsUsingPasscode.isUsingPasscodeUndeferred()).toBe(false)
    expect(EncryptionKeyStore.getUndeferred()).toBeNull()

    emit({ method: 'toggleLock', payload: true })
    emit({ method: 'toggleLock', payload: false })
    expect(lock).toHaveBeenCalledTimes(1)
    expect(unlock).toHaveBeenCalledTimes(1)
  })

  it('reload («забыли код»): флаг кода снят в настройках, вкладка перезагружается', async() => {
    const { installPasscodeListener } = await import('./passcodeClient')
    const { useSettingsStore } = await import('@/settings')
    useSettingsStore.getState().update({ passcodeEnabled: true })
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const { smp, emit } = fakeSmp()
    installPasscodeListener(smp as never, { lock: vi.fn(), unlock: vi.fn() })

    emit({ method: 'reload' })

    expect(useSettingsStore.getState().passcodeEnabled).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('lockAndReload', () => {
  it('воркер завершается (ключ уходит с ним), соседям — reload по BroadcastChannel, себе — reload', async() => {
    const { lockAndReload } = await import('./passcodeClient')
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const heard = vi.fn()
    const neighbour = new BroadcastChannel('msgr-passcode-reload')
    neighbour.onmessage = heard
    invoke.mockReturnValue(new Promise(() => {})) // воркер закрылся и не отвечает

    lockAndReload()

    expect(invoke).toHaveBeenCalledWith('passcode', { method: 'terminate' })
    expect(reload).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => { expect(heard).toHaveBeenCalledTimes(1) })
    neighbour.close()
  })
})

describe('старт: ключ из передачи через перезагрузку (tweb 65c6ea8f8)', () => {
  it('ключ из window.sessionStorage уходит воркеру ДО isLocked, экрана нет, передача стёрта', async() => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
    sessionStorage.setItem('encryption_key_handoff', btoa(String.fromCharCode(...raw)))
    invoke.mockImplementation(async(_type, task) =>
      (task.method === 'isLocked' ? { isUsingPasscode: true, isLocked: false } : undefined))

    const Controller = (await import('@components/passcodeLock/passcodeLockScreenController.solid')).default
    const EncryptionKeyStore = (await import('@lib/passcode/keyStore')).default
    const onLocked = vi.fn(async() => {})
    await Controller.waitForUnlock(onLocked)

    expect(invoke.mock.calls.map(([, t]) => t.method)).toEqual(['saveEncryptionKey', 'isLocked'])
    const sent = invoke.mock.calls[0][1].payload as CryptoKey
    expect(new Uint8Array(await crypto.subtle.exportKey('raw', sent))).toEqual(raw)
    expect(EncryptionKeyStore.getUndeferred()).toBe(sent)
    expect(onLocked).not.toHaveBeenCalled()
    expect(document.querySelector('.passcode-lock-screen')).toBeNull()
    expect(sessionStorage.getItem('encryption_key_handoff')).toBeNull()
  })

  it('без передачи и под замком — колбэк (язык) и экран; флаг кода сверен с настройкой', async() => {
    invoke.mockImplementation(async(_type, task) =>
      (task.method === 'isLocked' ? { isUsingPasscode: true, isLocked: true } : undefined))
    const { useSettingsStore } = await import('@/settings')
    useSettingsStore.getState().update({ passcodeEnabled: false })

    const Controller = (await import('@components/passcodeLock/passcodeLockScreenController.solid')).default
    const onLocked = vi.fn(async() => {})
    let started = false
    void Controller.waitForUnlock(onLocked).then(() => { started = true })

    await vi.waitFor(() => { expect(document.querySelector('.passcode-lock-screen')).not.toBeNull() })
    expect(onLocked).toHaveBeenCalledTimes(1)
    expect(started).toBe(false)
    expect(useSettingsStore.getState().passcodeEnabled).toBe(true)

    Controller.unlock()
    await vi.waitFor(() => { expect(started).toBe(true) })
    // tweb `unlock()`: экран гаснет `--hidden` и уходит после пауз 120 + 250 + 120 мс
    await vi.waitFor(() => { expect(document.querySelector('.passcode-lock-screen')).toBeNull() }, { timeout: 2000 })
  })
})
