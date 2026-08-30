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

	pack, err := langsource.Extract(*root)
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
		fmt.Printf("%-3s %-11s %5d строк\n", l.Code, l.Name, len(l.Strings))
		total += len(l.Strings)
	}
	fmt.Printf("снимок: %s, %d языков, %d строк\n", *out, len(pack.Languages), total)
}
