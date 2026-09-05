// Пины `PasswordMonkey.tsx` (порт tweb `monkeys/password.ts`).
//
// Норма проводки задачи: ассет грузится по ИМЕНИ (не факт вызова), «глазок»
// (`peeking`) доводит до ручного подсчёта кадров через `enterFrame`+
// `needFrame` (а не `playSegments` — прежнее отступление версии на
// `lottie-web`), уничтожение анимации на размонтировании — включая гонку
// «ассет догрузился после cleanup».
//
// Движок — tlottie (`@lib/lottie/lottieLoader`): мокаем модуль целиком, тот
// же приём, что `wrappers/sticker.test.ts`/`StickerMedia.test.tsx`
// (`loadAnimationWorker` там, `loadAnimationAsAsset` здесь) — не `lottie-web`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { LottieAssetName } from '@lib/lottie/lottieLoader'

const { loadAnimationAsAsset, waitForFirstFrame } = vi.hoisted(() => ({
  loadAnimationAsAsset: vi.fn(),
  waitForFirstFrame: vi.fn((player: unknown) => Promise.resolve(player)),
}))
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { loadAnimationAsAsset, waitForFirstFrame },
}))

import PasswordMonkey from './PasswordMonkey'

function makeFakePlayer() {
  const player = {
    canvas: [document.createElement('canvas')] as HTMLCanvasElement[],
    direction: 1,
    curFrame: 0,
    play: vi.fn(),
    pause: vi.fn(),
    setSpeed: vi.fn(),
    setDirection: vi.fn((d: number) => {
      player.direction = d
    }),
    addEventListener: vi.fn(),
    remove: vi.fn(),
  }
  return player
}

type FakePlayer = ReturnType<typeof makeFakePlayer>

function getEnterFrameCallback(anim: FakePlayer): (currentFrame: number) => void {
  const call = anim.addEventListener.mock.calls.find((c) => c[0] === 'enterFrame')
  if (!call) throw new Error('enterFrame listener не зарегистрирован')
  return call[1] as (currentFrame: number) => void
}

beforeEach(() => {
  loadAnimationAsAsset.mockReset()
  waitForFirstFrame.mockClear()
})

afterEach(cleanup)

async function mountAndLoad(peeking = false) {
  const player = makeFakePlayer()
  loadAnimationAsAsset.mockResolvedValue(player)

  const { rerender } = render(<PasswordMonkey peeking={peeking} size={130} />)
  await vi.waitFor(() => expect(loadAnimationAsAsset).toHaveBeenCalledTimes(1))

  return { player, rerender }
}

describe('PasswordMonkey: загрузка ассета', () => {
  it('грузит ИМЕННО TwoFactorSetupMonkeyPeek с заданным размером и noCache:true (tweb :18-26)', async () => {
    await mountAndLoad()
    const [params, name] = loadAnimationAsAsset.mock.calls[0]
    expect(name).toBe('TwoFactorSetupMonkeyPeek' satisfies LottieAssetName)
    expect(params).toMatchObject({ width: 130, height: 130, loop: false, autoplay: false, noCache: true })
  })
})

describe('PasswordMonkey: подглядывание (ручной подсчёт кадров, tweb :39-51)', () => {
  it('стартовое состояние (peeking=false) не проигрывает анимацию', async () => {
    const { player } = await mountAndLoad(false)
    expect(player.play).not.toHaveBeenCalled()
  })

  it('peeking=true: direction 1, curFrame сброшен на 0, play() позван', async () => {
    const { player, rerender } = await mountAndLoad(false)

    rerender(<PasswordMonkey peeking size={130} />)

    expect(player.setDirection).toHaveBeenCalledWith(1)
    expect(player.curFrame).toBe(0)
    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it('peeking=true→false: direction -1, curFrame взведён на PEEK_FRAME(16)', async () => {
    // Реалистичная последовательность: сначала показать (false→true, глазок
    // нажат), потом скрыть обратно (true→false) — а не мгновенный маунт с
    // peeking=true (тогда эффект срабатывает ДО того, как анимация вообще
    // догрузилась, `animRef.current` ещё `null` — не сценарий этого пина).
    const { player, rerender } = await mountAndLoad(false)
    rerender(<PasswordMonkey peeking size={130} />)
    player.setDirection.mockClear()
    player.play.mockClear()

    rerender(<PasswordMonkey peeking={false} size={130} />)

    expect(player.setDirection).toHaveBeenLastCalledWith(-1)
    expect(player.curFrame).toBe(16)
    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it('enterFrame: подыгрывание тормозит на needFrame независимо от направления (не playSegments)', async () => {
    const { player, rerender } = await mountAndLoad(false)
    rerender(<PasswordMonkey peeking size={130} />)
    const enterFrame = getEnterFrameCallback(player)

    enterFrame(10) // ещё не догнали needFrame(16)
    expect(player.pause).not.toHaveBeenCalled()

    enterFrame(16) // догнали — пауза, скорость возвращена к 1
    expect(player.pause).toHaveBeenCalled()
    expect(player.setSpeed).toHaveBeenCalledWith(1)

    player.pause.mockClear()
    rerender(<PasswordMonkey peeking={false} size={130} />) // needFrame=0, direction=-1

    enterFrame(5) // ещё выше needFrame(0) — для direction -1 условие currentFrame<=needFrame не выполняется
    expect(player.pause).not.toHaveBeenCalled()

    enterFrame(0) // спустились до 0 — пауза
    expect(player.pause).toHaveBeenCalled()
  })
})

describe('PasswordMonkey: размонтирование', () => {
  it('анимация уничтожается на cleanup', async () => {
    const { player } = await mountAndLoad()
    cleanup()
    expect(player.remove).toHaveBeenCalled()
  })

  it('размонтирование ДО того как ассет догрузился — гонка не оставляет живой анимации', async () => {
    const player = makeFakePlayer()
    let resolveLoad!: (p: FakePlayer) => void
    loadAnimationAsAsset.mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve }))

    render(<PasswordMonkey peeking={false} size={130} />)
    cleanup() // синхронно, раньше, чем резолвится загрузка

    resolveLoad(player)
    await new Promise((r) => setTimeout(r, 0))

    expect(player.remove).toHaveBeenCalled()
    expect(player.play).not.toHaveBeenCalled()
  })
})
