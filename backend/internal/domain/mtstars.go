package domain

// Звёзды на проводе — конструктор starsAmount, а не голое число.
//
// У оригинала звёзды ДРОБНЫЕ: целая часть в `amount`, девять знаков после
// запятой — в `nanos`. Наш баланс целый, поэтому nanos всегда ноль; но форма
// обязана быть той же, иначе первая же дробная цена (а они у оригинала есть)
// не выразится вовсе.

// StarsAmountTag — дискриминатор `_` конструктора starsAmount.
const StarsAmountTag = "starsAmount"

// starsAmount#bbb6b4a3 amount:long nanos:int = StarsAmount;
type StarsAmount struct {
	Underscore string `json:"_"`
	Amount     int64  `json:"amount"`
	// Nanos — дробная часть, миллиардные доли звезды. У нас всегда 0: цены и
	// балансы целые. Параметр обязательный, поэтому едет нулём, а не опускается.
	Nanos int `json:"nanos"`
}

// NewStarsAmount — целое число звёзд.
func NewStarsAmount(amount int64) StarsAmount {
	return StarsAmount{Underscore: StarsAmountTag, Amount: amount}
}
