package domain

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// Числовые id конструкторов в докблоках — сверка со схемой ПО ВСЕЙ подсистеме
// TL сразу, а не по одному файлу.
//
// Зачем отдельно от посубсистемных сверок. Каждая из них (mtdialog, mtpeer,
// mtmedia, …) проверяет свой файл и дополнительно требует, чтобы докблок с id
// был у КАЖДОГО объявленного конструктора — это утверждение о полноте, и оно
// обязано жить рядом со списком конструкторов. Здесь утверждение другое и
// слабее: если id вообще написан, он должен совпадать со схемой. Зато область
// — все mt*.go, включая те, где посубсистемного пина ещё нет.
//
// Повод завести проверку конкретный. При переводе диалогов у уже сделанного
// медиа нашёлся id из БОЛЕЕ СТАРОГО слоя схемы:
// `documentAttributeVideo#17399fad` при `#43c57c48` в схеме. Прочитать это
// глазами нельзя, а на фазе 2 ровно эти четыре байта уходят в поток, и чужой
// разбор споткнётся именно о них.
//
// Проверяется КОММЕНТАРИЙ, а не исполняемый код, и это не делает проверку
// бессмысленной: докблок — единственное место, где сегодня записано число, и
// генератор кодека фазы 2 будет сверяться с ним же.
func TestDomain_ConstructorIDDocblocksMatchSchema(t *testing.T) {
	schemaIDs := map[string]string{}
	// Свои конструкторы (schema_additional_params.json) — тоже проводные и тоже
	// с назначенным id, поэтому сверяются наравне со схемными. Прежде здесь
	// стояло «в схеме их нет по построению», и это было верно ровно до того,
	// как у нас появился первый собственный конструктор на проводе: его
	// докблок мог разойтись с объявленным числом молча.
	ids := map[string]string{}
	for predicate, ctor := range loadSchemaConstructorIDs(t) {
		ids[predicate] = ctor
	}
	// Свои конструкторы объявлены в schema_additional_params.json и отличаются
	// от клиентских полей наличием id: он есть — значит конструктор идёт на
	// провод, и его докблок сверяется наравне со схемными.
	for predicate, ctor := range loadOwnConstructorIDs(t) {
		ids[predicate] = ctor
	}
	for predicate, ctor := range ids {
		n, err := strconv.ParseInt(ctor, 10, 64)
		if err != nil {
			t.Fatalf("id конструктора %q не число: %v", predicate, err)
		}
		schemaIDs[predicate] = fmt.Sprintf("%08x", uint32(n))
	}

	files, err := filepath.Glob("mt*.go")
	if err != nil {
		t.Fatalf("список файлов подсистемы не читается: %v", err)
	}

	// Строка вида `// predicate#0123abcd param:type … = Type;` в начале комментария.
	re := regexp.MustCompile(`(?m)^//\s*([A-Za-z][A-Za-z0-9_.]*)#([0-9a-f]{8})\b`)
	checked := 0
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("%s не читается: %v", f, err)
		}
		for _, m := range re.FindAllStringSubmatch(string(src), -1) {
			predicate, id := m[1], m[2]
			schemaID, ok := schemaIDs[predicate]
			if !ok {
				// Конструкторы, которых нет ни в схеме, ни среди объявленных
				// нами (секретные чаты, DNP, health — они на провод TL пока не
				// идут вовсе): сверять не с чем.
				continue
			}
			checked++
			if schemaID != id {
				t.Errorf("%s: %s#%s, а в схеме #%s", f, predicate, id, schemaID)
			}
		}
	}

	// Иначе тест «зеленел» бы на пустой выборке — например, если бы регулярка
	// разошлась с принятым в файлах оформлением докблока.
	if checked < 50 {
		t.Errorf("сверено всего %d id — выборка подозрительно мала, проверь регулярку и glob", checked)
	}
}
