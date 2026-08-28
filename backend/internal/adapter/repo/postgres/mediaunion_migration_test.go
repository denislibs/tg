package postgres

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0107 доводит объединение MessageMedia: восемь собственных ключей
// вложения в ЗАМОРОЖЕННЫХ кадрах журналов становятся одним конструктором.
//
// Цена ошибки та же, что у 0100/0101/0106: кадр, оставленный в старой форме,
// становится ВТОРЫМ источником истины на проводе — клиент, догоняющий разрыв
// через /sync, увидит вложение в форме, которой больше нет нигде. Поэтому
// проверяем на настоящих строках в настоящем Postgres, включая круг Down → Up.
const mediaUnionMigrationPrevVersion = 106

// mediaOfFrame — вложение из замороженного кадра (ключ media на верхнем уровне).
func mediaOfFrame(t *testing.T, payload map[string]any) map[string]any {
	t.Helper()
	md, ok := payload["media"].(map[string]any)
	if !ok {
		t.Fatalf("в кадре нет вложения: %v", payload)
	}
	return md
}

func framePayload(t *testing.T, pool *pgxpool.Pool, pts int64) map[string]any {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(context.Background(),
		`SELECT payload FROM updates WHERE pts=$1`, pts).Scan(&raw); err != nil {
		t.Fatalf("чтение кадра pts=%d: %v", pts, err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("кадр не разбирается (%s): %v", raw, err)
	}
	return out
}

func TestMigration0107_ConvertsMediaUnion(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, mediaUnionMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", mediaUnionMigrationPrevVersion, err)
	}

	alice := seedUser(t, pool, "+79990000301")
	bob := seedUser(t, pool, "+79990000302")

	var chatID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO chats (type, title) VALUES ('group','Команда') RETURNING id`).Scan(&chatID); err != nil {
		t.Fatalf("seed chat: %v", err)
	}

	// Чек-лист: отметка со ВРЕМЕНЕМ, которого в старом кадре не было вовсе.
	var checklistID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO checklists (chat_id, title, items, others_can_add)
		 VALUES ($1,'дела','[{"id":1,"text":"хлеб"},{"id":2,"text":"кот"}]'::jsonb,true) RETURNING id`,
		chatID).Scan(&checklistID); err != nil {
		t.Fatalf("seed checklist: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO checklist_marks (checklist_id, item_id, user_id, marked_at)
		 VALUES ($1,1,$2, to_timestamp(1700000000))`, checklistID, alice); err != nil {
		t.Fatalf("seed mark: %v", err)
	}

	// Розыгрыш + сообщение, которым он запущен: launch_msg_id обязателен, а
	// кадр giveaway_update номера не несёт.
	var giveawayID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO giveaways (chat_id, creator_id, prize_kind, stars, winners_count, until_date, status, winner_ids)
		 VALUES ($1,$2,'stars',500,2, to_timestamp(1700003600), 'finished', '[1,2]'::jsonb) RETURNING id`,
		chatID, alice).Scan(&giveawayID); err != nil {
		t.Fatalf("seed giveaway: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO messages (chat_id, seq, sender_id, type, text, giveaway_id)
		 VALUES ($1, 42, $2, 'giveaway', '', $3)`, chatID, alice, giveawayID); err != nil {
		t.Fatalf("seed giveaway message: %v", err)
	}

	// Подарок: владельца в кадре нет, он поднимается из saved_star_gifts —
	// saved_id без peer в схеме не собирается, они делят один бит.
	var catalogID, savedID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO star_gifts (emoji, title, price_stars, convert_stars, total, remains)
		 VALUES ('🎁','Мишка',100,70,1000,7) RETURNING id`).Scan(&catalogID); err != nil {
		t.Fatalf("seed catalog gift: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO saved_star_gifts (owner_id, from_id, gift_id, message)
		 VALUES ($1,$2,$3,'поздравляю') RETURNING id`, bob, alice, catalogID).Scan(&savedID); err != nil {
		t.Fatalf("seed saved gift: %v", err)
	}

	seedFrame := func(pts int64, typ string, payload string) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO updates (user_id, pts, type, payload) VALUES ($1,$2,$3,$4::jsonb)`,
			alice, pts, typ, payload); err != nil {
			t.Fatalf("seed frame pts=%d: %v", pts, err)
		}
	}

	// ── Замороженные кадры в СТАРОЙ форме ───────────────────────────────────
	// Живая трансляция, остановленная досрочно: period обязан укоротиться до
	// момента остановки (edit_date − date).
	seedFrame(1, "new_message", `{"message":{"_":"message","id":1,"date":1700000000,"edit_date":1700000060,
		"message":"","geo":{"lat":55.75,"lng":37.61,"live_period":3600,"live_stopped":true,"heading":90}}}`)
	// Место с подписью — ОТДЕЛЬНЫЙ конструктор, а не два лишних ключа у точки.
	seedFrame(2, "new_message", `{"message":{"_":"message","id":2,"date":1700000000,"message":"",
		"geo":{"lat":55.75,"lng":37.61,"title":"Кремль","address":"Москва"}}}`)
	// Визитка: last_name и vcard обязательны и едут ПУСТЫМИ.
	seedFrame(3, "new_message", `{"message":{"_":"message","id":3,"date":1700000000,"message":"",
		"contact":{"user_id":43,"name":"Боб","phone":"+70000000000"}}}`)
	// Опрос-викторина с голосом зрителя: my_votes/correct_option становятся
	// флагами chosen/correct у конкретного варианта.
	seedFrame(4, "new_message", `{"message":{"_":"message","id":4,"date":1700000000,"message":"",
		"poll":{"id":5,"question":"Столица?","options":["Москва","Питер"],"quiz":true,"correct_option":0,
		        "counts":[3,1],"total_voters":4,"my_votes":[0],"anonymous":false}}}`)
	// Платное медиа под замком: настоящего вложения в векторе быть не должно.
	seedFrame(5, "new_message", `{"message":{"_":"message","id":5,"date":1700000000,"message":"",
		"media":{"_":"messageMediaPhoto","photo":{"_":"photo","id":0,"sizes":[
			{"_":"photoStrippedSize","type":"i","bytes":"AQID"},
			{"_":"photoSize","type":"w","w":800,"h":600,"size":0}]}},
		"paid_media":{"price":50,"locked":true}}}`)
	// Превью ссылки: россыпь photo_* становится обычной лестницей ступеней.
	seedFrame(6, "new_message", `{"message":{"_":"message","id":6,"date":1700000000,"message":"ссылка",
		"web_page":{"url":"https://example.org/a/","site_name":"Example","title":"Заголовок",
		            "photo_id":77,"photo_w":1600,"photo_h":1200,"photo_blur":"AQID","photo_has_thumb":true,
		            "has_iv":true}}}`)
	// Подарок: сообщение меняет КОНСТРУКТОР — становится служебным.
	seedFrame(7, "new_message", `{"message":{"_":"message","id":7,"date":1700000000,"message":"",
		"gift":{"id":`+itoa(savedID)+`,"gift":{"id":`+itoa(catalogID)+`,"emoji":"🎁","title":"Мишка",
		        "price_stars":100,"convert_stars":70,"total":1000,"remains":7,"sold_out":false},
		        "from_id":`+itoa(alice)+`,"from_name":"Алиса","message":"поздравляю",
		        "anonymous":false,"hidden":false,"converted":false,"convert_stars":70}}}`)
	// Чек-лист: отметки уезжают ОТДЕЛЬНЫМ вектором и со временем из таблицы.
	seedFrame(8, "checklist_update", `{"checklist":{"id":`+itoa(checklistID)+`,"title":"дела",
		"others_can_add":true,"others_can_mark":false,
		"items":[{"id":1,"text":"хлеб","marked_by":[`+itoa(alice)+`]},{"id":2,"text":"кот","marked_by":[]}]}}`)
	// Розыгрыш: per-viewer поля уходят из кадра вовсе.
	seedFrame(9, "giveaway_update", `{"giveaway":{"id":`+itoa(giveawayID)+`,"peer_id":`+itoa(-chatID)+`,
		"prize_kind":"stars","stars":500,"months":0,"winners_count":2,"until_date":1700003600000,
		"status":"finished","participants":7,"participating":true,"winner_ids":[1,2],"i_won":true}}`)
	// Кадр обновления координат: тот же конструктор, что и в сообщении.
	seedFrame(10, "geo_live_update", `{"id":1,"edit_date":1700000060,
		"geo":{"lat":55.75,"lng":37.61,"live_period":3600,"heading":90}}`)
	// Кадр-патч реакции сообщением не является и меняться не должен.
	seedFrame(11, "reaction", `{"id":1,"emoji":"👍"}`)

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0107: %v", err)
	}

	msgOf := func(pts int64) map[string]any {
		t.Helper()
		p := framePayload(t, pool, pts)
		m, ok := p["message"].(map[string]any)
		if !ok {
			t.Fatalf("в кадре pts=%d нет сообщения: %v", pts, p)
		}
		return m
	}

	// ── Гео ─────────────────────────────────────────────────────────────────
	live := mediaOfFrame(t, msgOf(1))
	if live["_"] != "messageMediaGeoLive" {
		t.Fatalf("трансляция = %v", live)
	}
	// Остановлена = ИСТЕКЛА: period укорочен до момента остановки.
	if live["period"] != float64(60) {
		t.Errorf("period остановленной трансляции = %v, ждали 60", live["period"])
	}
	if _, ok := live["live_stopped"]; ok {
		t.Error("live_stopped пережил перевод — в схеме такого параметра нет")
	}
	if geo, _ := live["geo"].(map[string]any); geo["_"] != "geoPoint" || geo["long"] != 37.61 {
		t.Errorf("точка = %v, ждали geoPoint с параметром long", live["geo"])
	}
	if _, ok := msgOf(1)["geo"]; ok {
		t.Error("ключ geo остался рядом с media")
	}

	venue := mediaOfFrame(t, msgOf(2))
	if venue["_"] != "messageMediaVenue" || venue["title"] != "Кремль" || venue["address"] != "Москва" {
		t.Errorf("место = %v", venue)
	}

	// ── Визитка ─────────────────────────────────────────────────────────────
	contact := mediaOfFrame(t, msgOf(3))
	if contact["_"] != "messageMediaContact" || contact["first_name"] != "Боб" {
		t.Fatalf("визитка = %v", contact)
	}
	// Обязательные параметры едут ПУСТЫМИ, а не исчезают.
	if v, ok := contact["last_name"]; !ok || v != "" {
		t.Errorf("last_name = %v, ждали пустую строку", contact["last_name"])
	}
	if v, ok := contact["vcard"]; !ok || v != "" {
		t.Errorf("vcard = %v, ждали пустую строку", contact["vcard"])
	}

	// ── Опрос ───────────────────────────────────────────────────────────────
	poll := mediaOfFrame(t, msgOf(4))
	if poll["_"] != "messageMediaPoll" {
		t.Fatalf("опрос = %v", poll)
	}
	p, _ := poll["poll"].(map[string]any)
	if pf, _ := p["pFlags"].(map[string]any); pf["quiz"] != true || pf["public_voters"] != true {
		t.Errorf("флаги опроса = %v, ждали quiz и public_voters (анонимность — ОТРИЦАНИЕ)", p["pFlags"])
	}
	res, _ := poll["results"].(map[string]any)
	answers, _ := res["results"].([]any)
	if len(answers) != 2 {
		t.Fatalf("итоги вариантов = %v", res["results"])
	}
	first, _ := answers[0].(map[string]any)
	if pf, _ := first["pFlags"].(map[string]any); pf["chosen"] != true || pf["correct"] != true {
		t.Errorf("первый вариант = %v, ждали выбор зрителя и правильный ответ", first)
	}
	if first["option"] != "AA==" {
		t.Errorf("ключ варианта = %v, ждали номер одним байтом в base64", first["option"])
	}
	second, _ := answers[1].(map[string]any)
	if _, ok := second["pFlags"]; ok {
		t.Errorf("у невыбранного варианта появился pFlags: %v", second)
	}

	// ── Платное медиа ───────────────────────────────────────────────────────
	paid := mediaOfFrame(t, msgOf(5))
	if paid["_"] != "messageMediaPaidMedia" || paid["stars_amount"] != float64(50) {
		t.Fatalf("платное медиа = %v", paid)
	}
	items, _ := paid["extended_media"].([]any)
	if len(items) != 1 {
		t.Fatalf("вектор платного медиа = %v", paid["extended_media"])
	}
	item, _ := items[0].(map[string]any)
	if item["_"] != "messageExtendedMediaPreview" {
		t.Fatalf("позиция под замком = %v, ждали заглушку", item)
	}
	if _, ok := item["media"]; ok {
		t.Error("настоящее вложение уехало неоплатившему зрителю")
	}
	if item["w"] != float64(800) || item["h"] != float64(600) {
		t.Errorf("коробка кадра = %v x %v", item["w"], item["h"])
	}

	// ── Превью ссылки ───────────────────────────────────────────────────────
	wp := mediaOfFrame(t, msgOf(6))
	if wp["_"] != "messageMediaWebPage" {
		t.Fatalf("превью = %v", wp)
	}
	page, _ := wp["webpage"].(map[string]any)
	if page["display_url"] != "example.org/a" {
		t.Errorf("display_url = %v", page["display_url"])
	}
	photo, _ := page["photo"].(map[string]any)
	sizes, _ := photo["sizes"].([]any)
	if len(sizes) != 3 {
		t.Fatalf("лестница картинки превью = %v, ждали stripped + 'y' + оригинал", page["photo"])
	}
	thumb, _ := sizes[1].(map[string]any)
	if thumb["type"] != "y" || thumb["w"] != float64(1280) || thumb["h"] != float64(960) {
		t.Errorf("ступень 'y' = %v, ждали 1280x960", thumb)
	}
	for _, key := range []string{"photo_w", "photo_h", "photo_blur", "photo_has_thumb", "photo_id"} {
		if _, ok := page[key]; ok {
			t.Errorf("плоское поле картинки %q пережило перевод", key)
		}
	}

	// ── Подарок ─────────────────────────────────────────────────────────────
	gift := msgOf(7)
	if gift["_"] != "messageService" {
		t.Fatalf("подарок = %v, ждали messageService", gift["_"])
	}
	if _, ok := gift["media"]; ok {
		t.Error("у подарка осталось media — поля media у messageService нет вовсе")
	}
	act, _ := gift["action"].(map[string]any)
	if act["_"] != "messageActionStarGift" {
		t.Fatalf("действие = %v", gift["action"])
	}
	if _, ok := act["from_name"]; ok {
		t.Error("имя дарителя строкой пережило перевод")
	}
	if peer, _ := act["peer"].(map[string]any); peer == nil || int64(peer["user_id"].(float64)) != bob {
		t.Errorf("владелец подарка = %v, ждали %d из saved_star_gifts", act["peer"], bob)
	}
	if int64(act["saved_id"].(float64)) != savedID {
		t.Errorf("saved_id = %v", act["saved_id"])
	}
	sg, _ := act["gift"].(map[string]any)
	if sg["_"] != "starGift" || sg["emoji"] != "🎁" {
		t.Fatalf("подарок каталога = %v", act["gift"])
	}
	if pf, _ := sg["pFlags"].(map[string]any); pf["limited"] != true {
		t.Errorf("ограниченность подарка = %v, ждали limited парой с остатком", sg["pFlags"])
	}
	if sg["availability_total"] != float64(1000) || sg["availability_remains"] != float64(7) {
		t.Errorf("остаток подарка = %v / %v", sg["availability_total"], sg["availability_remains"])
	}

	// ── Чек-лист ────────────────────────────────────────────────────────────
	todo := mediaOfFrame(t, framePayload(t, pool, 8))
	if todo["_"] != "messageMediaToDo" {
		t.Fatalf("чек-лист = %v", todo)
	}
	list, _ := todo["todo"].(map[string]any)
	if pf, _ := list["pFlags"].(map[string]any); pf["others_can_append"] != true || pf["others_can_complete"] == true {
		t.Errorf("права чек-листа = %v", list["pFlags"])
	}
	done, _ := todo["completions"].([]any)
	if len(done) != 1 {
		t.Fatalf("отметки = %v, ждали одну", todo["completions"])
	}
	mark, _ := done[0].(map[string]any)
	// Время отметки существовало в checklist_marks с самого начала, но плоскому
	// marked_by его некуда было положить.
	if mark["date"] != float64(1700000000) {
		t.Errorf("время отметки = %v, ждали 1700000000 из checklist_marks", mark["date"])
	}
	if by, _ := mark["completed_by"].(map[string]any); by["_"] != "peerUser" {
		t.Errorf("автор отметки = %v, ждали ссылку на пир", mark["completed_by"])
	}
	if _, ok := framePayload(t, pool, 8)["checklist"]; ok {
		t.Error("ключ checklist остался в кадре")
	}

	// ── Розыгрыш ────────────────────────────────────────────────────────────
	gw := mediaOfFrame(t, framePayload(t, pool, 9))
	if gw["_"] != "messageMediaGiveawayResults" {
		t.Fatalf("розыгрыш = %v, ждали конструктор ИТОГОВ", gw)
	}
	if gw["launch_msg_id"] != float64(42) {
		t.Errorf("launch_msg_id = %v, ждали номер сообщения-запуска", gw["launch_msg_id"])
	}
	if gw["channel_id"] != float64(chatID) {
		t.Errorf("channel_id = %v, ждали id канала БЕЗ знака", gw["channel_id"])
	}
	if gw["until_date"] != float64(1700003600) {
		t.Errorf("until_date = %v, ждали секунды эпохи", gw["until_date"])
	}
	if gw["stars"] != float64(500) {
		t.Errorf("приз = %v, ждали звёзды", gw["stars"])
	}
	if _, ok := gw["months"]; ok {
		t.Error("months уехал у ⭐-приза — вид приза выражен ТЕМ, какой параметр присутствует")
	}
	for _, key := range []string{"participating", "i_won", "participants", "prize_kind", "status"} {
		if _, ok := gw[key]; ok {
			t.Errorf("пер-зрительский/наш ключ %q пережил перевод", key)
		}
	}

	// ── geo_live_update ─────────────────────────────────────────────────────
	geoFrame := framePayload(t, pool, 10)
	if md := mediaOfFrame(t, geoFrame); md["_"] != "messageMediaGeoLive" || md["period"] != float64(3600) {
		t.Errorf("кадр трансляции = %v", md)
	}
	if _, ok := geoFrame["geo"]; ok {
		t.Error("плоский ключ geo остался в кадре обновления координат")
	}
	if geoFrame["edit_date"] != float64(1700000060) {
		t.Errorf("edit_date = %v — время обновления живёт рядом, а не внутри вложения", geoFrame["edit_date"])
	}

	// Кадр-патч не менялся.
	if r := framePayload(t, pool, 11); r["emoji"] != "👍" {
		t.Errorf("кадр-патч изменён миграцией: %v", r)
	}

	// ── Круг Down → Up ──────────────────────────────────────────────────────
	if err := storepostgres.MigrateDownTo(url, mediaUnionMigrationPrevVersion); err != nil {
		t.Fatalf("откат 0107: %v", err)
	}
	back := msgOf(1)
	g, _ := back["geo"].(map[string]any)
	if g == nil || g["lat"] != 55.75 {
		t.Fatalf("откат не вернул плоское гео: %v", back)
	}
	// Остановка выводится из ИСТЁКШЕГО срока — тем же признаком, каким её читает
	// клиент: date + period уже наступил. Исходная длительность трансляции при
	// этом не восстанавливается, и Down это называет.
	if g["live_stopped"] != true {
		t.Errorf("откат потерял признак остановки: %v", g)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат 0107: %v", err)
	}
	if md := mediaOfFrame(t, msgOf(1)); md["_"] != "messageMediaGeoLive" {
		t.Errorf("после круга Down → Up вложение = %v", md)
	}
}
