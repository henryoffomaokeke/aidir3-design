package aidir3sso

import (
	"errors"
	"strings"
	"testing"
	"time"
)

const testSecret = "0123456789abcdef0123456789abcdef-test"

func claimsAt(now time.Time) Claims {
	return Claims{
		Subject: "42", Email: "Ada@Example.com", EmailVerified: true, Name: "Ada",
		Audience: Audience, IssuedAt: now.Unix(), ExpiresAt: now.Add(time.Minute).Unix(), ID: "jti-1",
	}
}

func verifierAt(now time.Time) *Verifier {
	v := NewVerifier(testSecret)
	v.now = func() time.Time { return now }
	return v
}

func TestVerifyAcceptsAValidTokenOnce(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	tok, err := Sign(testSecret, claimsAt(now))
	if err != nil {
		t.Fatal(err)
	}
	v := verifierAt(now)
	c, err := v.Verify(tok)
	if err != nil {
		t.Fatalf("valid token rejected: %v", err)
	}
	if c.Subject != "42" || c.Email != "ada@example.com" || !c.EmailVerified {
		t.Fatalf("unexpected claims: %+v", c)
	}
	if _, err := v.Verify(tok); !errors.Is(err, ErrReplayed) {
		t.Fatalf("second use: want ErrReplayed, got %v", err)
	}
}

func TestVerifyRejects(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	good := claimsAt(now)

	sign := func(mut func(*Claims), secret string) string {
		c := good
		if mut != nil {
			mut(&c)
		}
		tok, err := Sign(secret, c)
		if err != nil {
			t.Fatal(err)
		}
		return tok
	}
	valid := sign(nil, testSecret)
	tampered := func() string {
		// Swap the payload for another user's while keeping the signature.
		other := sign(func(c *Claims) { c.Subject = "1"; c.Email = "admin@example.com" }, testSecret)
		return "v1." + strings.Split(other, ".")[1] + "." + strings.Split(valid, ".")[2]
	}()

	cases := []struct {
		name  string
		token string
		want  error
	}{
		{"wrong secret", sign(nil, "another-secret-another-secret-another"), ErrSignature},
		{"payload swapped under an old signature", tampered, ErrSignature},
		{"expired", sign(func(c *Claims) {
			c.IssuedAt = now.Add(-10 * time.Minute).Unix()
			c.ExpiresAt = now.Add(-9 * time.Minute).Unix()
		}, testSecret), ErrExpired},
		{"issued in the future", sign(func(c *Claims) {
			c.IssuedAt = now.Add(5 * time.Minute).Unix()
			c.ExpiresAt = now.Add(6 * time.Minute).Unix()
		}, testSecret), ErrExpired},
		{"lifetime too long", sign(func(c *Claims) { c.ExpiresAt = now.Add(24 * time.Hour).Unix() }, testSecret), ErrExpired},
		{"wrong audience", sign(func(c *Claims) { c.Audience = "aidir3-studio" }, testSecret), ErrAudience},
		{"no subject", sign(func(c *Claims) { c.Subject = " " }, testSecret), ErrClaims},
		{"no email", sign(func(c *Claims) { c.Email = "" }, testSecret), ErrClaims},
		{"no token id", sign(func(c *Claims) { c.ID = "" }, testSecret), ErrClaims},
		{"not a token", "hello", ErrMalformed},
		{"unknown version", "v2." + strings.SplitN(valid, ".", 2)[1], ErrMalformed},
		{"empty", "", ErrMalformed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := verifierAt(now).Verify(tc.token); !errors.Is(err, tc.want) {
				t.Fatalf("want %v, got %v", tc.want, err)
			}
		})
	}
}

func TestShortSecretDisablesTheFeature(t *testing.T) {
	if NewVerifier("too-short") != nil {
		t.Fatal("a short secret must not produce a verifier")
	}
	var v *Verifier
	if _, err := v.Verify("v1.a.b"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("nil verifier: want ErrDisabled, got %v", err)
	}
}
