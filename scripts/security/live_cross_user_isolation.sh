#!/usr/bin/env bash
# Broad (true / live) integration test — end-user cross-user isolation on staging.
# The live counterpart of src/tests/everything/end_user_cross_user_isolation (a narrow
# integration test). No service account required; two end-user logins are enough.
#
# Credentials come from the environment, never from this file. Two ways to supply them:
#   (a) Local:  cp .env.example .env  → fill values → `bash live_cross_user_isolation.sh`
#   (b) CI:     set the same names as GitHub Actions secrets; the workflow exports them.
# You may also skip login entirely by exporting TOKEN_A / TOKEN_B (pre-minted bearer tokens).
#
# Secure outcome = every check prints PASS. A FAIL is a real cross-user leak.
set -uo pipefail

# Load .env if present (does not override anything already exported, e.g. CI secrets).
if [[ -f "$(dirname "$0")/.env" ]]; then set -a; . "$(dirname "$0")/.env"; set +a; fi

FHIR="${FHIR_BASE_URL:-https://fhir.staging.icanbwell.com}"
LOGIN="${LOGIN_URL:-https://api-gateway.staging.icanbwell.com/identity/account/login}"
A_PERSON="${USER_A_PERSON_ID:?set USER_A_PERSON_ID}"; A_PATIENT="${USER_A_PATIENT_ID:?}"
B_PERSON="${USER_B_PERSON_ID:?set USER_B_PERSON_ID}"; B_PATIENT="${USER_B_PATIENT_ID:?}"
NONEXISTENT="00000000-0000-4000-8000-000000000000"

# Mint a token from a login, unless one was supplied. The password is read from the
# environment and piped straight into curl's request body; it is never printed or stored.
login() { # $1=email $2=password  -> prints access_token
  curl -s --max-time 30 --location "$LOGIN" \
    --header "clientkey: ${CLIENTKEY:?set CLIENTKEY}" --header 'Content-Type: application/json' \
    --data-raw "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | (command -v jq >/dev/null && jq -r '.access_token // .accessToken // empty' || sed -n 's/.*"access_token"[: ]*"\([^"]*\)".*/\1/p')
}
TOKEN_A="${TOKEN_A:-$(login "${USER_A_EMAIL:?}" "${USER_A_PASSWORD:?}")}"
TOKEN_B="${TOKEN_B:-$(login "${USER_B_EMAIL:?}" "${USER_B_PASSWORD:?}")}"
[[ -n "${TOKEN_A:-}" && -n "${TOKEN_B:-}" ]] || { echo "Could not obtain tokens (login failed or empty). Check CLIENTKEY / creds / LOGIN_URL."; exit 2; }

pass=0; fail=0
_body()  { curl -s --max-time 25 -H "Authorization: Bearer $1" "$FHIR$2"; }
_status(){ curl -s -o /dev/null -w "%{http_code}" --max-time 25 -H "Authorization: Bearer $1" "$FHIR$2"; }
contains(){ echo "$1" | grep -q "\"$2\""; }
check(){ if [[ "$2" == "1" ]]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }

echo "== FHIR base: $FHIR =="
A_OWN=$(_body "$TOKEN_A" "/4_0_0/Person/$A_PERSON/\$everything")
B_OWN=$(_body "$TOKEN_B" "/4_0_0/Person/$B_PERSON/\$everything")
check "user A reads its OWN \$everything (contains own patient)" "$(contains "$A_OWN" "$A_PATIENT" && echo 1 || echo 0)"
check "user B reads its OWN \$everything (contains own patient)" "$(contains "$B_OWN" "$B_PATIENT" && echo 1 || echo 0)"
check "user A's own \$everything does NOT contain user B's patient" "$(contains "$A_OWN" "$B_PATIENT" && echo 0 || echo 1)"
check "user B's own \$everything does NOT contain user A's patient" "$(contains "$B_OWN" "$A_PATIENT" && echo 0 || echo 1)"

A_ON_B=$(_body "$TOKEN_A" "/4_0_0/Person/$B_PERSON/\$everything")
B_ON_A=$(_body "$TOKEN_B" "/4_0_0/Person/$A_PERSON/\$everything")
check "user A querying user B's Person returns no B data" "$(contains "$A_ON_B" "$B_PATIENT" && echo 0 || echo 1)"
check "user B querying user A's Person returns no A data" "$(contains "$B_ON_A" "$A_PATIENT" && echo 0 || echo 1)"

A_FOREIGN=$(_status "$TOKEN_A" "/4_0_0/Patient/$B_PATIENT"); A_MISSING=$(_status "$TOKEN_A" "/4_0_0/Patient/$NONEXISTENT")
B_FOREIGN=$(_status "$TOKEN_B" "/4_0_0/Patient/$A_PATIENT"); B_MISSING=$(_status "$TOKEN_B" "/4_0_0/Patient/$NONEXISTENT")
check "user A: foreign Patient status ($A_FOREIGN) == not-found status ($A_MISSING) — no existence oracle" "$([[ "$A_FOREIGN" == "$A_MISSING" ]] && echo 1 || echo 0)"
check "user B: foreign Patient status ($B_FOREIGN) == not-found status ($B_MISSING) — no existence oracle" "$([[ "$B_FOREIGN" == "$B_MISSING" ]] && echo 1 || echo 0)"

echo "== $pass passed, $fail failed =="
[[ "$fail" == "0" ]] && exit 0 || exit 1
