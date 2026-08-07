// Порт 1:1 (в объёме PR-1, см. бриф Task 3) логики build+inject из tweb
// `src/helpers/themeController.ts` (`applyAppColor`/`applyTheme`), урезанной до
// синхронной генерации CSS-переменных для 4 встроенных пресетов. Формулы
// производных — из tweb `src/scss/mixins/_splitColor.scss` + `functions.scss`
// (`hover-color`, `rgba-to-rgb`) и реального рантайм-эквивалента этих формул в
// `applyAppColor` (themeController.ts:536-587): там же — константа alpha 0.08,
// совпадающая с `$hover-alpha` из tweb `scss/variables.scss:6`.
//
// НЕ портировано (out-of-scope PR-1, см. бриф): View Transitions API/reveal
// (THEME_TRANSITION_TIMEOUT, dispatchHeavyAnimationEvent), accent-preset
// (applyAccentPreset — произвольный акцент), реальная tinted-деривация
// (iOS-подобный wallpaper-blend/surface) — tinted берётся статично из
// `presetToColorMap('tinted')` как есть. `setTheme` синхронный.
//
// Дополнительно НЕ портированы два частных случая из настоящего tweb
// `applyTheme` (не упомянуты в брифе явно, оставлены как generic-формула для
// всех цветов, а не спец-случаи):
//   - themeController.ts:890 — для 'message-out-primary-color' в tweb
//     mixColor для light-filled берётся равным message-out-background-color,
//     а не surface-color (у нас — везде surface-color, единообразно);
//   - themeController.ts:884 — для 'message-out-background-color' в tweb
//     lightenAlpha = isNight ? 1 : 0.12 (а не общий 0.08) для ЕГО собственных
//     производных (не для баз-хекса — тот уже верно посчитан в Task 2).
// Если ревью сочтёт это существенным для визуального паритета — расширить
// отдельным PR.

import type { AppColor, AppColorName, ThemePresetName } from '../../config/themePresets'
import { appColorMap, presetToColorMap } from '../../config/themePresets'
import { hexToRgb, hslaToRgba, mixColors, rgbaToHexa, rgbaToHsla } from '../../shared/lib/color'
import type { ColorRgb } from '../../shared/lib/color'

// tweb scss/variables.scss:6 `$hover-alpha: .08;` — используется и как alpha
// для `rgba($color, $alpha)` (--light-*), и как доля затемнения по lightness
// для --dark-* (в JS-рантайме tweb: `lightenAlpha = 0.08`, `darkenAlpha ??= lightenAlpha`).
const HOVER_ALPHA = 0.08

// tweb themeController.ts: `NIGHT_THEME_NAMES = new Set(['night', 'tinted'])` —
// пресеты, для которых включается тёмный режим (.night + белый message-out-primary).
const DARK_PRESETS = new Set<ThemePresetName>(['night', 'tinted'])

const STYLE_EL_ID = 'theme'

let currentPreset: ThemePresetName | null = null

function getOrCreateStyleEl(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_EL_ID)
  if (existing instanceof HTMLStyleElement) return existing

  const el = document.createElement('style')
  el.id = STYLE_EL_ID
  document.head.appendChild(el)
  return el
}

// Одна CSS-декларация ("--имя", "значение") без завершающего ";".
type CssVar = readonly [name: string, value: string]

// Порт `applyAppColor` (themeController.ts:536-587) — генерация производных
// переменных для одного AppColorName по его hex-значению и флагам appColorMap.
// `mixColorRgb` — фон для light-filled/dark-filled миксов; в tweb по умолчанию
// это surface-color текущей темы (см. themeController.ts:562).
function buildAppColorVars(name: AppColorName, hex: string, flags: AppColor, mixColorRgb: ColorRgb): CssVar[] {
  const rgb = hexToRgb(hex)
  const hsla = rgbaToHsla(...rgb)

  // tweb: darkenedHsla = {...hsla, l: hsla.l - darkenAlpha * 100} (darkenAlpha === lightenAlpha).
  const darkenedHsla = { ...hsla, l: hsla.l - HOVER_ALPHA * 100 }
  const darkenedRgb = hslaToRgba(darkenedHsla.h, darkenedHsla.s, darkenedHsla.l, 1).slice(0, 3) as ColorRgb

  const vars: CssVar[] = [[name, hex]]

  if (flags.rgb) {
    vars.push([`${name}-rgb`, rgb.join(',')])
  }

  if (flags.light) {
    // tweb: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${lightenAlpha})` — hover-color(color).
    vars.push([`light-${name}`, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${HOVER_ALPHA})`])
  }

  if (flags.lightFilled) {
    // tweb: rgbaToHexa(mixColors(rgb, mixColor, lightenAlpha)) — rgba-to-rgb(light, surface).
    vars.push([`light-filled-${name}`, rgbaToHexa(mixColors(rgb, mixColorRgb, HOVER_ALPHA))])
  }

  if (flags.dark) {
    // tweb: `hsl(${darkenedHsla.h}, ${darkenedHsla.s}%, ${darkenedHsla.l}%)` — darken(color, hover-alpha).
    vars.push([`dark-${name}`, `hsl(${darkenedHsla.h}, ${darkenedHsla.s}%, ${darkenedHsla.l}%)`])
  }

  // darkRgb/darkFilled: в реальном tweb-рантайме darkFilled закомментирован
  // (themeController.ts:576, к тому же дублирует ключ 'dark-' + name — мёртвый
  // код), а darkRgb нигде не генерируется (только объявлен в типе AppColor,
  // ни разу не используется потребителем в scss). Формулы ниже — честная
  // достройка по аналогии с rgb/lightFilled (симметрично: rgb канала
  // затемнённого цвета; rgba-to-rgb от затемнённого с alpha=1 — по формуле
  // _splitColor.scss это тождественно самому затемнённому цвету, т.к.
  // alpha($darkened) всегда 1).
  if (flags.darkRgb) {
    vars.push([`dark-${name}-rgb`, darkenedRgb.join(',')])
  }

  if (flags.darkFilled) {
    vars.push([`dark-filled-${name}`, rgbaToHexa(darkenedRgb)])
  }

  return vars
}

function buildThemeCss(preset: ThemePresetName): { css: string; isNight: boolean } {
  const colorMap = presetToColorMap(preset)
  const isNight = DARK_PRESETS.has(preset)
  const surfaceRgb = hexToRgb(colorMap['surface-color'])

  const declarations: string[] = []

  for (const name of Object.keys(appColorMap) as AppColorName[]) {
    let hex = colorMap[name]

    // CARRY из Task 2 / tweb themeController.ts:889: в тёмных темах
    // message-out-primary-color всегда белый (текст/иконки исходящих бабблов
    // поверх сплошной заливки), а не производный от акцента.
    if (isNight && name === 'message-out-primary-color') {
      hex = '#ffffff'
    }

    const vars = buildAppColorVars(name, hex, appColorMap[name], surfaceRgb)
    for (const [varName, value] of vars) {
      declarations.push(`--${varName}:${value};`)
    }
  }

  return { css: `:root{${declarations.join('')}}`, isNight }
}

/**
 * Строит CSS-переменные темы для встроенного пресета и инжектит их в
 * единственный `<style id="theme">` в `<head>`. Тоглит `.night` на
 * `<html>` и `data-theme` атрибут. Nil-safe для worker/SSR.
 */
export function setTheme(preset: ThemePresetName): void {
  if (typeof document === 'undefined') return

  const { css, isNight } = buildThemeCss(preset)

  getOrCreateStyleEl().textContent = css
  document.documentElement.classList.toggle('night', isNight)
  document.documentElement.setAttribute('data-theme', preset)

  currentPreset = preset
}

export function getCurrentPreset(): ThemePresetName | null {
  return currentPreset
}
