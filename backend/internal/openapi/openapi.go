// Package openapi embeds the OpenAPI spec and serves it together with a
// Swagger UI page.
package openapi

import (
	_ "embed"
	"net/http"
)

//go:embed openapi.yaml
var spec []byte

// SpecHandler serves the raw OpenAPI YAML at e.g. GET /openapi.yaml.
func SpecHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/yaml")
		_, _ = w.Write(spec)
	}
}

// swaggerHTML loads Swagger UI from a CDN and points it at /openapi.yaml.
const swaggerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Messenger API — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({ url: "/openapi.yaml", dom_id: "#swagger-ui" });
    };
  </script>
</body>
</html>`

// UIHandler serves the Swagger UI page at e.g. GET /swagger.
func UIHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(swaggerHTML))
	}
}
