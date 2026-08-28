// Единственный источник истины о том, какой JSX-рантайм собирает файл.
//
// vite.config.ts и vitest.config.ts подключают `vite-plugin-solid` и
// `@vitejs/plugin-react` на основе ОДНОГО И ТОГО ЖЕ паттерна: solid()
// получает его как `include`, react() — как `exclude`. Так «включён в Solid»
// и «исключён из React» физически не могут разойтись — это одно условие,
// а не два текста, которые правятся по отдельности и рискуют рассинхрониться
// (что и произошло: `/\.solid\.tsx?$/` не совпадал с `*.solid.test.tsx`,
// и такой файл попадал под ОБА плагина сразу).
//
// Совпадают обе формы имени: `mountSolid.solid.tsx` и `transform.solid.test.tsx`.
export const SOLID_FILE_PATTERN = /\.solid\.(?:test\.)?tsx$/

export function isSolidFile(fileName: string): boolean {
  return SOLID_FILE_PATTERN.test(fileName)
}
