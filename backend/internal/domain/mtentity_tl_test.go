package domain

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/messenger-denis/backend/internal/pkg/tl"
)

// Числовые id конструкторов продублированы в кодеке константами. Это удобно
// читать, но опечатка в одной цифре не даёт ни ошибки сборки, ни падения
// round-trip: мы бы писали и читали одно и то же неправильное число, а
// проявилось бы это только тем, что чужой разбор конструктор не узнаёт. Поэтому
// каждая константа сверяется со схемой.
func TestEntityTL_IDsMatchSchema(t *testing.T) {
	path := filepath.Join("..", "..", "..", "schema", "schema.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("схема не читается (%s): %v", path, err)
	}

	var doc struct {
		API struct {
			Constructors []struct {
				ID        string `json:"id"`
				Predicate string `json:"predicate"`
			} `json:"constructors"`
		} `json:"API"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("схема не разбирается: %v", err)
	}

	fromSchema := make(map[string]int64, len(doc.API.Constructors))
	for _, c := range doc.API.Constructors {
		var v int64
		if _, err := fmt.Sscan(c.ID, &v); err == nil {
			fromSchema[c.Predicate] = v
		}
	}

	if len(entityConstructorIDs) == 0 {
		t.Fatal("таблица конструкторов пуста")
	}

	for predicate, id := range entityConstructorIDs {
		want, ok := fromSchema[predicate]
		if !ok {
			t.Errorf("конструктора %q нет в схеме", predicate)
			continue
		}
		if int64(id) != want {
			t.Errorf("id %q = %d (%#08x), схема говорит %d (%#08x)",
				predicate, id, uint32(id), want, uint32(int32(want)))
		}
	}
}

// Круг «доменный объект → байты → доменный объект» на всех конструкторах сразу.
func TestEntityTL_RoundTrip(t *testing.T) {
	entities := MessageEntities{
		NewMessageEntityBold(0, 4),
		NewMessageEntityItalic(5, 3),
		NewMessageEntityUnderline(9, 2),
		NewMessageEntityStrike(12, 6),
		NewMessageEntityCode(19, 7),
		NewMessageEntityPre(27, 30, "go"),
		NewMessageEntityPre(58, 10, ""), // язык обязателен, но может быть пустым
		NewMessageEntitySpoiler(69, 5),
		NewMessageEntityBlockquote(75, 40, true),
		NewMessageEntityBlockquote(116, 12, false),
		NewMessageEntityTextURL(129, 8, "https://example.org/путь"),
		NewMessageEntityMentionName(138, 6, 1234567890123),
		NewMessageEntityCustomEmoji(145, 2, -987654321098),
	}

	w := tl.NewWriter(0)
	if err := EncodeEntitiesTL(w, entities); err != nil {
		t.Fatalf("запись: %v", err)
	}

	r := tl.NewReader(w.Result())
	got, err := DecodeEntitiesTL(r)
	if err != nil {
		t.Fatalf("чтение: %v", err)
	}
	if r.Remaining() != 0 {
		t.Fatalf("после разбора осталось %d байт", r.Remaining())
	}

	if !reflect.DeepEqual(got, entities) {
		t.Fatalf("после круга разметка изменилась\n получили %#v\n ожидали  %#v", got, entities)
	}
}

// Байты, собранные из НАСТОЯЩЕЙ доменной структуры, обязаны совпасть с общим
// эталоном — тем самым, который на другой стороне разбирает неизменённый
// десериализатор tweb (web-client/scripts/crosscheck).
//
// До этого теста эталон собирался вызовами writer'а вручную. Теперь проверяется
// вся цепочка: доменный объект → кодек → байты → чужой разбор.
func TestEntityTL_MatchesSharedGolden(t *testing.T) {
	cases := []struct {
		vector string
		entity MessageEntity
	}{
		{"messageEntityBold", NewMessageEntityBold(5, 11)},
		{"messageEntityTextUrl", NewMessageEntityTextURL(0, 4, "https://example.org")},
		{"messageEntityBlockquoteCollapsed", NewMessageEntityBlockquote(2, 30, true)},
		{"messageEntityBlockquotePlain", NewMessageEntityBlockquote(2, 30, false)},
	}

	for _, tc := range cases {
		t.Run(tc.vector, func(t *testing.T) {
			w := tl.NewWriter(0)
			if err := EncodeEntityTL(w, tc.entity); err != nil {
				t.Fatalf("запись: %v", err)
			}

			got := hex.EncodeToString(w.Result())
			want := sharedGolden(t, tc.vector)
			if got != want {
				t.Fatalf("байты доменного объекта разошлись с общим эталоном\n получили %s\n ожидали  %s", got, want)
			}
		})
	}
}

func sharedGolden(t *testing.T, name string) string {
	t.Helper()

	path := filepath.Join("..", "..", "..", "schema", "testdata", "tl-golden.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("эталон не читается (%s): %v", path, err)
	}

	var doc struct {
		Vectors []struct {
			Name string `json:"name"`
			Hex  string `json:"hex"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("эталон не разбирается: %v", err)
	}

	for _, v := range doc.Vectors {
		if v.Name == name {
			return v.Hex
		}
	}
	t.Fatalf("вектора %q нет в эталоне", name)
	return ""
}

// Неизвестный конструктор при чтении — ошибка, а не пропуск: длину чужого
// конструктора вычислить неоткуда, поэтому пропустить его нельзя, не потеряв
// синхронизацию с остатком буфера. Это отличие от разбора JSON, где элемент с
// чужим `_` отбрасывается ради сохранности остальной разметки.
func TestEntityTL_UnknownConstructorIsError(t *testing.T) {
	w := tl.NewWriter(0)
	w.ConstructorID(0x0BADF00D)
	w.Int(0)
	w.Int(1)

	if _, err := DecodeEntityTL(tl.NewReader(w.Result())); err == nil {
		t.Fatal("чужой конструктор должен давать ошибку, а не молча разбираться")
	}
}
