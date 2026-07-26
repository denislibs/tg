// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
// Минимальная версия tweb helpers/solid/readValue без зависимости от solid-js:
// разворачивает значение или accessor-функцию. Островку lottie этого достаточно
// (используется только в textColor-пути, который на этапе 1 не задействован).
export default function readValue<T>(value: T | (() => T)): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}