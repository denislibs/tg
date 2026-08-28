package http

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// Календарь медиа отдаёт КОНТЕЙНЕР схемы: отрезки дней плюс сами сообщения.
//
// Прежде здесь ехал вектор безымянных словарей `{day, id, media_id, type,
// has_thumb}` — выжимка медиа рядом с самим медиа. У оригинала ячейку дня
// наполняет объект сообщения (`datePicker.tsx:437-444` кладёт `message` и
// рисует превью из `message.media`), а `periods` он не читает вовсе.
//
// Подсистема не была покрыта ВООБЩЕ — пятая такая после черновиков, отложенных,
// тем форума и участников звонка.
func TestCalendar_ContainerCarriesMessagesNotDigest(t *testing.T) {
	h, pool := newMediaRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990140001")
	_, idB := signUp(t, h, pool, "+79990140002")

	peer := createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB}))
	cid := itoa(peer)

	// Два фото в один день: отрезок обязан насчитать два, а в ячейку уехать
	// одно сообщение-превью.
	var mediaIDs []int64
	for range 2 {
		rec := authedReq(t, h, http.MethodPost, "/media/upload", tokenA,
			map[string]any{"mime": "image/jpeg", "size": 2048, "width": 100, "height": 100})
		if rec.Code != http.StatusOK {
			t.Fatalf("загрузка: %d %s", rec.Code, rec.Body.String())
		}
		var created struct {
			MediaID int64 `json:"media_id"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil || created.MediaID == 0 {
			t.Fatalf("медиа не создано: %v (%s)", err, rec.Body.String())
		}
		mediaIDs = append(mediaIDs, created.MediaID)
	}
	for _, id := range mediaIDs {
		rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenA,
			map[string]any{"type": "photo", "media_id": id})
		if rec.Code != http.StatusOK {
			t.Fatalf("отправка фото: %d %s", rec.Code, rec.Body.String())
		}
	}

	month := time.Now().UTC().Unix()
	rec := authedReq(t, h, http.MethodGet, "/chats/"+cid+"/calendar?month="+itoa(month), tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("календарь: %d %s", rec.Code, rec.Body.String())
	}

	var out struct {
		Underscore string `json:"_"`
		Count      int    `json:"count"`
		MinDate    int64  `json:"min_date"`
		MinMsgID   int64  `json:"min_msg_id"`
		Periods    []struct {
			Underscore string `json:"_"`
			Date       int64  `json:"date"`
			MinMsgID   int64  `json:"min_msg_id"`
			MaxMsgID   int64  `json:"max_msg_id"`
			Count      int    `json:"count"`
		} `json:"periods"`
		Messages []struct {
			Underscore string         `json:"_"`
			ID         int64          `json:"id"`
			Media      map[string]any `json:"media"`
		} `json:"messages"`
		Users []map[string]any `json:"users"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("контейнер не разбирается: %v (%s)", err, rec.Body.String())
	}

	if out.Underscore != "messages.searchResultsCalendar" {
		t.Fatalf("_ = %q, ожидался контейнер календаря", out.Underscore)
	}
	if len(out.Periods) != 1 {
		t.Fatalf("отрезков %d, ожидался один день: %s", len(out.Periods), rec.Body.String())
	}
	p := out.Periods[0]
	if p.Underscore != "searchResultsCalendarPeriod" || p.Count != 2 {
		t.Fatalf("отрезок = %+v; ожидались конструктор и счётчик 2", p)
	}
	if p.MinMsgID == 0 || p.MaxMsgID <= p.MinMsgID {
		t.Fatalf("границы отрезка = %d..%d", p.MinMsgID, p.MaxMsgID)
	}
	if out.Count != 2 || out.MinDate != p.Date || out.MinMsgID != p.MinMsgID {
		t.Fatalf("границы контейнера = %+v; ожидались выведенные из отрезка", out)
	}

	// САМО СООБЩЕНИЕ, а не выжимка: у него есть вложение конструктором.
	if len(out.Messages) != 1 {
		t.Fatalf("сообщений %d, ожидалось одно превью дня: %s", len(out.Messages), rec.Body.String())
	}
	m := out.Messages[0]
	if m.Underscore != "message" || m.ID != p.MaxMsgID {
		t.Fatalf("превью = %+v; ожидалось последнее сообщение дня %d", m, p.MaxMsgID)
	}
	if m.Media["_"] != "messageMediaPhoto" {
		t.Fatalf("вложение превью = %v; ожидался конструктор фото", m.Media["_"])
	}

	// Прежней выжимки на проводе нет ни в каком виде.
	var raw []map[string]any
	if json.Unmarshal(rec.Body.Bytes(), &raw) == nil {
		t.Fatalf("витрина всё ещё вектор словарей: %s", rec.Body.String())
	}
}
