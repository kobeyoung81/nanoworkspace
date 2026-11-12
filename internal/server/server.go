// Package server exposes the workspace API: the file browser, previews and the
// git panel, served by the module that owns none of the bytes but all of the
// routing.
package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gitee.com/kobeyoung81/nanoprotocol"
	"gitee.com/kobeyoung81/nanoworkspace/internal/agents"
	"gitee.com/kobeyoung81/nanoworkspace/internal/auth"
	"gitee.com/kobeyoung81/nanoworkspace/internal/tunnel"
)

// maxFileBytes mirrors the hypervisor's 10 MiB limit and the portal's old cap:
// buffering more than the other end accepts only wastes memory.
const maxFileBytes = 10 << 20

// Server is the HTTP surface.
type Server struct {
	jwt     *auth.Validator
	agents  *agents.Client
	tunnels *tunnel.Client
	srv     *http.Server
}

// New builds the server.
func New(addr string, jwt *auth.Validator, ag *agents.Client, tn *tunnel.Client) *Server {
	s := &Server{jwt: jwt, agents: ag, tunnels: tn}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/user/v1/files/{agentID}", s.handleList)
	mux.HandleFunc("GET /api/user/v1/files/{agentID}/content", s.handleContentGET)
	mux.HandleFunc("PUT /api/user/v1/files/{agentID}/content", s.handleContentPUT)
	mux.HandleFunc("DELETE /api/user/v1/files/{agentID}/content", s.handleContentDELETE)
	mux.HandleFunc("POST /api/user/v1/files/{agentID}/mkdir", s.handleMkdir)
	mux.HandleFunc("POST /api/user/v1/files/{agentID}/rename", s.handleRename)
	mux.HandleFunc("POST /api/user/v1/files/{agentID}/copy", s.handleCopy)
	mux.HandleFunc("/api/user/v1/git/{agentID}/{rest...}", s.handleGit)
	s.srv = &http.Server{Addr: addr, Handler: s.authenticate(mux), ReadHeaderTimeout: 10 * time.Second}
	return s
}

// ListenAndServe blocks until the listener closes.
func (s *Server) ListenAndServe() error { return s.srv.ListenAndServe() }

// Shutdown stops the listener.
func (s *Server) Shutdown() error { return s.srv.Close() }

// authenticate requires a valid browser token on every route but the probe.
func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
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
	s.forward(w, r, owner, http.MethodGet, path, nil)
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
	s.forward(w, r, owner, http.MethodGet, path, nil)
}

// handleContentPUT uploads a file. Only the owner may write.
func (s *Server) handleContentPUT(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agentID")
	owner, ok := s.authorize(w, r, agentID, true)
	if !ok {
		return
	}
	body, ok := s.readLimitedBody(w, r)
	if !ok {
		return
	}
	path := "/api/v1/files/" + url.PathEscape(agentID) + "/content"
	if q := r.URL.Query().Get("path"); q != "" {
		path += "?path=" + url.QueryEscape(q)
	}
	s.forward(w, r, owner, http.MethodPut, path, body)
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
	s.forward(w, r, owner, http.MethodDelete, path, nil)
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
	s.forward(w, r, owner, http.MethodPost, path, nil)
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
	s.forward(w, r, owner, http.MethodPost, path, nil)
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
	// The user routes live under /api/user/v1; the hypervisor serves the same
	// shape under /api/v1.
	suffix := strings.TrimPrefix(r.URL.Path, "/api/user/v1")
	path := "/api/v1" + suffix
	if q := r.URL.RawQuery; q != "" {
		path += "?" + q
	}
	body, ok := s.readLimitedBody(w, r)
	if !ok {
		return
	}
	s.forward(w, r, owner, r.Method, path, body)
}

// readLimitedBody buffers at most maxFileBytes; anything larger is refused
// before it reaches a container.
func (s *Server) readLimitedBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxFileBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read request body"})
		return nil, false
	}
	if len(body) > maxFileBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file exceeds max size"})
		return nil, false
	}
	return body, true
}

// forward puts the request on the container's tunnel and mirrors the answer.
func (s *Server) forward(w http.ResponseWriter, r *http.Request, owner, method, path string, body []byte) {
	req := nanoprotocol.TunnelRequest{
		RequestID: newRequestID(),
		Method:    method,
		Path:      path,
		Body:      body,
	}
	if contentType := r.Header.Get("Content-Type"); contentType != "" && len(body) > 0 {
		req.Headers = map[string][]string{"Content-Type": {contentType}}
	}

	resp, err := s.tunnels.Do(r.Context(), owner, req)
	if err != nil {
		if errors.Is(err, tunnel.ErrOffline) {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "the agent container is not reachable"})
			return
		}
		slog.Warn("forward to the agent failed", "agent_owner", owner, "path", path, "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "forward to the agent failed"})
		return
	}

	for key, values := range resp.Headers {
		if strings.EqualFold(key, "Content-Length") || strings.EqualFold(key, "Transfer-Encoding") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.Status)
	_, _ = w.Write(resp.Body)
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
