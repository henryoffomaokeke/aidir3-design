// aidir3 single sign-on (fork-specific; not upstream). aidir3.com vouches for a
// signed-in visitor with a short-lived signed token (see internal/aidir3sso);
// this file turns the verified claims into a studio account and session.
//
// The same safety rules as the OIDC path apply:
//   - an account with TOTP enabled still gets the MFA challenge;
//   - a pre-existing account is only adopted on an email match when the site
//     says it verified that address. Otherwise anyone who registered someone
//     else's address on the site could walk into their studio account.
package accounts

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Aidir3Profile is the identity the site vouched for.
type Aidir3Profile struct {
	Subject       string // the aidir3.com user id
	Email         string
	EmailVerified bool
	Name          string
}

var (
	// ErrAidir3Unverified: an account with this email exists here, and the site
	// has not verified the address, so the two are not joined.
	ErrAidir3Unverified = errors.New("aidir3 sso: an account with this email exists; verify the email on aidir3.com first")
	ErrAidir3NoAccount  = errors.New("aidir3 sso: account not found")
)

// syncAidir3Profile keeps the studio's copy of the profile in step with the
// site, which owns it: the name and email shown here are the ones on the
// aidir3.com account. Best effort; a failure never blocks the sign-in. The
// email is only taken over when no other studio account already uses it.
func (s *Service) syncAidir3Profile(ctx context.Context, userID, email, name string, emailVerified bool) {
	if name = strings.TrimSpace(name); name != "" {
		_, _ = s.db.Exec(ctx, `UPDATE "users" SET name = $2, "updated_at" = now() WHERE id = $1 AND name IS DISTINCT FROM $2`, userID, name)
	}
	if email != "" {
		_, _ = s.db.Exec(ctx,
			`UPDATE "users" SET email = $2, "email_verified" = $3, "updated_at" = now()
			 WHERE id = $1 AND (email <> $2 OR "email_verified" IS DISTINCT FROM $3)
			   AND NOT EXISTS (SELECT 1 FROM "users" o WHERE o.email = $2 AND o.id <> $1)`,
			userID, email, emailVerified)
	}
}

// LoginWithAidir3 signs the visitor in, creating the account and its personal
// workspace on the first visit. Returns (user, tokens, mfaToken, err); on
// ErrMFARequired the caller hands mfaToken to the login page, exactly like the
// password and OIDC paths.
func (s *Service) LoginWithAidir3(ctx context.Context, p Aidir3Profile, device, ip string) (*AuthUser, *Tokens, string, error) {
	subject := strings.TrimSpace(p.Subject)
	email := strings.ToLower(strings.TrimSpace(p.Email))
	if subject == "" || email == "" {
		return nil, nil, "", ErrAidir3NoAccount
	}

	// 1) Returning visitor: this aidir3 account is already joined to a user.
	var userID string
	err := s.db.QueryRow(ctx, `SELECT "user_id" FROM "aidir3_identities" WHERE "aidir3_user_id" = $1`, subject).Scan(&userID)
	if err == nil && userID != "" {
		s.syncAidir3Profile(ctx, userID, email, p.Name, p.EmailVerified)
		u, err := s.findUserByID(ctx, userID)
		if err != nil || u == nil {
			return nil, nil, "", ErrAidir3NoAccount
		}
		return s.firstFactorSession(ctx, u, device, ip)
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, "", err
	}

	// 2) An account with this email already exists here (for example one made
	// before single sign-on was switched on): join it, but only on a verified
	// address, and never steal an account another aidir3 user already holds.
	if u, err := s.findUserByEmail(ctx, email); err == nil && u != nil {
		if !p.EmailVerified {
			return nil, nil, "", ErrAidir3Unverified
		}
		var owner string
		err := s.db.QueryRow(ctx,
			`INSERT INTO "aidir3_identities" ("aidir3_user_id","user_id") VALUES ($1,$2)
			 ON CONFLICT ("user_id") DO UPDATE SET "user_id" = "aidir3_identities"."user_id"
			 RETURNING "aidir3_user_id"`,
			subject, u.ID).Scan(&owner)
		if err != nil {
			return nil, nil, "", err
		}
		if owner != subject {
			return nil, nil, "", ErrAidir3Unverified
		}
		return s.firstFactorSession(ctx, u, device, ip)
	}

	// 3) First visit: a passwordless user, the identity row and a personal
	// workspace, in one transaction.
	userID, err = s.createUserWithWorkspace(ctx, email, p.Name, p.EmailVerified, func(tx pgx.Tx, newUserID string) error {
		_, err := tx.Exec(ctx, `INSERT INTO "aidir3_identities" ("aidir3_user_id","user_id") VALUES ($1,$2)`, subject, newUserID)
		return err
	})
	if err != nil {
		return nil, nil, "", err
	}
	u, err := s.findUserByID(ctx, userID)
	if err != nil || u == nil {
		return nil, nil, "", ErrAidir3NoAccount
	}
	return s.firstFactorSession(ctx, u, device, ip)
}
