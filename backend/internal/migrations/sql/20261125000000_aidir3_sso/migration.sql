-- aidir3 single sign-on (fork-specific).
--
-- The design studio sits behind aidir3.com, which already has user accounts.
-- When a signed-in visitor opens the studio, the site vouches for them with a
-- short-lived signed token and the studio signs them in, creating the account
-- on the first visit. This table records which aidir3.com account owns which
-- studio user, so a later change of email on the site still lands on the same
-- studio account.
--
-- Additive only: one new table, no change to any existing row, nothing to
-- backfill. A rollback to a binary without this feature simply ignores it.
CREATE TABLE IF NOT EXISTS "aidir3_identities" (
    "aidir3_user_id" TEXT PRIMARY KEY,
    "user_id" UUID NOT NULL REFERENCES "users"(id) ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "aidir3_identities_user_id_key" ON "aidir3_identities" ("user_id");
