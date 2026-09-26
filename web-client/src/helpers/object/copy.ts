// Порт tweb `helpers/object/copy.ts` (812502980) 1:1 — глубокая копия.
// Правки только под наш строгий tsconfig (в tweb `strict` выключен): вместо
// `@ts-ignore` — приведения через `unknown`; `var` → `const`; `hasOwnProperty`
// зовётся с `Object.prototype` (правило линтера `no-prototype-builtins`).
export default function copy<T>(obj: T): T {
  // in case of premitives
  if(obj === null || typeof(obj) !== 'object') {
    return obj
  }

  // date objects should be
  if(obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T
  }

  // handle Array
  if(Array.isArray(obj)) {
    return obj.map((el) => copy(el)) as unknown as T
  }

  if(ArrayBuffer.isView(obj)) {
    return (obj as unknown as { slice(): T }).slice()
  }

  // lastly, handle objects
  const clonedObj = new ((obj as object).constructor as new () => Record<string, unknown>)()
  for(const prop in obj) {
    if(Object.prototype.hasOwnProperty.call(obj, prop)) {
      clonedObj[prop] = copy(obj[prop])
    }
  }
  return clonedObj as T
}
