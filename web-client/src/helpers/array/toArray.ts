// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
export default function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}