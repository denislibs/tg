// Порт tweb `helpers/object/deepEqual.ts` 1:1.
/**
 * ignores `undefined` properties
 * `ignoreKeys` applies only at the top level — it is NOT propagated into nested objects
 */
export default function deepEqual<T>(x: T, y: T, ignoreKeys?: (keyof T)[]): boolean {
  const ignoreSet = ignoreKeys && new Set(ignoreKeys)
  const okok = (obj: Record<string, unknown>) => Object.keys(obj).filter((key) => obj[key] !== undefined)
  const ok = ignoreKeys ? (obj: Record<string, unknown>) => okok(obj).filter((key) => !ignoreSet!.has(key as keyof T)) : okok
  const tx = typeof x
  const ty = typeof y
  return x && y && tx === 'object' && tx === ty ? (
    ok(x as Record<string, unknown>).length === ok(y as Record<string, unknown>).length &&
      ok(x as Record<string, unknown>).every((key) => deepEqual((x as Record<string, unknown>)[key], (y as Record<string, unknown>)[key]))
  ) : (x === y)
}
