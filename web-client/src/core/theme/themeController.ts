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
import {
  changeColorAccent,
  getAccentColor,
  getAverageColor,
  hexToRgb,
  hslaToRgba,
  mixColors,
  rgbaToHexa,
  rgbaToHsla,
  rgbToHsv,
} from '../../shared/lib/color'
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

// Общая часть buildThemeCss (Task 3) и deriveChatThemeVars (Task 1, accent-путь
// tweb applyTheme) — прогоняет ВСЕ AppColorName через buildAppColorVars для
// заданного colorMap (в котором вызывающий код уже применил свои overrides —
// сдвиг primary под акцент, пересчёт out-bubble под message_colors и т.п.).
// Имена переменных — БЕЗ ведущего "--" (добавляется на границе конкретного
// потребителя: buildThemeCss — при сборке CSS-текста, deriveChatThemeVars —
// при возврате наружу).
function buildColorMapVars(colorMap: Record<AppColorName, string>, isNight: boolean): CssVar[] {
  const surfaceRgb = hexToRgb(colorMap['surface-color'])
  const declarations: CssVar[] = []

  for (const name of Object.keys(appColorMap) as AppColorName[]) {
    let hex = colorMap[name]

    // tweb themeController.ts:889: в тёмных темах message-out-primary-color
    // всегда белый (текст/иконки исходящих бабблов поверх сплошной заливки),
    // а не производный от акцента/message_colors.
    if (isNight && name === 'message-out-primary-color') {
      hex = '#ffffff'
    }

    const override = getColorOverride(name, isNight, colorMap)
    const params: ColorDerivationParams = {
      lightenAlpha: override.lightenAlpha ?? HOVER_ALPHA,
      darkenAlpha: override.darkenAlpha ?? override.lightenAlpha ?? HOVER_ALPHA,
      mixColorRgb: override.mixColorRgb ?? surfaceRgb,
    }

    declarations.push(...buildAppColorVars(name, hex, appColorMap[name], params))
  }

  return declarations
}

// ВРЕМЕННЫЙ МОСТ (до Task 3 — codemod уберёт и :root-алиасы из _tokens.scss, и
// этот inline-эмит). Ревью Task 2 обнаружило критический CSS-нюанс: в
// _tokens.scss `--tg-accent` и т.п. объявлены ОДИН РАЗ на `:root` как
// `var(--primary-color)`. Когда `applyChatTheme` переопределяет `--primary-color`
// инлайном на ДОЧЕРНЕМ элементе (.root колонки чата), CSS не пересчитывает
// `--tg-accent` — его подставленное значение вычисляется там, где `--tg-accent`
// ФАКТИЧЕСКИ объявлен (на :root, видящим только глобальное `--primary-color`), а
// не там, где он унаследован. Потомки, читающие `--tg-accent` (Composer,
// MessageRow — бабблы/тики/реакции/badges), продолжали бы видеть глобальный
// акцент — no-op. Фикс: эмитим здесь те же СЕМАНТИЧЕСКИЕ --tg-* алиасы инлайн,
// с уже вычисленными (не var()-ссылками) значениями соответствующих tweb-токенов
// — 1:1 зеркало таблицы алиасов из `styles/_tokens.scss :root`.
const SIMPLE_TG_ALIASES: ReadonlyArray<readonly [tgName: string, sourceName: string]> = [
  ['tg-accent', 'primary-color'],
  ['tg-badge', 'primary-color'],
  ['tg-bg', 'background-color'],
  ['tg-appBg', 'background-color'],
  ['tg-sectionBackdrop', 'background-color'],
  ['tg-bubble', 'surface-color'],
  ['tg-sidebarBg', 'surface-color'],
  ['tg-skelBase', 'surface-color'],
  ['tg-bubbleOut', 'message-out-background-color'],
  ['tg-bubbleOutText', 'message-out-primary-color'],
  ['tg-bubbleOutAccent', 'message-out-primary-color'],
  ['tg-dangerText', 'danger-color'],
  ['tg-divider', 'border-color'],
  ['tg-green', 'green-color'],
  ['tg-hover', 'light-secondary-text-color'],
  ['tg-skelHi', 'light-secondary-text-color'],
  ['tg-inputSearchBg', 'input-search-background-color'],
  ['tg-searchBg', 'input-search-background-color'],
  ['tg-link', 'link-color'],
  ['tg-switchOff', 'secondary-color'],
  ['tg-textPrimary', 'primary-text-color'],
  ['tg-textSecondary', 'secondary-text-color'],
  ['tg-textFaint', 'secondary-text-color'],
]

// tweb scss/base.scss:121 — статичная тень, НЕ зависящая от темы/акцента (одна и
// та же на любом пресете) — 1:1 _tokens.scss `--menu-box-shadow`.
const MENU_BOX_SHADOW = '0px 0px 10px rgba(0, 0, 0, 0.15)'

// _tokens.scss `--backdrop-opacity`: 0.85 на day/light, 0.75 на night/tinted.
function backdropOpacity(isNight: boolean): number {
  return isNight ? 0.75 : 0.85
}

function mustGetVar(byName: ReadonlyMap<string, string>, name: string): string {
  const value = byName.get(name)
  if (value === undefined) throw new Error(`themeController: неизвестная переменная-источник алиаса "${name}"`)
  return value
}

// Строит --tg-* алиасы (см. заголовок блока выше) поверх уже посчитанных
// declarations (результат buildColorMapVars) — те же значения, что видит :root,
// просто продублированные под именами, которые реально читают потребители в
// колонке чата.
function buildSemanticAliasVars(declarations: CssVar[], isNight: boolean): CssVar[] {
  const byName = new Map(declarations)

  const aliasVars: CssVar[] = SIMPLE_TG_ALIASES.map(
    ([tgName, sourceName]) => [tgName, mustGetVar(byName, sourceName)] as CssVar,
  )

  // --tg-menuBg: var(--menu-background-color); --menu-background-color:
  // rgba(var(--surface-color-rgb), var(--backdrop-opacity)) (_tokens.scss).
  const surfaceRgb = mustGetVar(byName, 'surface-color-rgb')
  aliasVars.push(['tg-menuShadow', MENU_BOX_SHADOW])
  aliasVars.push(['tg-menuBg', `rgba(${surfaceRgb}, ${backdropOpacity(isNight)})`])

  return aliasVars
}

function buildThemeCss(preset: ThemePresetName): { css: string; isNight: boolean } {
  const colorMap = presetToColorMap(preset)
  const isNight = DARK_PRESETS.has(preset)

  const declarations = buildColorMapVars(colorMap, isNight).map(([varName, value]) => `--${varName}:${value};`)

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

// Порт accent-пути tweb `applyTheme` (themeController.ts:739-898) для темы
// ОТДЕЛЬНОГО ЧАТА (в отличие от buildThemeCss/setTheme выше, которые
// покрывают только 4 встроенных пресета без пользовательского акцента —
// см. шапку файла). Здесь `accentColor`/`messageColors` приходят из
// per-чатовой темы (theme_settings.accent_color / message_colors в tweb,
// уже сконвертированные в hex — см. бриф Task 1).
//
// Переопределяются три токена, 1:1 как в applyTheme:
//   - primary-color               — themeController.ts:792-798 (changeColorAccent)
//   - saved-color                 — themeController.ts:811-816 (тот же newAccentHex,
//     что и primary-color; отдельного пересчёта акцента для saved-color в tweb нет —
//     lightenAlpha:0.64/mixColor:[255,255,255] уже обеспечены существующим
//     getColorOverride('saved-color', ...))
//   - message-out-background/primary-color — themeController.ts:833-891
// Остальные токены остаются literal-хексами пресета — как и в buildThemeCss (см.
// шапку файла: "у нас это дефолтный/безакцентный случай").
// Не портировано: tinted iOS-деривация (themeController.ts:748-831) и
// outbox_accent_color (themeController.ts:871, 887-891) — оба out-of-scope
// Task 1 (см. бриф).
export function deriveChatThemeVars(
  preset: ThemePresetName,
  accentColor: string,
  messageColors: string[],
): Array<[string, string]> {
  const baseColorMap = presetToColorMap(preset)
  const isNight = DARK_PRESETS.has(preset)
  const colorMap: Record<AppColorName, string> = { ...baseColorMap }

  // primary + saved-color: tweb :792-798, :811-816 — оба берут один и тот же
  // newAccentHex = changeColorAccent(rgbToHsv(base), rgbToHsv(accent), baseRgb,
  // !isNight). В tweb `color`-параметр — это тот же baseColors['primary-color'],
  // что и `baseHsv` — поэтому diffH-guard внутри changeColorAccent всегда 0 и не
  // срабатывает (диффузия хвоста применяется только когда base и color различны).
  const basePrimaryRgb = hexToRgb(baseColorMap['primary-color'])
  const newPrimaryRgb = changeColorAccent(
    rgbToHsv(...basePrimaryRgb),
    rgbToHsv(...hexToRgb(accentColor)),
    basePrimaryRgb,
    !isNight,
  )
  const newAccentHex = rgbaToHexa(newPrimaryRgb)
  colorMap['primary-color'] = newAccentHex
  colorMap['saved-color'] = newAccentHex

  // out-bubble: tweb :833-891. Пустой messageColors — как early-return в tweb
  // (`if (!themeSettings.message_colors?.length) return`) — оставляем базовые
  // literal-хексы пресета для message-out-*.
  if (messageColors.length > 0) {
    const surfaceRgb = hexToRgb(baseColorMap['surface-color'])
    const messageLightenAlpha = isNight ? 1 : 0.12
    const baseMessageColor = hexToRgb(baseColorMap['message-out-primary-color'])
    const baseHsv = rgbToHsv(...baseMessageColor)
    const baseMessageOutBackgroundColor = mixColors(baseMessageColor, surfaceRgb, messageLightenAlpha)

    // tweb :845-858 — первый цвет как есть; для >1 цветов — последовательное
    // усреднение (getAverageColor) и затем getAccentColor относительно базы.
    let myMessagesAccent = hexToRgb(messageColors[0])
    for (const nextColor of messageColors.slice(1)) {
      myMessagesAccent = getAverageColor(myMessagesAccent, hexToRgb(nextColor))
    }
    if (messageColors.length > 1) {
      myMessagesAccent = getAccentColor(baseHsv, baseMessageOutBackgroundColor, myMessagesAccent)
    }

    // tweb :873-879 — mixColors + saturation-boost (+63) для non-night.
    let newMessageOutBackgroundColor = mixColors(myMessagesAccent, surfaceRgb, messageLightenAlpha)
    if (!isNight) {
      const hsla = rgbaToHsla(...newMessageOutBackgroundColor)
      const boostedS = Math.min(hsla.s + 63, 100)
      newMessageOutBackgroundColor = hslaToRgba(hsla.h, boostedS, hsla.l, hsla.a).slice(0, 3) as ColorRgb
    }

    colorMap['message-out-background-color'] = rgbaToHexa(newMessageOutBackgroundColor)
    // tweb :887-889 — night принудительно белый (учтено ниже в buildColorMapVars
    // для ЛЮБОГО colorMap), для day/light — посчитанный акцент (outbox_accent_color
    // не портирован, см. комментарий выше функции).
    colorMap['message-out-primary-color'] = isNight ? '#ffffff' : rgbaToHexa(myMessagesAccent)
  }

  const baseVars = buildColorMapVars(colorMap, isNight)
  // Мост --tg-* (см. блок SIMPLE_TG_ALIASES выше) — без него потомки .root,
  // читающие --tg-accent/--tg-bubbleOut/и т.п., не увидят переопределённые здесь
  // tweb-токены (CSS не пересчитывает алиас, объявленный на :root, из override'а
  // на дочернем элементе).
  const aliasVars = buildSemanticAliasVars(baseVars, isNight)

  return [...baseVars, ...aliasVars].map(([name, value]) => [`--${name}`, value])
}

/** Пишет vars из deriveChatThemeVars инлайном на element (--var через style.setProperty). */
export function applyChatTheme(
  element: HTMLElement,
  preset: ThemePresetName,
  accentColor: string,
  messageColors: string[],
): void {
  for (const [name, value] of deriveChatThemeVars(preset, accentColor, messageColors)) {
    element.style.setProperty(name, value)
  }
}

// Набор имён переменных детерминирован (зависит только от appColorMap/
// SIMPLE_TG_ALIASES, не от конкретных hex/preset/messageColors) —
// переиспользуем buildColorMapVars/buildSemanticAliasVars с произвольным
// валидным colorMap только чтобы перечислить имена (включая --tg-* мост).
const CHAT_THEME_BASE_VARS = buildColorMapVars(presetToColorMap('day'), false)
const CHAT_THEME_VAR_NAMES = [...CHAT_THEME_BASE_VARS, ...buildSemanticAliasVars(CHAT_THEME_BASE_VARS, false)].map(
  ([name]) => `--${name}`,
)

/** Снимает inline-переменные, записанные applyChatTheme (сброс на глобальную тему). */
export function clearChatTheme(element: HTMLElement): void {
  for (const name of CHAT_THEME_VAR_NAMES) {
    element.style.removeProperty(name)
  }
}
