// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
const _logTimer = Date.now();
export default function dT() {
  return '[' + ((Date.now() - _logTimer) / 1000).toFixed(3) + ']';
}