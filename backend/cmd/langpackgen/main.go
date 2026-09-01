// Команда langpackgen снимает снимок словарей клиента для сервера.
//
// Переводы правятся В ФАЙЛАХ КЛИЕНТА (`web-client/src/lang.ts`,
// `web-client/src/i18n/dict.*.ts`) — это единственный их источник. Здесь они не
// правятся никогда: команда только переписывает
// `internal/langsource/langpack.gen.json` по тем файлам.
//
//	cd backend && go run ./cmd/langpackgen
//
// Забыть про перегенерацию не страшно: расхождение снимка с файлами красит
// сторожевой тест (`internal/langsource`).
//
// Команда ещё и ВЕРСИОНИРУЕТ языки: версия каждого растёт на один, если его
// строки изменились относительно предыдущего снимка. Версия живёт в снимке, а
// не в базе, потому что уменьшаться ей нельзя никогда — разбор в докблоке
// `langsource.Language.Version`.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/messenger-denis/backend/internal/langsource"
)

func main() {
	root := flag.String("root", "..", "корень репозитория (в нём лежит web-client/)")
	out := flag.String("out", filepath.Join("internal", "langsource", "langpack.gen.json"), "куда писать снимок")
	flag.Parse()

	// Версии проставляются ПО ПРЕДЫДУЩЕМУ снимку: он вшит в этот самый бинарь,
	// который `go run` собирает из текущего файла. Правился перевод — версия
	// языка растёт на один, не правился — остаётся прежней.
	previous, err := langsource.Embedded()
	if err != nil {
		log.Fatal(err)
	}
	// Сам разбор и простановка версий живут в пакете (langsource.Generate), а
	// не здесь: команду не покрывает ни один тест, и сторож снимка обязан
	// проверять ровно то, что она пишет.
	pack, err := langsource.Generate(*root, previous)
	if err != nil {
		log.Fatal(err)
	}

	raw, err := langsource.Marshal(pack)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*out, raw, 0o644); err != nil {
		log.Fatal(err)
	}

	total := 0
	for _, l := range pack.Languages {
		mark := ""
		for _, was := range previous.Languages {
			if was.Code == l.Code && was.Version != l.Version {
				mark = fmt.Sprintf("  ← версия %d → %d", was.Version, l.Version)
			}
		}
		fmt.Printf("%-3s %-11s %5d строк, версия %d%s\n", l.Code, l.Name, len(l.Strings), l.Version, mark)
		total += len(l.Strings)
	}
	fmt.Printf("снимок: %s, %d языков, %d строк\n", *out, len(pack.Languages), total)
}
