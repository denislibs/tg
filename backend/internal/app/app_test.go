package app

import (
	"testing"

	"go.uber.org/fx"
)

// TestModule_GraphValidates checks that every provider's dependencies are
// satisfiable and the invoke's params resolve — without running any provider
// (so no DB/Redis/MinIO is needed).
func TestModule_GraphValidates(t *testing.T) {
	if err := fx.ValidateApp(Module); err != nil {
		t.Fatalf("fx dependency graph is invalid: %v", err)
	}
}
