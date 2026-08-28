-- Atomic rate limiting for the Better Playa Guide API (Sol/reviewer P1: this
-- file is the source of truth; deploy.sh smoke-checks the live function).
-- Applied to Supabase via the management API. Idempotent.
CREATE TABLE IF NOT EXISTS guide_rate (
  key text PRIMARY KEY,
  n int NOT NULL,
  reset_at timestamptz NOT NULL
);
ALTER TABLE guide_rate ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION guide_rate_hit(p_key text, p_cap int, p_ttl_s int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $fn$
BEGIN
  LOOP
    UPDATE guide_rate
       SET n = CASE WHEN now() > reset_at THEN 1 ELSE n + 1 END,
           reset_at = CASE WHEN now() > reset_at THEN now() + make_interval(secs => p_ttl_s) ELSE reset_at END
     WHERE key = p_key AND (now() > reset_at OR n < p_cap);
    IF FOUND THEN RETURN true; END IF;
    PERFORM 1 FROM guide_rate WHERE key = p_key AND now() <= reset_at;
    IF FOUND THEN RETURN false; END IF;
    BEGIN
      INSERT INTO guide_rate (key, n, reset_at) VALUES (p_key, 1, now() + make_interval(secs => p_ttl_s));
      RETURN true;
    EXCEPTION WHEN unique_violation THEN
    END;
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION guide_rate_hit(text,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION guide_rate_hit(text,int,int) TO service_role;

CREATE OR REPLACE FUNCTION guide_rate_refund(p_key text)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $fn$
  UPDATE guide_rate SET n = greatest(0, n - 1) WHERE key = p_key
$fn$;
REVOKE ALL ON FUNCTION guide_rate_refund(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION guide_rate_refund(text) TO service_role;
