package server

// This module's front end.
//
// It is a module-federation remote the portal's shell loads at runtime from
// /plugins/workspace/. Three rules the plain file server gets wrong for a bundle:
// the page is public (the shell's loader has no token for a script tag, and the
// page's data calls carry the user's token themselves), there is no index to serve
// (a directory request must not list the folder), and only the fingerprinted assets
// may be cached — the entry point and the manifest keep their names across
// releases.

import (
	"log/slog"
	"net/http"
	"os"
	"strings"
)

// uiPath is the namespace this module's front end answers on.
const uiPath = "/plugins/workspace/"

// registerUIRoutes serves the built front end from dir. An empty or missing
// directory is not an error: the module then contributes no page, and the console
// shows the shell's own.
func (s *Server) registerUIRoutes(mux *http.ServeMux, dir string) {
	if dir == "" {
		return
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		slog.Info("no workspace front end in this image", "dir", dir)
		return
	}
	files := http.StripPrefix(uiPath, http.FileServer(http.Dir(dir)))
	mux.Handle("GET "+uiPath, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		if strings.Contains(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	}))
	slog.Info("serving the workspace front end", "dir", dir)
}

// isPublicPath reports whether a request must skip the token check: the probe and
// this module's own front end.
func isPublicPath(path string) bool {
	return path == "/healthz" || strings.HasPrefix(path, uiPath)
}
