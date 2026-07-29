---
name: verify-descope-mfa
description: Drive a real signup/login cycle against the dev Descope project to verify ktc-mfa (or other hosted-flow) changes at runtime, not just via ExportFlow diffing.
---

# Verify a `ktc-mfa` / hosted-flow change end-to-end

Use this when a fix lives in Descope-hosted flow JSON (pushed via `flows_write` →
`ImportFlow`) rather than app code — `ExportFlow` diffing proves the config changed, not that
the runtime behaves as intended. This recipe drives the actual signup/login UI.

## 1. Bring up the stack against real dev Descope

```bash
make up-descope   # needs .env.descope (TESTMAIL_API_KEY, TESTMAIL_NAMESPACE, DESCOPE_*,
                  # and — for the SMS path in Section 3b — TWILIO_ACCOUNT_SID/TWILIO_API_KEY_SID/
                  # TWILIO_API_KEY_SECRET/TWILIO_TEST_PHONE_NUMBER)
```
Wait for `Container kill_the_clipboard_scanner is healthy` — app at `http://localhost:5050`.
`make down-descope` when done. Don't run alongside another worktree's `make up`/`make tests`
(shared Docker Compose project name — see root CLAUDE.md's Docker caveat).

## 2. Drive signup via Playwright, retrieving codes from testmail.app (no human inbox needed)

`.env.descope`'s `TESTMAIL_API_KEY`/`TESTMAIL_NAMESPACE` give a real receiving mailbox at
`{namespace}.{tag}@inbox.testmail.app` — any tag auto-receives, no pre-registration. Compute the
address and poll for the code with a small script (mirrors `frontend/e2e/support/testmail.ts`
without needing Node/the e2e harness):

```python
# reads .env.descope directly; never prints TESTMAIL_API_KEY itself
email_for_tag(namespace, tag) -> f"{namespace}.{tag}@inbox.testmail.app"
wait_for_code(api_key, namespace, tag) -> polls https://api.testmail.app/api/json,
  matches email.to == expected address, regex \d{6} out of html/text body
```

Drive the `descope-wc` custom element (open shadow DOM — Playwright pierces it automatically,
no `>>>` needed) screen by screen: Welcome (email) → Verify OTP (code, **6 separate single-char
boxes** — see gotcha below) → Set Password → User Info → MFA.

## 3. TOTP enrollment/challenge: read the secret from the network response, don't scan the QR

Descope's `update-user-totp` flow/next response embeds the raw base32 secret directly in JSON —
no OCR needed:

```
POST .../v1/flow/next response body:
  screen.state.totp.key           <- base32 secret, e.g. "AWOSQTQO..."
  screen.state.totp.provisionUrl  <- otpauth://totp/... (same secret)
```

Capture it via `browser_network_requests` (filter `/v1/flow/next`) →
`browser_network_request(index, part: "response-body")` on the call that fired when you clicked
"Use Authenticator App". Then compute the current code yourself, RFC 6238 (30s step, HMAC-SHA1,
6 digits) — same algorithm as `frontend/e2e/support/totp.ts`'s `generateTotpCode`, portable to
a one-file Python script (`base64.b32decode` + `hmac.new(key, counter_bytes, "sha1")`).

## 3b. SMS enrollment/challenge: poll the provisioned Twilio number

`.env.descope`'s `TWILIO_ACCOUNT_SID`/`TWILIO_API_KEY_SID`/`TWILIO_API_KEY_SECRET`/
`TWILIO_TEST_PHONE_NUMBER` (see `docs/sms-mfa-e2e-testing.md`) give a
real, reusable receiving number — enter `TWILIO_TEST_PHONE_NUMBER` (national digits only; the
country-code combobox already defaults to +1) at the MFA method screen instead of a real phone,
then poll for the OTP with Twilio's REST API, authenticating with the API Key (not the account's
Auth Token) the same way `frontend/e2e/support/smstest.ts` does:

```bash
curl -s -u "$TWILIO_API_KEY_SID:$TWILIO_API_KEY_SECRET" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json?To=$TWILIO_TEST_PHONE_NUMBER&PageSize=5" \
  | jq -r '[.messages[] | select(.direction == "inbound")][0].body'
```

Results are newest-first, so `[0]` after the `direction == "inbound"` filter is the most recent
inbound SMS — filtering on `direction` matters because this number is reused across runs and picks
up unrelated real-world texts over time (observed on this exact number: a stray "Reschedule ..."
appointment reminder, apparently carried over from whoever had it before). Trigger the send, wait
a couple seconds, then poll — don't poll before clicking through the phone-number screen, or you'll
retrieve a stale message instead of the one you just requested.

**Gotcha: the phone-number screen's submit button reads "Verify", not "Continue"/"Submit"/"Next"**
— the only screen in either MFA path with different button text than everywhere else in the flow.
Confirm via a `browser_evaluate` walk of `<descope-button>` elements (same technique Section 6
already uses for the sign-in button-order gotcha) before clicking if unsure — clicking the wrong
(non-existent) "Continue" button here just does nothing, so the flow silently sits on the same
screen with no SMS ever sent, which then shows up downstream as "no message received" when polling
Twilio, not as an obvious failure at the click itself.

Unlike testmail's per-run addresses, this is **one shared number** — don't run this alongside an
automated `@mfa-sms` CI run against the same Descope project, or the two polls will race on the
same inbound SMS.

## 4. Gotcha: the passcode/TOTP code inputs are 6 separate single-character `<input>`s, not one field

Typing the whole code into the first box via `pressSequentially`/keyboard-type is unreliable —
characters land in the wrong boxes or get dropped (observed: typing "882817" produced "827" split
across boxes 1-3). **Fill each box individually** with its one digit
(`browser_type` targeting each box's own ref, one call per digit) — reliable every time, and each
fill auto-advances focus/submits on the last digit.

## 5. The actual regression check

After first enrollment (TOTP or SMS), log out, log back in with the same credentials. The screen
that appears immediately after the password step tells you which bug state you're in:
- **"Enter the 6-digit code from your authenticator app"** (TOTP) or **"Enter the 6-digit code
  sent to +1\*\*\*\*\*\*NNNN"** (SMS) — goes straight to the challenge — correct; `preferredMfaMethod`
  persisted, `mfa-exists-check` found it non-empty.
- **"MFA is required — choose a method"** reappearing — the KTCS-16 bug (or a regression of its
  fix): the custom-attribute write isn't persisting.

Also cross-check via the Descope MCP directly: `users_read` → `LoadUser` (by loginId/email) →
`customAttributes.preferredMfaMethod` should show the enrolled method. Do the logout/login cycle
**twice** — a single pass can't rule out a one-off race.

## 6. Sign-in button ambiguity

`ktc-sign-in`'s password screen renders "Forgot password" **before** "Continue" in DOM order —
clicking the first button by position (rather than by matched text) submits a password-reset
request instead of signing in. If this happens, it's recoverable (just complete the reset with
the same password via the emailed code) but wastes a round trip. Confirm button text via a
quick `browser_evaluate` walk of `<descope-button>` elements before clicking when order is
ambiguous.

## 7. Clean up afterward

```
tenants_write -> DeleteTenant {id: <tenantId from LoadUser>, cascade: true}
```
Get the tenant ID from `users_read` → `LoadUser`'s `userTenants[].tenantId`, or from the
session-storage JWT's `tenantId` claim captured mid-flow. Needs a fresh `session.elevate` (cite
this exact call) if the prior elevation from pushing the fix has expired (900s TTL).
