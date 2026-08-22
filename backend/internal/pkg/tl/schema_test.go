package tl

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/messenger-denis/backend/internal/pkg/tl/schemagen"
)

// Дрейф таблицы. Она напечатана по общей схеме, и это единственное основание
// ей доверять: правка руками (или расхождение с обновлённой схемой) означает,
// что кодек раскладывает поля не так, как их разбирает другая сторона провода,
// — а такое расхождение видно только по мусору в чужом разборе.
//
// Тот же пин, что у фронта на layer.d.ts (web-client/scripts/layerTypes.test.js).
func TestSchemaTableMatchesSchema(t *testing.T) {
	// backend/internal/pkg/tl → корень репозитория.
	dir := filepath.Join("..", "..", "..", "..", "schema")

	schema, err := os.ReadFile(filepath.Join(dir, "schema.json"))
	if err != nil {
		t.Fatalf("схема не читается: %v", err)
	}
	additional, err := os.ReadFile(filepath.Join(dir, "schema_additional_params.json"))
	if err != nil {
		t.Fatalf("надстройки схемы не читаются: %v", err)
	}

	want, err := schemagen.Generate(schema, additional)
	if err != nil {
		t.Fatalf("таблица не печатается: %v", err)
	}

	got, err := os.ReadFile("schema_gen.go")
	if err != nil {
		t.Fatalf("напечатанная таблица не читается: %v", err)
	}

	if string(got) != string(want) {
		t.Fatal("schema_gen.go разошёлся со схемой — перепечатать: go run ./cmd/tl-schemagen")
	}
}

// Таблица знает конструктор и по имени, и по числу: разбор идёт от числа с
// провода, запись — от дискриминатора модели.
func TestSchemaTable_LookupBothWays(t *testing.T) {
	c, ok := ConstructorByPredicate("photoStrippedSize")
	if !ok {
		t.Fatal("photoStrippedSize в таблице нет")
	}
	if c.ID != -525288402 || c.Type != "PhotoSize" {
		t.Fatalf("photoStrippedSize: id %d, тип %s", c.ID, c.Type)
	}

	byNumber, ok := ConstructorByID(c.ID)
	if !ok || byNumber.Predicate != "photoStrippedSize" {
		t.Fatalf("по числу %d нашёлся %#v", c.ID, byNumber)
	}
}

// Разбор префикса необязательности: маска и позиция бита должны быть сняты со
// строки типа на этапе печати, иначе кодек разбирал бы её на каждом поле.
func TestSchemaTable_OptionalParamsParsed(t *testing.T) {
	c, _ := ConstructorByPredicate("messageEntityBlockquote")

	var collapsed Param
	for _, p := range c.Params {
		if p.Name == "collapsed" {
			collapsed = p
		}
	}

	if collapsed.Type != "true" || collapsed.Flags != "flags" || collapsed.Bit != 0 {
		t.Fatalf("collapsed разобран как %#v", collapsed)
	}
	if !collapsed.Optional() {
		t.Fatal("collapsed объявлен обязательным")
	}
}

// Клиентские поля перечислены по конструкторам, а имена, которые есть и в
// схеме (`document.size`), клиентскими НЕ считаются: там клиентская запись лишь
// уточняет тип для TypeScript, а поле остаётся проводным.
func TestSchemaTable_ClientParams(t *testing.T) {
	if !isClientParam("document", "stickerSetInput") {
		t.Fatal("stickerSetInput не признан клиентским полем документа")
	}
	if isClientParam("document", "size") {
		t.Fatal("document.size признан клиентским, хотя он есть в схеме и едет на провод")
	}
	if !isClientParam("todoList", "id") {
		t.Fatal("наш собственный todoList.id не объявлен клиентским")
	}
}

// Клиентские псевдо-конструкторы оригинала: предмета на проводе у них нет, id
// им никто не назначал. Кодек обязан отвечать про них внятно.
func TestSchemaTable_ClientOnlyPredicates(t *testing.T) {
	if !IsClientOnlyPredicate("messageEntityCaret") {
		t.Fatal("messageEntityCaret не признан клиентским конструктором")
	}
	if IsClientOnlyPredicate("messageActionRestrict") {
		t.Fatal("messageActionRestrict признан клиентским, хотя id ему назначен и он едет на провод")
	}
}
