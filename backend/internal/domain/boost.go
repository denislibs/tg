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

// PremiumBoostsStatusTag — дискриминатор `_` конструктора premium.boostsStatus.
const PremiumBoostsStatusTag = "premium.boostsStatus"

// premium.boostsStatus#4959427a flags:# my_boost:flags.2?true level:int
// current_level_boosts:int boosts:int gift_boosts:flags.4?int
// next_level_boosts:flags.0?int premium_audience:flags.1?StatsPercentValue
// boost_url:string prepaid_giveaways:flags.3?Vector<PrepaidGiveaway>
// my_boost_slots:flags.2?Vector<int> = premium.BoostsStatus;
//
// Состояние бустов канала. Пер-зрительская часть (my_boost, my_boost_slots)
// в КАДР не идёт — тело одно на всех подписчиков; она приезжает ручкой
// статуса, где зритель известен.
//
// Чего нет и почему:
//   - boost_url — ссылка-приглашение бустнуть; deep-link'ов у нас нет вовсе
//     (параметр обязательный, поэтому назван в OmittedWithoutSubject);
//   - gift_boosts / premium_audience / prepaid_giveaways — предмета нет;
//   - my_boost_slots — у нас число СВОБОДНЫХ слотов зрителя, а не их
//     идентификаторы, и в общий кадр оно не идёт по правилу выше.
type PremiumBoostsStatus struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Level      int             `json:"level"`
	// CurrentLevelBoosts — порог ТЕКУЩЕГО уровня, Boosts — сколько бустов
	// сейчас, NextLevelBoosts — порог следующего (у последнего уровня его нет).
	CurrentLevelBoosts int  `json:"current_level_boosts"`
	Boosts             int  `json:"boosts"`
	NextLevelBoosts    *int `json:"next_level_boosts,omitempty"`
}

// ToWire — состояние бустов в форме схемы. viewer=false — общий кадр: личная
// часть (мой буст) в него не идёт.
func (s BoostStatus) ToWire(viewer bool) PremiumBoostsStatus {
	out := PremiumBoostsStatus{
		Underscore:         PremiumBoostsStatusTag,
		Level:              s.Level,
		CurrentLevelBoosts: s.CurrentLevelBoosts,
		Boosts:             s.BoostsCount,
	}
	if s.NextLevelBoosts > s.CurrentLevelBoosts {
		next := s.NextLevelBoosts
		out.NextLevelBoosts = &next
	}
	if viewer {
		setPFlag(&out.PFlags, "my_boost", s.BoostedByMe)
	}
	return out
}
