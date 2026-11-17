// Package server exposes the workspace API: the file browser, previews and the
// git panel, served by the module that owns none of the bytes but all of the
// routing.
package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"gitee.com/kobeyoung81/nanoworkspace/internal/agents"
	"gitee.com/kobeyoung81/nanoworkspace/internal/auth"
	"gitee.com/kobeyoung81/nanoworkspace/internal/metrics"
	"gitee.com/kobeyoung81/nanoworkspace/internal/tunnel"
)

// browserPrefixes are the mounts of this surface: the historical user prefix and
// the target-state module prefix. The container's hypervisor serves the same
// routes under /api/v1, which is what hypervisorPath builds.
var browserPrefixes = []string{"/api/user/v1", "/api/v1/workspace"}

// hypervisorPath rewrites a browser path onto the container's namespace.
func hypervisorPath(p string) string {
	for _, prefix := range browserPrefixes {
		if rest, ok := strings.CutPrefix(p, prefix); ok {
			return "/api/v1" + rest
		}
	}
	return "/api/v1" + p
}

// defaultMaxFileBytes caps one uploaded file. It is an application limit, not a
// transport one: the tunnel carries chunks, so raising this (or setting
// NANOSEC_WORKSPACE_MAX_FILE_BYTES) is the whole change needed for bigger files.
const defaultMaxFileBytes int64 = 2 << 30

// loadMaxFileBytes reads the upload cap from the environment.
func loadMaxFileBytes() int64 {
	if raw := strings.TrimSpace(os.Getenv("NANOSEC_WORKSPACE_MAX_FILE_BYTES")); raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	return defaultMaxFileBytes
}

// Server is the HTTP surface.
type Server struct {
	jwt     *auth.Validator
	agents  *agents.Client
	tunnels *tunnel.Client
	srv     *http.Server
	// MaxFileBytes is the upload cap; the caller may lower or raise it.
	MaxFileBytes int64
}

// New builds the server. uiDir optionally carries this module's front end (see
// plugin_files.go); an empty directory just means "no page from this module".
func New(addr string, jwt *auth.Validator, ag *agents.Client, tn *tunnel.Client, uiDir string) *Server {
	s := &Server{jwt: jwt, agents: ag, tunnels: tn, MaxFileBytes: loadMaxFileBytes()}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": Version})
	})
	// Operational numbers, anonymous; isPublicPath keeps it out of the token check.
	mux.Handle("GET /metrics", metrics.Handler())
	s.registerUIRoutes(mux, uiDir)
	// Two prefixes, one implementation. /api/user/v1/ is the browser's
	// historical path; /api/v1/workspace/ is the target-state one, where the
	// module is named in the path so every prefix has exactly one owner. The old
	// prefix stays as an alias until no caller uses it.
	for _, prefix := range browserPrefixes {
		s.registerFileRoutes(mux, prefix)
	}
	s.srv = &http.Server{Addr: addr, Handler: metrics.Middleware(s.authenticate(mux)), ReadHeaderTimeout: 10 * time.Second}
	return s
}

// registerFileRoutes mounts the file and git surface under one prefix.
func (s *Server) registerFileRoutes(mux *http.ServeMux, prefix string) {
	mux.HandleFunc("GET "+prefix+"/files/{agentID}", s.handleList)
	mux.HandleFunc("GET "+prefix+"/files/{agentID}/content", s.handleContentGET)
	mux.HandleFunc("PUT "+prefix+"/files/{agentID}/content", s.handleContentPUT)
	mux.HandleFunc("DELETE "+prefix+"/files/{agentID}/content", s.handleContentDELETE)
	mux.HandleFunc("POST "+prefix+"/files/{agentID}/mkdir", s.handleMkdir)
	mux.HandleFunc("POST "+prefix+"/files/{agentID}/rename", s.handleRename)
	mux.HandleFunc("POST "+prefix+"/files/{agentID}/copy", s.handleCopy)
	mux.HandleFunc(prefix+"/git/{agentID}/{rest...}", s.handleGit)
}

// ListenAndServe blocks until the listener closes.
func (s *Server) ListenAndServe() error { return s.srv.ListenAndServe() }

// Shutdown stops the listener.
func (s *Server) Shutdown() error { return s.srv.Close() }

// authenticate requires a valid browser token on every route but the probe and
// this module's front end (a script tag carries no token; the page's data calls do).
func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isPublicPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		if s.jwt == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authentication is not configured"})
			return
		}
		value := r.Header.Get("Authorization")
		const prefix = "Bearer "
		if len(value) <= len(prefix) || !strings.EqualFold(value[:len(prefix)], prefix) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		identity, err := s.jwt.Validate(strings.TrimSpace(value[len(prefix):]))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r.WithContext(auth.WithIdentity(r.Context(), identity)))
	})
}

// authorize resolves the agent's owner and applies the access rule: a manager
// (admin, support) may read anyone's workspace, writes belong to the owner, and
// a normal user sees only their own agents.
func (s *Server) authorize(w http.ResponseWriter, r *http.Request, agentID string, write bool) (string, bool) {
	identity, ok := auth.FromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return "", false
	}
	owner, found, err := s.agents.Owner(r.Context(), agentID)
	if err != nil {
		slog.Error("resolve agent owner", "agent_id", agentID, "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "agent lookup failed"})
		return "", false
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return "", false
	}
	if write {
		if identity.UserID != owner {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
			return "", false
		}
		return owner, true
	}
	if identity.CanManageUsers() || identity.UserID == owner {
		return owner, true
	}
	writeJSON(w, http.StatusForbidden, map[string]string{"error": "not the agent owner"})
	return "", false
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	owner, ok := s.authorize(w, r, agentID, false)
	if !ok {
		return
	}
	path := "/api/v1/files/" + url.PathEscape(agentID)
	if q := r.URL.Query().Get("path"); q != "" {
		path += "?path=" + url.QueryEscape(q)
	}
	s.forward(w, r, owner, http.MethodGet, path, nil, 0)
}

func (s *Server) handleContentGET(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	owner, ok := s.authorize(w, r, agentID, false)
	if !ok {
		return
	}
	path := "/api/v1/files/" + url.PathEscape(agentID) + "/content"
	if q := r.URL.Query().Get("path"); q != "" {
		path += "?path=" + url.QueryEscape(q)
	}
	s.forward(w, r, owner, http.MethodGet, path, nil, 0)
}

// handleContentPUT uploads a file. Only the owner may write.
func (s *Server) handleContentPUT(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	owner, ok := s.authorize(w, r, agentID, true)
	if !ok {
		return
	}
	path := "/api/v1/files/" + url.PathEscape(agentID) + "/content"
	if q := r.URL.Query().Get("path"); q != "" {
		path += "?path=" + url.QueryEscape(q)
	}
	s.forward(w, r, owner, http.MethodPut, path, r.Body, r.ContentLength)
}

func (s *Server) handleContentDELETE(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	owner, ok := s.authorize(w, r, agentID, true)
	if !ok {
		return
	}
	path := "/api/v1/files/" + url.PathEscape(agentID) + "/content"
	if q := r.URL.Query().Get("path"); q != "" {
		path += "?path=" + url.QueryEscape(q)
	}
	s.forward(w, r, owner, http.MethodDelete, path, nil, 0)
}

func (s *Server) handleMkdir(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	owner, ok := s.authorize(w, r, agentID, true)
	if !ok {
		return
	}
	path := "/api/v1/files/" + url.PathEscape(agentID) + "/mkdir"
	if q := r.URL.Query().Get("path"); q != "" {
		path += "?path=" + url.QueryEscape(q)
	}
	s.forward(w, r, owner, http.MethodPost, path, nil, 0)
}

func (s *Server) handleRename(w http.ResponseWriter, r *http.Request) {
	s.forwardPathPair(w, r, "rename")
}

func (s *Server) handleCopy(w http.ResponseWriter, r *http.Request) {
	s.forwardPathPair(w, r, "copy")
}

// forwardPathPair handles the two operations that take path and to.
func (s *Server) forwardPathPair(w http.ResponseWriter, r *http.Request, op string) {
	agentID := r.PathValue("agentID")
	owner, ok := s.authorize(w, r, agentID, true)
	if !ok {
		return
	}
	query := url.Values{}
	if p := r.URL.Query().Get("path"); p != "" {
		query.Set("path", p)
	}
	if to := r.URL.Query().Get("to"); to != "" {
		query.Set("to", to)
	}
	path := "/api/v1/files/" + url.PathEscape(agentID) + "/" + op
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}
	s.forward(w, r, owner, http.MethodPost, path, nil, 0)
}

// handleGit forwards any git-panel request verbatim: the hypervisor's git API
// owns the operations, and the panel addresses them by path.
func (s *Server) handleGit(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	if agentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agentID is required"})
		return
	}
	owner, ok := s.authorize(w, r, agentID, r.Method != http.MethodGet)
	if !ok {
		return
	}
	// The browser's prefix differs from the hypervisor's; the rest of the path
	// is forwarded verbatim, so the panel and the container agree on operations.
	path := hypervisorPath(r.URL.Path)
	if q := r.URL.RawQuery; q != "" {
		path += "?" + q
	}
	s.forward(w, r, owner, r.Method, path, r.Body, r.ContentLength)
}

// forward puts the request on the container's tunnel and copies the answer
// back. Both directions stream: the request body is handed to the tunnel as the
// browser sends it, and the answer is copied as it arrives, so a large file
// never sits in this process.
func (s *Server) forward(w http.ResponseWriter, r *http.Request, owner, method, path string, body io.Reader, contentLength int64) {
	if contentLength > 0 && contentLength > s.MaxFileBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file exceeds max size"})
		return
	}
	resp, err := s.tunnels.DoStream(r.Context(), owner, method, path, r.Header, body, contentLength)
	if err != nil {
		slog.Warn("forward to the agent failed", "agent_owner", owner, "path", path, "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "forward to the agent failed"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	// The relay marks its own failures, so a 404 from the container (a missing
	// file) keeps its meaning while "no tunnel here" does not.
	switch resp.Header.Get(tunnel.RelayErrorHeader) {
	case "":
	case "offline":
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "the agent container is not reachable"})
		return
	case "busy":
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "the agent container is busy; retry shortly"})
		return
	case "too_large":
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "this agent's container predates large-file transfer; restart it and retry"})
		return
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "forward to the agent failed"})
		return
	}

	copyResponseHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// copyResponseHeaders forwards end-to-end headers, including Content-Length and
// Content-Range: the browser needs them for progress and for range requests.
func copyResponseHeaders(dst http.Header, src http.Header) {
	for key, values := range src {
		switch http.CanonicalHeaderKey(key) {
		case "Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
			"Te", "Trailer", "Transfer-Encoding", "Upgrade", tunnel.RelayErrorHeader:
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// newRequestID gives each forwarded request its correlation id.
func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "request"
	}
	return hex.EncodeToString(b[:])
}
