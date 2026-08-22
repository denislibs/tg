package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0108 доводит до конца два кадра, которых порт не коснулся:
// web_page_update (карточка ссылки ехала собственным плоским ключом) и
// poll_update (итоги ехали без pollResults.pFlags.min, хотя собраны для
// «зрителя 0»).
//
// Цена ошибки та же, что у 0100/0101/0106/0107: кадр, оставленный в старой
// форме, становится ВТОРЫМ источником истины на проводе. У poll_update она
// прямее — переигранный кадр без min теперь СТИРАЕТ выбор зрителя, потому что
// клиент перестал подразумевать урезанность безусловно. Поэтому проверяем на
// настоящих строках в настоящем Postgres, включая круг Down → Up.
const webPageFrameMigrationPrevVersion = 107

func TestMigration0108_WebPageFrameAndPollMin(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, webPageFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", webPageFrameMigrationPrevVersion, err)
	}

	alice := seedUser(t, pool, "+79990000401")

	seedFrame := func(pts int64, typ string, payload string) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO updates (user_id, pts, type, payload) VALUES ($1,$2,$3,$4::jsonb)`,
			alice, pts, typ, payload); err != nil {
			t.Fatalf("seed frame pts=%d: %v", pts, err)
		}
	}

	// ── Замороженные кадры в СТАРОЙ форме ───────────────────────────────────
	// Карточка с картинкой: россыпь photo_* обязана стать лестницей ступеней.
	seedFrame(1, "web_page_update", `{"peer_id":2,"id":6,
		"web_page":{"url":"https://example.org/a/","site_name":"Example","title":"Заголовок",
		            "description":"Описание","photo_id":77,"photo_w":1600,"photo_h":1200,
		            "photo_blur":"AQID","photo_has_thumb":true,"has_iv":true}}`)
	// Карточка без картинки: photo не появляется вовсе, а не едет пустым.
	seedFrame(2, "web_page_update", `{"peer_id":2,"id":7,"web_page":{"url":"https://example.org"}}`)
	// Итоги опроса из кадра: min обязан появиться.
	seedFrame(3, "poll_update", `{"peer_id":2,"media":{"_":"messageMediaPoll",
		"poll":{"_":"poll","id":5,"question":{"_":"textWithEntities","text":"Столица?","entities":[]},
		        "answers":[{"_":"pollAnswer","text":{"_":"textWithEntities","text":"Москва","entities":[]},"option":"AA=="}]},
		"results":{"_":"pollResults","total_voters":4,
		           "results":[{"_":"pollAnswerVoters","option":"AA==","voters":3}]}}}`)
	// Опрос ВНУТРИ сообщения урезанным не считается: голосов у нового
	// сообщения-опроса нет вовсе, стирать нечего.
	seedFrame(4, "new_message", `{"peer_id":2,"message":{"_":"message","id":8,"date":1700000000,"message":"",
		"media":{"_":"messageMediaPoll",
		"poll":{"_":"poll","id":9,"question":{"_":"textWithEntities","text":"?","entities":[]},"answers":[]},
		"results":{"_":"pollResults"}}}}`)
	// Кадр другого вида миграция трогать не должна.
	seedFrame(5, "reaction", `{"id":1,"emoji":"👍"}`)

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0108: %v", err)
	}

	// ── 1. web_page_update ──────────────────────────────────────────────────
	withPhoto := framePayload(t, pool, 1)
	if _, ok := withPhoto["web_page"]; ok {
		t.Error("плоский ключ web_page остался в кадре")
	}
	md := mediaOfFrame(t, withPhoto)
	if md["_"] != "messageMediaWebPage" {
		t.Fatalf("вложение кадра = %v", md)
	}
	page, _ := md["webpage"].(map[string]any)
	if page["_"] != "webPage" || page["url"] != "https://example.org/a/" {
		t.Fatalf("карточка = %v", page)
	}
	if page["display_url"] != "example.org/a" {
		t.Errorf("display_url = %v, ждали адрес без схемы и без хвостового слэша", page["display_url"])
	}
	if page["site_name"] != "Example" || page["title"] != "Заголовок" || page["description"] != "Описание" {
		t.Errorf("текстовая часть карточки = %v", page)
	}
	if page["has_iv"] != true {
		t.Errorf("has_iv = %v", page["has_iv"])
	}
	photo, _ := page["photo"].(map[string]any)
	if photo == nil || photo["_"] != "photo" || photo["id"] != float64(77) {
		t.Fatalf("картинка карточки = %v", page["photo"])
	}
	sizes, _ := photo["sizes"].([]any)
	got := map[string][2]float64{}
	for _, s := range sizes {
		sz, _ := s.(map[string]any)
		switch sz["_"] {
		case "photoStrippedSize":
			if sz["bytes"] != "AQID" {
				t.Errorf("подложка = %v", sz)
			}
			got["i"] = [2]float64{}
		case "photoSize":
			w, _ := sz["w"].(float64)
			h, _ := sz["h"].(float64)
			got[sz["type"].(string)] = [2]float64{w, h}
		}
	}
	// Ступень 'y' вписана в квадрат 1280 (та же арифметика, что у domain.fitThumb),
	// 'w' — оригинал как есть.
	if got["y"] != [2]float64{1280, 960} {
		t.Errorf("ступень y = %v, ждали 1280×960", got["y"])
	}
	if got["w"] != [2]float64{1600, 1200} {
		t.Errorf("ступень w = %v, ждали оригинал 1600×1200", got["w"])
	}
	if _, ok := got["i"]; !ok {
		t.Error("stripped-подложка потерялась")
	}
	for _, key := range []string{"photo_id", "photo_w", "photo_h", "photo_blur", "photo_has_thumb"} {
		if _, ok := page[key]; ok {
			t.Errorf("плоский ключ %q пережил перевод", key)
		}
	}
	// Верх кадра не тронут: адрес сообщения и ключ пира на месте. К моменту
	// головы их имена задаёт конструктор (0121): msg_id и peer.
	peerOfFrame, _ := withPhoto["peer"].(map[string]any)
	if withPhoto["msg_id"] != float64(6) || peerOfFrame["_"] != "peerUser" || peerOfFrame["user_id"] != float64(2) {
		t.Errorf("конверт кадра изменён: %v", withPhoto)
	}

	bare, _ := mediaOfFrame(t, framePayload(t, pool, 2))["webpage"].(map[string]any)
	if _, ok := bare["photo"]; ok {
		t.Errorf("у карточки без картинки появилось фото: %v", bare)
	}
	if bare["display_url"] != "example.org" {
		t.Errorf("display_url = %v", bare["display_url"])
	}

	// ── 2. poll_update ──────────────────────────────────────────────────────
	// Итоги к моменту головы лежат ОТДЕЛЬНЫМ параметром кадра, а не внутри
	// вложения (0121): у оригинала updateMessagePoll устроен именно так.
	results, _ := framePayload(t, pool, 3)["results"].(map[string]any)
	flags, _ := results["pFlags"].(map[string]any)
	if flags["min"] != true {
		t.Errorf("итоги кадра без pFlags.min = %v; кадр собран для «зрителя 0», то есть урезан", results)
	}
	if results["total_voters"] != float64(4) {
		t.Errorf("сами итоги изменились: %v", results)
	}

	inMsg, _ := framePayload(t, pool, 4)["message"].(map[string]any)
	inner, _ := inMsg["media"].(map[string]any)
	innerResults, _ := inner["results"].(map[string]any)
	if _, ok := innerResults["pFlags"]; ok {
		t.Errorf("опросу внутри сообщения приписали урезанность: %v", innerResults)
	}

	if r := framePayload(t, pool, 5); r["emoji"] != "👍" {
		t.Errorf("кадр-патч изменён миграцией: %v", r)
	}

	// ── Круг Down → Up ──────────────────────────────────────────────────────
	if err := storepostgres.MigrateDownTo(url, webPageFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат 0108: %v", err)
	}
	back := framePayload(t, pool, 1)
	wp, _ := back["web_page"].(map[string]any)
	if wp == nil || wp["photo_id"] != float64(77) || wp["photo_w"] != float64(1600) {
		t.Fatalf("откат не вернул плоскую карточку: %v", back)
	}
	if flags, _ := framePayload(t, pool, 3)["media"].(map[string]any)["results"].(map[string]any)["pFlags"].(map[string]any); flags["min"] == true {
		t.Error("откат оставил pFlags.min")
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат 0108: %v", err)
	}
	if md := mediaOfFrame(t, framePayload(t, pool, 1)); md["_"] != "messageMediaWebPage" {
		t.Errorf("после круга Down → Up вложение = %v", md)
	}
}
