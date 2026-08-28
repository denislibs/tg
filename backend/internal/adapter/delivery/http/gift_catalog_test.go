package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	pgadapter "github.com/messenger-denis/backend/internal/adapter/repo/postgres"
	"github.com/messenger-denis/backend/internal/store/postgres"
)

// Позиция каталога — ТОТ ЖЕ конструктор `starGift`, каким она едет внутри
// `savedStarGift` (витрина профиля) и `messageActionStarGift` (пилюля ленты).
//
// Прежде каталог был единственным местом, где та же позиция выходила на провод
// ВТОРОЙ, плоской формой (price_stars/sold_out/total/remains): строка таблицы
// star_gifts сериализовалась как есть. Одна позиция — одна форма.
func TestGiftCatalog_StarGiftConstructor_HTTP(t *testing.T) {
	pool := postgres.NewTestDB(t)
	uc := newChatUC(pool)
	uc.SetStars(pgadapter.NewStarsRepo(pool))
	h := NewRouter(newAuthUC(pool), uc, nil, nil, nil, nil, nil, nil, nil, NewICEHandler("", "test"), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	token, _ := signUp(t, h, pool, "+79990000501")

	// Ограниченный подарок: `limited` и пара availability_* делят один бит и
	// обязаны ехать вместе — на безлимитном этого не видно.
	if _, err := pool.Exec(t.Context(),
		`INSERT INTO star_gifts (emoji, title, price_stars, convert_stars, total, remains, sort)
		 VALUES ('🐻','Медведь-испытатель',100,70,1000,7,-1)`); err != nil {
		t.Fatalf("seed gift: %v", err)
	}

	rec := authedReq(t, h, http.MethodGet, "/gifts/catalog", token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /gifts/catalog: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Gifts []map[string]any `json:"gifts"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("ответ не разбирается: %v", err)
	}
	if len(body.Gifts) == 0 {
		t.Fatal("каталог пуст")
	}
	var bear map[string]any
	for _, g := range body.Gifts {
		if g["_"] != "starGift" {
			t.Fatalf("позиция каталога = %v; ждали конструктор starGift", g)
		}
		if g["title"] == "Медведь-испытатель" {
			bear = g
		}
	}
	if bear == nil {
		t.Fatalf("посеянный подарок не приехал: %v", body.Gifts)
	}
	if bear["stars"] != float64(100) || bear["convert_stars"] != float64(70) {
		t.Errorf("цена/обмен = %v/%v; ждали stars=100, convert_stars=70", bear["stars"], bear["convert_stars"])
	}
	// Внешность — НАШ параметр emoji: стикера подарка у нас нет вовсе.
	if bear["emoji"] != "🐻" {
		t.Errorf("emoji = %v", bear["emoji"])
	}
	flags, _ := bear["pFlags"].(map[string]any)
	if flags["limited"] != true {
		t.Errorf("pFlags = %v; ограниченный подарок обязан нести limited", flags)
	}
	if flags["sold_out"] == true {
		t.Errorf("подарок с остатком помечен sold_out: %v", flags)
	}
	if bear["availability_total"] != float64(1000) || bear["availability_remains"] != float64(7) {
		t.Errorf("остаток = %v/%v; ждали 7 из 1000",
			bear["availability_remains"], bear["availability_total"])
	}
	// Плоской формы на проводе больше нет ни у одной позиции.
	for _, gone := range []string{`"price_stars"`, `"sold_out"`, `"total"`, `"remains"`} {
		if strings.Contains(rec.Body.String(), gone) {
			t.Errorf("в каталоге остался плоский ключ %s: %s", gone, rec.Body.String())
		}
	}
}
