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

// Ф7-И1: ручка, у которой 500 — единственный исход ошибки usecase, считает
// отказ (нет объекта, нет прав, неверный аргумент) сбоем сервера. Такой 500
// клиент вправе повторять (tweb apiManager.ts:800-808), и детерминированный
// отказ зациклил бы запрос. Охранный тест: функция пакета, у которой все
// `writeError` — 500 либо разбор входа (400/401), а 500 есть, обязана быть в
// списке исключений ниже. Новая ручка с такой формой краснит тест — её ветку
// ошибки надо пустить через writeDomainError.
func TestHandlers_NoOnly500Outcome(t *testing.T) {
	// Исключения: 500 здесь не ошибка usecase.
	allowed := map[string]string{
		"PublicHandler.internalError":      "хелпер публичных страниц: сбой чтения, не отказ usecase",
		"PasskeyHandler.BeginRegistration": "ошибка библиотеки webauthn",
		"PasskeyHandler.BeginLogin":        "ошибка библиотеки webauthn / json.Marshal",
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
				if !ok || fd.Body == nil {
					continue
				}
				total, five, soft := 0, 0, 0
				ast.Inspect(fd.Body, func(n ast.Node) bool {
					c, ok := n.(*ast.CallExpr)
					if !ok {
						return true
					}
					if id, ok := c.Fun.(*ast.Ident); !ok || id.Name != "writeError" || len(c.Args) < 2 {
						return true
					}
					total++
					if sel, ok := c.Args[1].(*ast.SelectorExpr); ok {
						switch sel.Sel.Name {
						case "StatusInternalServerError":
							five++
						case "StatusBadRequest", "StatusUnauthorized":
							soft++
						}
					}
					return true
				})
				if five == 0 || five+soft != total {
					continue
				}
				name := fd.Name.Name
				if fd.Recv != nil && len(fd.Recv.List) > 0 {
					recv := fd.Recv.List[0].Type
					if star, ok := recv.(*ast.StarExpr); ok {
						recv = star.X
					}
					if id, ok := recv.(*ast.Ident); ok {
						name = id.Name + "." + name
					}
				}
				if _, ok := allowed[name]; !ok {
					bad = append(bad, name)
				}
			}
		}
	}
	sort.Strings(bad)
	if len(bad) > 0 {
		t.Fatalf("ручки, где 500 — единственный исход (пустить ошибку через writeDomainError):\n  %s", strings.Join(bad, "\n  "))
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
