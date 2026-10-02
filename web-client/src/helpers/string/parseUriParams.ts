// Порт tweb `src/helpers/string/parseUriParams.ts` (812502980) 1:1; `any` оригинала —
// словарь строк.
export default function parseUriParams(uri: string, splitted = uri.split('?')): Record<string, string> {
  try {
    const url = new URL(uri)
    const obj: Record<string, string> = {}
    for(const [key, value] of url.searchParams.entries()) {
      obj[key] = value
    }

    return obj
  } catch{
    return parseUriParamsLine(splitted?.[1])
  }
}

export function parseUriParamsLine(line: string | undefined): Record<string, string> {
  const params: Record<string, string> = {}
  if(!line) {
    return params
  }

  line.split('&').forEach((item) => {
    const [key, value = ''] = item.split('=')
    params[key] = decodeURIComponent(value)
  })

  return params
}
