// Порт 1:1 (в объёме PR-1, см. бриф Task 3) логики build+inject из tweb
// `src/helpers/themeController.ts` (`applyAppColor`/`applyTheme`), урезанной до
// синхронной генерации CSS-переменных для 4 встроенных пресетов. Формулы
// производных — из tweb `src/scss/mixins/_splitColor.scss` + `functions.scss`
// (`hover-color`, `rgba-to-rgb`) и реального рантайм-эквивалента этих формул в
// `applyAppColor` (themeController.ts:536-587): там же — дефолтная alpha 0.08,
// совпадающая с `$hover-alpha` из tweb `scss/variables.scss:6`.
//
// ВАЖНО: 0.08/surface-color — это ДЕФОЛТ параметров `applyAppColor`, а не
// единственное значение. В `applyTheme` (themeController.ts:800-891) часть
// вызовов `applyAppColor` передаёт свои lightenAlpha/darkenAlpha/mixColor —
// перенесены сюда 1:1 в виде override-таблицы (см. `getColorOverride` ниже,
// каждый кейс — с точной ссылкой на строку в tweb).
//
// НЕ портировано (out-of-scope PR-1, см. бриф): View Transitions API/reveal
// (THEME_TRANSITION_TIMEOUT, dispatchHeavyAnimationEvent), accent-preset
// (applyAccentPreset — произвольный акцент, включая сам факт того, что в tweb
// `--primary-color`/`--saved-color`/`--message-out-primary-color` реально
// строятся из `changeColorAccent(...)`, а не из статичного `colorMap[name]` —
// у нас это дефолтный/безакцентный случай, поэтому берём literal-хексы из
// `presetToColorMap`, как и Task 2), реальная tinted-деривация (iOS-подобный
// wallpaper-blend/surface, themeController.ts:748-831, ветка
// `if (themeName === 'tinted')`) — tinted берётся статично из
// `presetToColorMap('tinted')` как есть. `setTheme` синхронный.

import type { AppColor, AppColorName, ThemePresetName } from '../../config/themePresets'
import { appColorMap, presetToColorMap } from '../../config/themePresets'
import { hexToRgb, hslaToRgba, mixColors, rgbaToHexa, rgbaToHsla } from '../../shared/lib/color'
import type { ColorRgb } from '../../shared/lib/color'

// tweb scss/variables.scss:6 `$hover-alpha: .08;` = дефолт `lightenAlpha` в
// сигнатуре `applyAppColor` (themeController.ts:540); `darkenAlpha = lightenAlpha`
// по умолчанию (themeController.ts:541), если явно не переопределён.
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

// Параметры одной производной-генерации после применения override'а (см. ниже).
type ColorDerivationParams = {
  lightenAlpha: number
  darkenAlpha: number
  mixColorRgb: ColorRgb
}

// Override-таблица per-token параметров `applyAppColor`, СНЯТАЯ 1:1 с реальных
// вызовов внутри tweb `applyTheme` (themeController.ts:800-891). Для имён, не
// перечисленных здесь, действуют дефолты `applyAppColor`: lightenAlpha=darkenAlpha
// =0.08 (=$hover-alpha), mixColor=surface-color текущей темы (themeController.ts:562;
// в самом tweb дефолт для *этого* прохода — `defaultMixColor`, который равен
// iOS-derived surface только для tinted (out-of-scope здесь, см. шапку файла) —
// поэтому для всех непереопределённых имён и для tinted тоже берём surface-color
// как в day/night/light).
//
// Обошёл applyTheme целиком (все applyAppColor-вызовы, строки 805-891) —
// остальные вызовы это либо base hex для tinted-ветки (out-of-scope, не про
// производные), либо попадают под дефолт. Полный список override'ов:
//   - primary-color              — themeController.ts:805-809
//   - saved-color                — themeController.ts:811-816
//   - message-out-background-color — themeController.ts:837, 881-885
//   - message-out-primary-color  — themeController.ts:887-891
function getColorOverride(
  name: AppColorName,
  isNight: boolean,
  colorMap: Record<AppColorName, string>,
): Partial<ColorDerivationParams> {
  switch (name) {
    case 'primary-color':
      // tweb :805-809 — applyAppColor({name: 'primary-color', darkenAlpha: 0.04}).
      // lightenAlpha/mixColor не переданы → дефолт (0.08 / surface).
      return { darkenAlpha: 0.04 }

    case 'saved-color':
      // tweb :811-816 — applyAppColor({name: 'saved-color', lightenAlpha: 0.64,
      // mixColor: [255, 255, 255]}). У saved-color нет dark-флагов (appColorMap:
      // {lightFilled: true}), поэтому darkenAlpha фактически не используется.
      return { lightenAlpha: 0.64, mixColorRgb: [255, 255, 255] }

    case 'message-out-background-color': {
      // tweb :837 `messageLightenAlpha = isNight ? 1 : 0.12` + :881-885
      // applyAppColor({..., lightenAlpha: messageLightenAlpha}) — darkenAlpha не
      // передан явно → по дефолту сигнатуры applyAppColor равен lightenAlpha.
      const alpha = isNight ? 1 : 0.12
      return { lightenAlpha: alpha, darkenAlpha: alpha }
    }

    case 'message-out-primary-color':
      // tweb :887-891 — applyAppColor({..., mixColor: newMessageOutBackgroundColor}).
      // lightenAlpha/darkenAlpha не переданы → дефолт 0.08. mixColor — это
      // message-out-background-color (уже посчитанный presetToColorMap), а не
      // surface-color.
      return { mixColorRgb: hexToRgb(colorMap['message-out-background-color']) }

    default:
      return {}
  }
}

// Порт `applyAppColor` (themeController.ts:536-587) — генерация производных
// переменных для одного AppColorName по его hex-значению, флагам appColorMap и
// разрешённым (с учётом override) lightenAlpha/darkenAlpha/mixColor.
function buildAppColorVars(name: AppColorName, hex: string, flags: AppColor, params: ColorDerivationParams): CssVar[] {
  const { lightenAlpha, darkenAlpha, mixColorRgb } = params
  const rgb = hexToRgb(hex)
  const hsla = rgbaToHsla(...rgb)

  // tweb: darkenedHsla = {...hsla, l: hsla.l - darkenAlpha * 100}.
  const darkenedHsla = { ...hsla, l: hsla.l - darkenAlpha * 100 }
  const darkenedRgb = hslaToRgba(darkenedHsla.h, darkenedHsla.s, darkenedHsla.l, 1).slice(0, 3) as ColorRgb

  const vars: CssVar[] = [[name, hex]]

  if (flags.rgb) {
    vars.push([`${name}-rgb`, rgb.join(',')])
  }

  if (flags.light) {
    // tweb: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${lightenAlpha})` — hover-color(color).
    vars.push([`light-${name}`, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${lightenAlpha})`])
  }

  if (flags.lightFilled) {
    // tweb: rgbaToHexa(mixColors(rgb, mixColor, lightenAlpha)) — rgba-to-rgb(light, surface).
    vars.push([`light-filled-${name}`, rgbaToHexa(mixColors(rgb, mixColorRgb, lightenAlpha))])
  }

  if (flags.dark) {
    // tweb: `hsl(${darkenedHsla.h}, ${darkenedHsla.s}%, ${darkenedHsla.l}%)` — darken(color, darkenAlpha).
    vars.push([`dark-${name}`, `hsl(${darkenedHsla.h}, ${darkenedHsla.s}%, ${darkenedHsla.l}%)`])
  }

  // darkRgb/darkFilled: в реальном tweb-рантайме darkFilled закомментирован
  // (themeController.ts:576, к тому же дублирует ключ 'dark-' + name — мёртвый
  // код), а darkRgb нигде не генерируется (только объявлен в типе AppColor,
  // ни разу не используется потребителем в scss). Формулы ниже — честная
  // достройка по аналогии с rgb/lightFilled (симметрично: rgb канала
  // затемнённого цвета; rgba-to-rgb от затемнённого с alpha=1 — по формуле
  // _splitColor.scss это тождественно самому затемнённому цвету, т.к.
  // alpha($darkened) всегда 1, mixColor не влияет).
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

    const override = getColorOverride(name, isNight, colorMap)
    const params: ColorDerivationParams = {
      lightenAlpha: override.lightenAlpha ?? HOVER_ALPHA,
      darkenAlpha: override.darkenAlpha ?? override.lightenAlpha ?? HOVER_ALPHA,
      mixColorRgb: override.mixColorRgb ?? surfaceRgb,
    }

    const vars = buildAppColorVars(name, hex, appColorMap[name], params)
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
