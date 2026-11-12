// Package auth verifies browser tokens for the workspace service.
//
// The console reaches this service directly (nginx routes the file and git
// panels here), so it has to answer the two questions the portal used to answer
// for it: is this token genuine, and may this role look at another user's files.
package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Roles mirror the platform's RBAC model.
const (
	RoleAdmin    = "admin"
	RoleOperator = "operator"
	RoleSupport  = "support"
	RoleAuditor  = "auditor"
	RoleUser     = "user"
)

var knownRoles = map[string]struct{}{
	RoleAdmin:    {},
	RoleOperator: {},
	RoleSupport:  {},
	RoleAuditor:  {},
	RoleUser:     {},
}

// Identity is the authenticated caller.
type Identity struct {
	UserID string
	Role   string
}

// CanManageUsers reports whether the caller may inspect another user's agents.
// It matches the portal's rule: Operations (admin, support), not rank.
func (i Identity) CanManageUsers() bool {
	return i.Role == RoleAdmin || i.Role == RoleSupport
}

type contextKey string

const identityKey contextKey = "workspace-identity"

// WithIdentity stores the caller in the request context.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, identityKey, id)
}

// FromContext returns the caller.
func FromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityKey).(Identity)
	return id, ok
}

// Validator checks nanoauth-issued RS256 tokens against its JWKS endpoint.
type Validator struct {
	jwksURL   string
	client    *http.Client
	keyCache  map[string]*rsa.PublicKey
	lastFetch time.Time
	cacheTTL  time.Duration
	mu        sync.RWMutex
}

// NewValidator returns a validator, or nil when no JWKS URL is configured.
func NewValidator(jwksURL string) *Validator {
	if strings.TrimSpace(jwksURL) == "" {
		return nil
	}
	return &Validator{
		jwksURL:  jwksURL,
		client:   &http.Client{Timeout: 10 * time.Second},
		keyCache: make(map[string]*rsa.PublicKey),
		cacheTTL: 5 * time.Minute,
	}
}

// Validate parses and verifies a token and returns the caller's identity.
func (v *Validator) Validate(tokenStr string) (Identity, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		kid, ok := t.Header["kid"].(string)
		if !ok {
			return nil, fmt.Errorf("missing kid in token header")
		}
		return v.fetchKey(kid)
	}, jwt.WithValidMethods([]string{"RS256"}))
	if err != nil {
		return Identity{}, err
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return Identity{}, fmt.Errorf("invalid token")
	}
	userID, _ := claims["sub"].(string)
	if strings.TrimSpace(userID) == "" {
		return Identity{}, fmt.Errorf("token has no subject")
	}
	role, _ := claims["role"].(string)
	if role == "" {
		role = RoleUser
	}
	if _, ok := knownRoles[role]; !ok {
		return Identity{}, fmt.Errorf("token carries an unknown role %q", role)
	}
	return Identity{UserID: userID, Role: role}, nil
}

func (v *Validator) fetchKey(kid string) (*rsa.PublicKey, error) {
	v.mu.RLock()
	if key, ok := v.keyCache[kid]; ok && time.Since(v.lastFetch) < v.cacheTTL {
		v.mu.RUnlock()
		return key, nil
	}
	v.mu.RUnlock()

	v.mu.Lock()
	defer v.mu.Unlock()

	if key, ok := v.keyCache[kid]; ok && time.Since(v.lastFetch) < v.cacheTTL {
		return key, nil
	}

	resp, err := v.client.Get(v.jwksURL)
	if err != nil {
		return nil, fmt.Errorf("fetch jwks: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch jwks: HTTP %d", resp.StatusCode)
	}

	var jwks struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("decode jwks: %w", err)
	}

	keys := make(map[string]*rsa.PublicKey, len(jwks.Keys))
	for _, key := range jwks.Keys {
		pub, err := parseJWKKey(key.Kty, key.N, key.E)
		if err != nil {
			continue
		}
		keys[key.Kid] = pub
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("jwks returned no usable keys")
	}
	v.keyCache = keys
	v.lastFetch = time.Now()

	if key, ok := v.keyCache[kid]; ok {
		return key, nil
	}
	return nil, fmt.Errorf("no matching key in jwks for kid %q", kid)
}

func parseJWKKey(kty, n, e string) (*rsa.PublicKey, error) {
	if kty != "RSA" {
		return nil, fmt.Errorf("unsupported kty %q", kty)
	}
	nBytes, err := base64.RawURLEncoding.DecodeString(n)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(e)
	if err != nil {
		return nil, err
	}
	if len(eBytes) == 0 {
		eBytes = []byte{0}
	}
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: int(new(big.Int).SetBytes(eBytes).Int64()),
	}, nil
}
