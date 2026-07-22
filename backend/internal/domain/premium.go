package domain

import "time"

// PremiumSubscription is a user's Telegram Premium subscription (clone: the
// "purchase" is a mock, there is no real billing). Its presence with an
// ExpiresAt in the future is what grants the User.IsPremium badge.
type PremiumSubscription struct {
	UserID     int64
	Plan       string
	PriceCents int
	StartedAt  time.Time
	ExpiresAt  time.Time
	AutoRenew  bool
}

// PremiumPlan is one buyable subscription tier: an id, its duration in months
// and its price in cents (USD, matching the "$N" mock checkout button).
type PremiumPlan struct {
	ID         string
	Months     int
	PriceCents int
}

// premiumPlans lists the offered tiers (1 / 6 / 12 months), keyed by id. The
// longer plans are cheaper per month, mirroring Telegram's pricing.
var premiumPlans = map[string]PremiumPlan{
	"1m":  {ID: "1m", Months: 1, PriceCents: 499},
	"6m":  {ID: "6m", Months: 6, PriceCents: 2499},
	"12m": {ID: "12m", Months: 12, PriceCents: 4499},
}

// PremiumPlanByID looks up a plan tier by its id; ok is false for an unknown id.
func PremiumPlanByID(id string) (PremiumPlan, bool) {
	p, ok := premiumPlans[id]
	return p, ok
}
