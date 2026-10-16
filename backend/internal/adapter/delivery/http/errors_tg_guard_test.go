package http

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Общая охрана: `writeError(…, 500, …)` пишет только разборщик (fallback
// writeDomainError) и перечисленные исключения. Любая другая ветка — в том числе
// цепочка `if errors.Is(…) {403}; if err != nil {500}` и `switch … default` —
// превращает новый отказ usecase (ErrSlowmodeWait, ErrPrivacy, плата, …) в
// детерминированный 500, который клиент вправе повторять (tweb
// apiManager.ts:800-808). Ловятся `http.StatusInternalServerError`, литерал 500
// и статус-переменная (её значение охрана не видит).
func TestNo500OutsideDomainError(t *testing.T) {
	allowed := map[string]string{
		"writeDomainError":   "сам разборщик",
		"writeLangPackError": "свой закрытый перечень имён langpack.*",
		"internalError":      "хелпер публичных страниц: сбой чтения, не отказ usecase",
	}
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, ".", func(fi os.FileInfo) bool { return !strings.HasSuffix(fi.Name(), "_test.go") }, 0)
	if err != nil {
		t.Fatal(err)
	}
	var bad []string
	for _, pkg := range pkgs {
		for _, f := range pkg.Files {
			for _, d := range f.Decls {
				fd, ok := d.(*ast.FuncDecl)
				if !ok || fd.Body == nil || allowed[fd.Name.Name] != "" {
					continue
				}
				ast.Inspect(fd.Body, func(n ast.Node) bool {
					c, ok := n.(*ast.CallExpr)
					if !ok || len(c.Args) < 2 {
						return true
					}
					if id, ok := c.Fun.(*ast.Ident); !ok || id.Name != "writeError" {
						return true
					}
					switch a := c.Args[1].(type) {
					case *ast.SelectorExpr:
						if a.Sel.Name == "StatusInternalServerError" {
							bad = append(bad, fset.Position(c.Pos()).String())
						}
					case *ast.BasicLit:
						if a.Value == "500" {
							bad = append(bad, fset.Position(c.Pos()).String())
						}
					default:
						// Статус переменной охрана не видит: им может оказаться 500.
						bad = append(bad, fset.Position(c.Pos()).String()+" (статус не константа)")
					}
					return true
				})
			}
		}
	}
	sort.Strings(bad)
	if len(bad) > 0 {
		t.Fatalf("writeError(…500…) мимо writeDomainError (пустить ошибку через разборщик):\n  %s", strings.Join(bad, "\n  "))
	}
}

type notFoundReactions struct{}

func (notFoundReactions) List(context.Context) ([]domain.AvailableReaction, error) {
	return nil, domain.ErrNotFound
}

// Отказ usecase по типу: ErrNotFound каталога — 404, а не 500.
func TestReactionsList_NotFoundIs404(t *testing.T) {
	rec := httptest.NewRecorder()
	NewReactionsHandler(notFoundReactions{}).List(rec, httptest.NewRequest(http.MethodGet, "/reactions", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("код %d %s, ожидался 404", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	NewReactionsHandler(fakeReactionsErr{}).List(rec, httptest.NewRequest(http.MethodGet, "/reactions", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("неизвестная ошибка: %d, ожидался 500", rec.Code)
	}
}
