// Package aidir3sso verifies the hand-off token aidir3.com issues when a
// signed-in visitor opens the design studio (fork-specific; not upstream).
//
// Token: "v1." + base64url(JSON claims) + "." + base64url(HMAC-SHA256(secret,
// "v1." + base64url(JSON claims))). The site and the studio share the secret
// (AIDIR3_SSO_SECRET); nothing else is trusted. Tokens live for at most five
// minutes and each one is accepted once.
package aidir3sso

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"
)

// Audience pins a token to this app, so a token minted for another aidir3
// service with the same secret is not accepted here.
const Audience = "aidir3-design"

// MaxLifetime is the longest a token may be valid (exp - iat).
const MaxLifetime = 5 * time.Minute

// MinSecretLen rejects a weak shared secret outright.
const MinSecretLen = 32

// Claims is what the site vouches for.
type Claims struct {
	Subject       string `json:"sub"`            // the aidir3.com user id
	Email         string `json:"email"`          //
	EmailVerified bool   `json:"email_verified"` // the site confirmed this address
	Name          string `json:"name"`           //
	Audience      string `json:"aud"`            //
	IssuedAt      int64  `json:"iat"`            // unix seconds
	ExpiresAt     int64  `json:"exp"`            // unix seconds
	ID            string `json:"jti"`            // unique per token (replay guard)
}

var (
	ErrDisabled  = errors.New("aidir3 sso: not configured")
	ErrMalformed = errors.New("aidir3 sso: malformed token")
	ErrSignature = errors.New("aidir3 sso: bad signature")
	ErrExpired   = errors.New("aidir3 sso: token expired or not yet valid")
	ErrAudience  = errors.New("aidir3 sso: wrong audience")
	ErrClaims    = errors.New("aidir3 sso: missing claims")
	ErrReplayed  = errors.New("aidir3 sso: token already used")
)

// Verifier checks tokens against one shared secret and remembers the ids it
// has accepted until they expire.
type Verifier struct {
	secret []byte
	now    func() time.Time

	mu   sync.Mutex
	seen map[string]int64 // jti -> exp (unix seconds)
}

// NewVerifier returns nil when the secret is unset or too short, which turns
// the feature off; callers treat a nil verifier as "not configured".
func NewVerifier(secret string) *Verifier {
	secret = strings.TrimSpace(secret)
	if len(secret) < MinSecretLen {
		return nil
	}
	return &Verifier{secret: []byte(secret), now: time.Now, seen: map[string]int64{}}
}

// Sign builds a token for the claims. The site has its own implementation;
// this one exists for tests and local tooling.
func Sign(secret string, c Claims) (string, error) {
	body, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	head := "v1." + base64.RawURLEncoding.EncodeToString(body)
	return head + "." + base64.RawURLEncoding.EncodeToString(mac([]byte(secret), head)), nil
}

func mac(secret []byte, msg string) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(msg))
	return h.Sum(nil)
}

// Verify returns the claims of a valid, unused token and marks it used.
func (v *Verifier) Verify(token string) (*Claims, error) {
	if v == nil {
		return nil, ErrDisabled
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "v1" || parts[1] == "" || parts[2] == "" {
		return nil, ErrMalformed
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, ErrMalformed
	}
	// Check the signature before reading anything the token says.
	if !hmac.Equal(sig, mac(v.secret, parts[0]+"."+parts[1])) {
		return nil, ErrSignature
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrMalformed
	}
	var c Claims
	if err := json.Unmarshal(body, &c); err != nil {
		return nil, ErrMalformed
	}
	if c.Audience != Audience {
		return nil, ErrAudience
	}
	c.Subject = strings.TrimSpace(c.Subject)
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	if c.Subject == "" || c.Email == "" || !strings.Contains(c.Email, "@") || c.ID == "" {
		return nil, ErrClaims
	}
	now := v.now().Unix()
	const skew = 30 // seconds of clock difference tolerated between the two servers
	if c.ExpiresAt <= now-skew || c.IssuedAt > now+skew || c.ExpiresAt <= c.IssuedAt ||
		c.ExpiresAt-c.IssuedAt > int64(MaxLifetime/time.Second) {
		return nil, ErrExpired
	}

	v.mu.Lock()
	defer v.mu.Unlock()
	for id, exp := range v.seen { // drop ids whose tokens can no longer be valid
		if exp < now-skew {
			delete(v.seen, id)
		}
	}
	if _, used := v.seen[c.ID]; used {
		return nil, ErrReplayed
	}
	v.seen[c.ID] = c.ExpiresAt
	return &c, nil
}
