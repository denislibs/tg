package http

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Bot API — фасад: снаружи плоская запись чужой документации, внутри —
// конструкторы схемы TL. Пока «типы совпадали», конвертера не было и разница
// была незаметна; теперь она есть, и её надо держать тестом с ОБЕИХ сторон,
// иначе сторонний бот молча потеряет форматирование.

func TestParseEntities_BotAPIToModel(t *testing.T) {
	raw := json.RawMessage(`[
		{"type":"bold","offset":0,"length":4},
		{"type":"italic","offset":4,"length":1},
		{"type":"underline","offset":5,"length":1},
		{"type":"strikethrough","offset":6,"length":1},
		{"type":"code","offset":7,"length":1},
		{"type":"spoiler","offset":8,"length":1},
		{"type":"pre","offset":9,"length":2,"language":"go"},
		{"type":"pre","offset":11,"length":2},
		{"type":"blockquote","offset":13,"length":1},
		{"type":"expandable_blockquote","offset":14,"length":1},
		{"type":"text_link","offset":15,"length":2,"url":"https://example.com/a"},
		{"type":"text_mention","offset":17,"length":2,"user":{"id":77}},
		{"type":"custom_emoji","offset":19,"length":2,"custom_emoji_id":"42"},
		{"type":"hashtag","offset":21,"length":3}
	]`)

	want := domain.MessageEntities{
		domain.NewMessageEntityBold(0, 4),
		domain.NewMessageEntityItalic(4, 1),
		domain.NewMessageEntityUnderline(5, 1),
		domain.NewMessageEntityStrike(6, 1),
		domain.NewMessageEntityCode(7, 1),
		domain.NewMessageEntitySpoiler(8, 1),
		domain.NewMessageEntityPre(9, 2, "go"),
		// Подсказки языка не было — в схеме параметр обязателен, едет пустым.
		domain.NewMessageEntityPre(11, 2, ""),
		domain.NewMessageEntityBlockquote(13, 1, false),
		// В Bot API свёрнутая цитата — отдельный ТИП, в схеме — бит collapsed.
		domain.NewMessageEntityBlockquote(14, 1, true),
		domain.NewMessageEntityTextURL(15, 2, "https://example.com/a"),
		domain.NewMessageEntityMentionName(17, 2, 77),
		domain.NewMessageEntityCustomEmoji(19, 2, 42),
		// hashtag предмета в нашей модели не имеет — клиент выводит его из текста.
	}

	got := parseEntities(raw)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseEntities =\n%#v\nwant\n%#v", got, want)
	}
}

func TestBotAPIEntities_ModelToBotAPI(t *testing.T) {
	in := domain.MessageEntities{
		domain.NewMessageEntityBold(0, 4),
		domain.NewMessageEntityPre(4, 2, "go"),
		domain.NewMessageEntityBlockquote(6, 1, false),
		domain.NewMessageEntityBlockquote(7, 1, true),
		domain.NewMessageEntityTextURL(8, 2, "https://example.com/a"),
		domain.NewMessageEntityMentionName(10, 2, 77),
		domain.NewMessageEntityCustomEmoji(12, 2, 42),
	}

	got, err := json.Marshal(botAPIEntities(in))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	const want = `[{"type":"bold","offset":0,"length":4},` +
		`{"type":"pre","offset":4,"length":2,"language":"go"},` +
		`{"type":"blockquote","offset":6,"length":1},` +
		`{"type":"expandable_blockquote","offset":7,"length":1},` +
		`{"type":"text_link","offset":8,"length":2,"url":"https://example.com/a"},` +
		`{"type":"text_mention","offset":10,"length":2,"user":{"id":77}},` +
		`{"type":"custom_emoji","offset":12,"length":2,"custom_emoji_id":"42"}]`
	if string(got) != want {
		t.Fatalf("botAPIEntities =\n%s\nwant\n%s", got, want)
	}
}

// Круг «Bot API → модель → Bot API» не теряет ничего, что Bot API умеет
// выразить: именно этим конвертер и обязан отличаться от «типы совпадают».
func TestBotAPIEntities_RoundTrip(t *testing.T) {
	raw := json.RawMessage(`[{"type":"bold","offset":0,"length":4},` +
		`{"type":"expandable_blockquote","offset":4,"length":1},` +
		`{"type":"text_mention","offset":5,"length":2,"user":{"id":77}},` +
		`{"type":"custom_emoji","offset":7,"length":2,"custom_emoji_id":"42"}]`)

	back, err := json.Marshal(botAPIEntities(parseEntities(raw)))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var want, got any
	_ = json.Unmarshal(raw, &want)
	_ = json.Unmarshal(back, &got)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("круг Bot API → модель → Bot API разошёлся:\n%s\nvs\n%s", back, raw)
	}
}
