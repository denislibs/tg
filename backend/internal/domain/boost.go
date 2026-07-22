package domain

// Бусты каналов (Telegram channel boosts). Premium-пользователь имеет
// PremiumBoostSlots слотов; каждый буст канала тратит слот на срок. Уровень
// канала растёт от суммы активных бустов: порог уровня L — треугольное число
// L*(L+1)/2 (каждый следующий уровень стоит на один буст дороже предыдущего
// шага). Значения current/next-level считаются на сервере, клиент рисует лишь
// прогресс (boosts-current)/(next-current) — как в tweb PremiumBoostsStatus.

// PremiumBoostSlots — сколько слотов бустов даёт premium-подписка.
const PremiumBoostSlots = 4

// BoostStatus — состояние бустов канала для конкретного зрителя (read-модель).
type BoostStatus struct {
	Level              int  `json:"level"`
	BoostsCount        int  `json:"boosts_count"`
	CurrentLevelBoosts int  `json:"current_level_boosts"`
	NextLevelBoosts    int  `json:"next_level_boosts"`
	BoostedByMe        bool `json:"boosted_by_me"`
	Slots              int  `json:"slots"` // свободные слоты зрителя (0, если не premium)
}

// BoostThreshold — суммарное число бустов, необходимое для достижения уровня.
// Уровень 0 = 0 бустов; далее треугольный рост.
func BoostThreshold(level int) int {
	if level <= 0 {
		return 0
	}
	return level * (level + 1) / 2
}

// BoostLevelFor вычисляет по общему числу бустов текущий уровень и пороги
// текущего/следующего уровня.
func BoostLevelFor(boosts int) (level, current, next int) {
	for BoostThreshold(level+1) <= boosts {
		level++
	}
	return level, BoostThreshold(level), BoostThreshold(level + 1)
}
