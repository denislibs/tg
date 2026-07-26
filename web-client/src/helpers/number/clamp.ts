// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
export default function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}