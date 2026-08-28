// @vitest-environment happy-dom
// Бриф-шаблон просил `jsdom`, но репозиторий везде использует happy-dom
// (см. vitest.config.ts test.environment) и jsdom не установлен как зависимость —
// используем happy-dom, он даёт тот же document/head/style/classList API.
import { describe, it, expect } from 'vitest'
import { setTheme, getCurrentPreset, deriveChatThemeVars, applyChatTheme, clearChatTheme } from './themeController'
import { DEFAULT_HIGHLIGHTING_COLORS, presetToColorMap } from '../../config/themePresets'
import { hslaStringToHex } from '../../shared/lib/color'

const styleText = () => document.getElementById('theme')!.textContent || ''
// В `<style id="theme">` два блока: `:root{}` активной темы и зеркало `.night{}`
// (tweb _setTheme :339-342). Проверки палитры активной темы смотрят в первый —
// иначе ловят ночные значения зеркала.
const rootStyle = () => styleText().split('.night{')[0]

describe('themeController', () => {
  it('injects primary-color + derived + rgb for day', () => {
    setTheme('day')
    const css = rootStyle()
    expect(css).toContain('--primary-color:#3390ec')
    expect(css).toMatch(/--primary-color-rgb:\s*51,\s*144,\s*236/)
    expect(css).toContain('--light-primary-color:')
    expect(document.documentElement.classList.contains('night')).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('day')
    expect(getCurrentPreset()).toBe('day')
  })

  it('night toggles .night class', () => {
    setTheme('night')
    expect(document.documentElement.classList.contains('night')).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('night')
    expect(getCurrentPreset()).toBe('night')
  })

  it('reuses single <style id=theme>', () => {
    setTheme('day')
    setTheme('night')
    expect(document.querySelectorAll('#theme').length).toBe(1)
  })

  it('overrides message-out-primary-color to white for dark presets (tweb applyTheme:889)', () => {
    setTheme('night')
    const css = rootStyle()
    expect(css).toContain('--message-out-primary-color:#ffffff')

    setTheme('tinted')
    expect(rootStyle()).toContain('--message-out-primary-color:#ffffff')

    setTheme('day')
    expect(rootStyle()).not.toContain('--message-out-primary-color:#ffffff')
    // …но зеркало `.night{}` его несёт всегда — оно про ночную палитру.
    expect(styleText()).toContain('--message-out-primary-color:#ffffff')
  })

  it('darkens primary-color with darkenAlpha=0.04, not the generic 0.08 (tweb applyTheme:805-809)', () => {
    setTheme('day')
    const css = rootStyle()
    // hex #3390ec -> rgb(51,144,236) -> hsl(209.83783783783787deg, 82.95964125560539%, 56.27450980392157%);
    // darkenAlpha=0.04 => l -= 4 => 52.27450980392157%. (Пересчитано независимо от color.ts, по формуле
    // RGB->HSL из tweb `rgbaToHsla`.) С generic 0.08 значение l было бы 48.27450980392157% — другое число.
    expect(css).toContain(
      '--dark-primary-color:hsl(209.83783783783787, 82.95964125560539%, 52.27450980392157%);',
    )
  })

  it('mixes saved-color light-filled toward white at 0.64, not toward surface at 0.08 (tweb applyTheme:811-816)', () => {
    setTheme('day')
    const css = rootStyle()
    // hex #359AD4 -> rgb(53,154,212); mix toward [255,255,255] (не surface!) с весом 0.64:
    // floor(255 + (53-255)*0.64)=125, floor(255 + (154-255)*0.64)=190, floor(255 + (212-255)*0.64)=227
    // -> #7dbee3. Пастельно-голубой (base.scss:178 — аватарка Saved Messages), а не почти-белый,
    // который получился бы при generic mixColor=surface-color(#ffffff для day).
    expect(css).toContain('--light-filled-saved-color:#7dbee3')
  })
})

describe('deriveChatThemeVars', () => {
  it('shifts primary under a custom accent (day)', () => {
    const vars = new Map(deriveChatThemeVars('day', '#e17076', ['#e17076']))
    // primary сдвинут под красный акцент, не синий дефолт day
    const primary = vars.get('--primary-color')!.toLowerCase()
    expect(primary).not.toBe('#3390ec')
    // производные присутствуют
    expect(vars.has('--primary-color-rgb')).toBe(true)
    expect(vars.has('--light-primary-color')).toBe(true)
    // out-bubble посчитан из messageColors
    expect(vars.get('--message-out-background-color')).toBeTruthy()
  })

  it('forces message-out-primary-color to white for night presets', () => {
    const vars = new Map(deriveChatThemeVars('night', '#e17076', ['#e17076']))
    expect(vars.get('--message-out-primary-color')).toBe('#ffffff')
  })

  it('re-derives saved-color from the same newAccentHex as primary-color (tweb applyTheme:811-816)', () => {
    const vars = new Map(deriveChatThemeVars('day', '#e17076', ['#e17076']))
    // В tweb saved-color не пересчитывается отдельно — использует тот же
    // newAccentHex, что и primary-color (applyTheme:792-798 vs :811-816).
    expect(vars.get('--saved-color')).toBe(vars.get('--primary-color'))
    expect(vars.get('--saved-color')).not.toBe('#359AD4') // не literal-хекс пресета
    // lightenAlpha=0.64/mixColor=[255,255,255] (getColorOverride('saved-color', ...))
    // всё ещё применяются поверх нового newAccentHex ('#e17076' -> rgb(225,112,118)):
    // mixColors([225,112,118], [255,255,255], 0.64):
    //   R: floor(225+(225-225)*0.64)... используем формулу mixColors(color1,color2,weight)
    //   = floor(color2 + (color1-color2)*weight):
    //   R: floor(255+(225-255)*0.64)=floor(255-19.2)=235
    //   G: floor(255+(112-255)*0.64)=floor(255-91.52)=163
    //   B: floor(255+(118-255)*0.64)=floor(255-87.68)=167
    //   -> rgb(235,163,167) -> #eba3a7
    expect(vars.get('--light-filled-saved-color')).toBe('#eba3a7')
  })

  it('computes exact message-out-background-color for a single messageColor (day)', () => {
    // tweb applyTheme:833-885, single-color path (messageColors.length === 1,
    // firstColor используется как myMessagesAccent без getAverageColor/getAccentColor):
    //   messageLightenAlpha = 0.12 (!isNight)
    //   myMessagesAccent = hexToRgb('#e17076') = [225,112,118]
    //   mixColors(myMessagesAccent, surfaceRgb=[255,255,255], 0.12):
    //     R: floor(255 + (225-255)*0.12) = floor(251.4) = 251
    //     G: floor(255 + (112-255)*0.12) = floor(237.84) = 237
    //     B: floor(255 + (118-255)*0.12) = floor(238.56) = 238
    //   -> [251,237,238]; saturation-boost +63 (не isNight):
    //     rgbaToHsla(251,237,238) -> h≈355.714, s≈63.636, l≈95.686
    //     boostedS = min(63.636+63, 100) = 100
    //     hslaToRgba(355.714, 100, 95.686) -> [255,233,235] -> #ffe9eb
    const vars = new Map(deriveChatThemeVars('day', '#e17076', ['#e17076']))
    expect(vars.get('--message-out-background-color')).toBe('#ffe9eb')
    expect(vars.get('--message-out-primary-color')).toBe('#e17076')
  })

  it('exercises the messageColors.length > 1 branch (getAverageColor + getAccentColor)', () => {
    // tweb applyTheme:845-858 — для >1 цветов сначала последовательное
    // getAverageColor, затем getAccentColor относительно базовой
    // message-out-primary/background пресета (day: '#5CA853'/mix с surface).
    // Значения ниже сняты с реального прогона портированных формул (getAverageColor/
    // getAccentColor/mixColors уже по отдельности не покрыты unit-тестами в
    // color.test.ts) — тест фиксирует именно факт исполнения этой ветки и её
    // детерминированный результат (регрессионный лок), не переизобретает HSV-математику
    // руками второй раз.
    const single = new Map(deriveChatThemeVars('day', '#e17076', ['#e17076']))
    const multi = new Map(deriveChatThemeVars('day', '#e17076', ['#e17076', '#7bc862']))

    // Другой набор messageColors -> другой результат (доказывает, что второй цвет
    // реально участвует в вычислении, а не игнорируется).
    expect(multi.get('--message-out-background-color')).not.toBe(single.get('--message-out-background-color'))
    expect(multi.get('--message-out-background-color')).toBe('#fef7e4')
    expect(multi.get('--message-out-primary-color')).toBe('#ae9c6c')
  })

  it('passes through the preset base message-out-* values when messageColors is empty', () => {
    // tweb applyTheme:833-835 — `if (!themeSettings.message_colors?.length) return`
    // (ранний выход до пересчёта message-out-background/primary-color).
    const base = presetToColorMap('day')
    const vars = new Map(deriveChatThemeVars('day', '#e17076', []))
    expect(vars.get('--message-out-background-color')).toBe(base['message-out-background-color'])
    expect(vars.get('--message-out-primary-color')).toBe(base['message-out-primary-color'])
  })

  it('applyChatTheme writes inline vars on element', () => {
    const el = document.createElement('div')
    applyChatTheme(el, 'day', '#e17076', ['#e17076'])
    expect(el.style.getPropertyValue('--primary-color')).toBeTruthy()
    expect(el.style.getPropertyValue('--light-primary-color')).toBeTruthy()
  })

  it('clearChatTheme removes the vars written by applyChatTheme', () => {
    const el = document.createElement('div')
    applyChatTheme(el, 'day', '#e17076', ['#e17076'])
    expect(el.style.getPropertyValue('--primary-color')).toBeTruthy()
    clearChatTheme(el)
    expect(el.style.getPropertyValue('--primary-color')).toBe('')
    expect(el.style.getPropertyValue('--light-primary-color')).toBe('')
  })

  // tweb themeController.ts:320-345 (_setTheme) — три вещи помимо переменных.
  describe('нативный хром и зеркало .night (tweb _setTheme :323-342)', () => {
    const meta = (name: string) => {
      let el = document.head.querySelector(`[name="${name}"]`)
      if (!el) {
        el = document.createElement('meta')
        el.setAttribute('name', name)
        document.head.appendChild(el)
      }
      return el
    }

    it('color-scheme следует за яркостью темы', () => {
      const el = meta('color-scheme')
      setTheme('day')
      expect(el.getAttribute('content')).toBe('light')
      setTheme('night')
      expect(el.getAttribute('content')).toBe('dark')
      setTheme('tinted') // tinted тоже ночная (NIGHT_THEME_NAMES)
      expect(el.getAttribute('content')).toBe('dark')
      setTheme('light')
      expect(el.getAttribute('content')).toBe('light')
    })

    it('theme-color заполняется цветом поверхности темы, дальше — накопленной подсветкой', () => {
      const el = meta('theme-color')
      el.setAttribute('content', '#000000')
      setTheme('day')
      // Первый вызов (накопленного themeColor ещё нет) — surface-color темы.
      expect(el.getAttribute('content')!.toLowerCase()).not.toBe('#000000')
      expect(el.getAttribute('content')).toMatch(/^#|^hsl/)

      // tweb :328 против :344 — setThemeColor идёт ДО applyHighlightingColor,
      // поэтому со второй темы в мету едет hex подсветки, накопленный ПРЕДЫДУЩЕЙ
      // (на не-тач-устройствах, IS_TOUCH_SUPPORTED === false в happy-dom).
      setTheme('night')
      expect(el.getAttribute('content')).toBe(hslaStringToHex(DEFAULT_HIGHLIGHTING_COLORS.day))
    })

    it('зеркало .night{} несёт ночную палитру, когда активна светлая тема', () => {
      setTheme('day')
      const css = styleText()
      const night = css.slice(css.indexOf('.night{'))
      expect(night).toContain('.night{')
      // В :root — дневная поверхность, в .night{} — ночная.
      expect(rootStyle()).toContain(
        `--surface-color:${presetToColorMap('day')['surface-color']}`,
      )
      expect(night).toContain(`--surface-color:${presetToColorMap('night')['surface-color']}`)
    })

    it('на активной тёмной теме зеркало .night{} несёт ЕЁ палитру, а не статичную night', () => {
      setTheme('tinted')
      const css = styleText()
      const night = css.slice(css.indexOf('.night{'))
      expect(night).toContain(`--surface-color:${presetToColorMap('tinted')['surface-color']}`)
      expect(night).not.toContain(`--surface-color:${presetToColorMap('night')['surface-color']}`)
    })
  })
})
