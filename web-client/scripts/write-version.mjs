// Генератор версии сборки (порт tweb src/scripts/change_version.js, портируемая часть).
//
// Единый источник build/versionFull для рантайма и кэш-баста:
//   - build       — монотонный integer из package.json "build" (или env VITE_BUILD);
//   - versionFull — `${version} (${build})`, ровно как tweb App.versionFull.
//
// Пишет `public/version` (его вкладка фетчит раз в 30 мин и сравнивает с вкомпиленным
// __APP_VERSION_FULL__ — см. src/core/version/versionCheck.ts) и вшивает build в имя
// app-shell-кэша внутри `public/sw.js` (статичный файл, Vite его не трогает), чтобы новый
// деплой поднимал свежий кэш, а activate-логика подчищала старые app-shell-*.
//
// Идемпотентно: повторный прогон с тем же build ничего не меняет. Вызывается из
// vite.config.ts (buildStart — покрывает документированный `npx vite build`) и из
// npm-скрипта `prebuild`.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function computeVersion() {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))
  const build = Number(process.env.VITE_BUILD) || Number(pkg.build) || 1
  const versionFull = `${pkg.version} (${build})`
  return { build, versionFull }
}

export function writeVersion() {
  const { build, versionFull } = computeVersion()

  writeFileSync(resolve(root, 'public/version'), versionFull, 'utf-8')

  const swPath = resolve(root, 'public/sw.js')
  const sw = readFileSync(swPath, 'utf-8')
  const next = sw.replace(/const APP_SHELL = '[^']*'/, `const APP_SHELL = 'app-shell-${build}'`)
  if (next !== sw) writeFileSync(swPath, next, 'utf-8')

  return { build, versionFull }
}

// Прямой запуск (npm prebuild / вручную).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { build, versionFull } = writeVersion()
  console.log(`[write-version] ${versionFull} → public/version, app-shell-${build}`)
}
