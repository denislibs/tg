import type { Plugin } from 'vite'

// Минификатор CSS схлопывает пару backdrop-filter + -webkit-backdrop-filter в один -webkit-,
// но Chrome 150+ выпилил -webkit-алиас, а Firefox его не понимает → блюр пропадал. Возвращаем
// беспрефиксное свойство рядом с каждым -webkit-backdrop-filter в собранном CSS.
export function keepBackdropFilterUnprefixed(): Plugin {
  return {
    name: 'keep-backdrop-filter-unprefixed',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue
        if (typeof file.source !== 'string') continue
        file.source = file.source.replace(
          /-webkit-backdrop-filter:([^;}]+)([;}])/g,
          (full: string, value: string, end: string, offset: number, str: string) =>
            end === ';' && str.slice(offset + full.length).startsWith('backdrop-filter:')
              ? full
              : `-webkit-backdrop-filter:${value};backdrop-filter:${value}${end}`,
        )
      }
    },
  }
}
