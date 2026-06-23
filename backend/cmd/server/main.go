package main

import (
	"github.com/messenger-denis/backend/internal/app"
	"go.uber.org/fx"
)

func main() {
	fx.New(app.Module).Run()
}
