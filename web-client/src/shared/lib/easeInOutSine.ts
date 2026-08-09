// Порт TWEB/src/helpers/easing/easeInOutSine.ts (t — прошедшее время, b — старт,
// c — дельта, d — длительность).
// Ограничитель `t >= d` — из оригинала и он обязателен: без него косинус продолжает
// крутиться и при t > d значение падает обратно к b (в волне стирания это вернуло бы
// уже стёртую строку и анимация никогда бы не «завершилась»).
export function easeInOutSine(t: number, b: number, c: number, d: number): number {
  return t >= d ? b + c : (-c / 2) * (Math.cos((Math.PI * t) / d) - 1) + b
}
