// Команда tl-schemagen печатает таблицу конструкторов TL для Go по общей схеме.
//
//	go run ./cmd/tl-schemagen
//
// Источник — `schema/` в корне репозитория (тот же, из которого фронт печатает
// `layer.d.ts`), результат — `internal/pkg/tl/schema_gen.go`. Дрейф ловит пин
// `tl.TestSchemaTableMatchesSchema`.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/messenger-denis/backend/internal/pkg/tl/schemagen"
)

func main() {
	schemaDir := flag.String("schema", filepath.Join("..", "schema"), "каталог со схемой TL")
	out := flag.String("out", filepath.Join("internal", "pkg", "tl", "schema_gen.go"), "куда печатать таблицу")
	flag.Parse()

	body, err := generate(*schemaDir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "tl-schemagen:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*out, body, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "tl-schemagen:", err)
		os.Exit(1)
	}
	fmt.Printf("tl-schemagen: %s, %d байт\n", *out, len(body))
}

func generate(schemaDir string) ([]byte, error) {
	schema, err := os.ReadFile(filepath.Join(schemaDir, "schema.json"))
	if err != nil {
		return nil, err
	}
	additional, err := os.ReadFile(filepath.Join(schemaDir, "schema_additional_params.json"))
	if err != nil {
		return nil, err
	}
	return schemagen.Generate(schema, additional)
}
