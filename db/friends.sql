-- Friend-finder schema (source of truth; applied via Supabase management API).
-- Idempotent. See api/friend.js for the privacy model.
CREATE TABLE IF NOT EXISTS guide_profiles (
  cid text PRIMARY KEY,
  secret_hash text NOT NULL,
  name text,
  sharing boolean DEFAULT false,
  updated timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS guide_invites (
  code text PRIMARY KEY,
  cid text NOT NULL,
  created timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS guide_pairs (
  a text NOT NULL,
  b text NOT NULL,
  muted_a boolean DEFAULT false,
  muted_b boolean DEFAULT false,
  created timestamptz DEFAULT now(),
  PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS guide_locs (
  cid text PRIMARY KEY,
  addr text,
  at timestamptz DEFAULT now()
);
ALTER TABLE guide_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_locs ENABLE ROW LEVEL SECURITY;
