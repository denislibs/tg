import { describe, it, expect } from 'vitest'
import { appColorMap, presetToColorMap } from './themePresets'

describe('themePresets', () => {
  it('day primary is telegram blue', () => {
    expect(presetToColorMap('day')['primary-color'].toLowerCase()).toBe('#3390ec')
  })
  it('night primary is tweb night accent', () => {
    expect(presetToColorMap('night')['primary-color'].toLowerCase()).toBe('#8774e1')
  })
  it('appColorMap marks primary-color with rgb+light+dark', () => {
    expect(appColorMap['primary-color'].rgb).toBe(true)
    expect(appColorMap['primary-color'].light).toBe(true)
    expect(appColorMap['primary-color'].dark).toBe(true)
  })
})
