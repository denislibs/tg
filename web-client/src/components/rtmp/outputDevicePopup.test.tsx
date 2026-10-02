/**
 * ВРЕМЕННЫЙ мост `showOutputDevicePopup` (до 2C-12) — поведение tweb
 * `components/rtmp/outputDevicePopup.tsx` (812502980), которое держит мост:
 * показ после `enumerateDevices`, «Default» первым и отсев заглушек, однократный
 * `onStaleCurrentId`, «Save» → `onPick` с ВЫБРАННЫМ id. Тест уходит вместе с
 * мостом: 2C-12 переносит его сценарии на Solid-порт.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import lang from '@/lang'
import PopupHost from '../PopupHost'
import { usePopupStore } from '@stores/popupStore'
import showOutputDevicePopup from './outputDevicePopup'

const device = (kind: MediaDeviceKind, deviceId: string, label: string) =>
  ({ kind, deviceId, label, groupId: '' }) as MediaDeviceInfo

let devices: MediaDeviceInfo[]

beforeEach(() => {
  devices = [
    device('audioinput', 'default', ''),
    device('audioinput', 'mic-1', 'Built-in Mic'),
    device('audioinput', 'mic-2', 'USB Mic'),
    device('audiooutput', 'spk-1', 'Speakers'),
  ]
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: () => Promise.resolve(devices),
      addEventListener() {},
      removeEventListener() {},
    },
  })
})

afterEach(() => {
  cleanup()
  usePopupStore.getState().clear()
})

/** Подписи вариантов — текст рядом с радио-кружком. */
const options = () => [...document.querySelectorAll<HTMLElement>('.rtmp-output-popup .popup-body span + *')]
const labels = () => options().map((el) => el.textContent)

describe('мост showOutputDevicePopup', () => {
  it('список: Default первым, только свой вид, без заглушки default; заголовок — titleLangKey', async() => {
    render(<PopupHost />)
    act(() => showOutputDevicePopup({ kind: 'audioinput', currentId: 'mic-1', titleLangKey: 'CallSettings.Microphone', onPick: vi.fn() }))

    await waitFor(() => expect(document.querySelector('.rtmp-output-popup')).not.toBeNull())
    expect(document.querySelector('.rtmp-output-popup .popup-title')!.textContent).toBe(lang['CallSettings.Microphone'])
    expect(labels()).toEqual([lang['Rtmp.OutputPopup.Default'], 'Built-in Mic', 'USB Mic'])
  })

  it('Save отдаёт выбранный id, а не текущий', async() => {
    const onPick = vi.fn()
    render(<PopupHost />)
    act(() => showOutputDevicePopup({ kind: 'audioinput', currentId: 'mic-1', onPick }))
    await waitFor(() => expect(labels()).toContain('USB Mic'))

    fireEvent.click(options().find((el) => el.textContent === 'USB Mic')!.parentElement!)
    fireEvent.click(document.querySelector('.rtmp-output-popup .popup-footer-button')!)

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith('mic-2')
  })

  it('выбранного устройства нет в списке — onStaleCurrentId один раз, отмечен Default', async() => {
    const onStaleCurrentId = vi.fn()
    render(<PopupHost />)
    act(() => showOutputDevicePopup({ kind: 'audioinput', currentId: 'gone', onPick: vi.fn(), onStaleCurrentId }))
    await waitFor(() => expect(onStaleCurrentId).toHaveBeenCalledTimes(1))

    const on = document.querySelector('.rtmp-output-popup .popup-body [data-on]')!
    expect(on.nextElementSibling!.textContent).toBe(lang['Rtmp.OutputPopup.Default'])
  })
})
