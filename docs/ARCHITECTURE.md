# Architecture

## One-page view

```
 Browser (Angular SPA)
        │
        │  POST /scan { input }
        ▼
 Spring Boot REST API  ───────────►  MySQL (scan_audit)
        │
        ├── RuleEngine  (regex + deny-list, fast, deterministic)
        └── LlmJudge    (Anthropic Claude, structured output, optional)
```

## Request flow

1. Browser posts JSON `{ input, scanner? }` to `POST /scan`.
2. `ScanController` validates the request body (`@Valid` + `@NotBlank` + `@Size`).
3. `ShieldService` orchestrates:
   - Always runs `RuleEngine.evaluate(input)` → returns `(risk, reasons[])`.
   - If the caller asked for `llm` or `hybrid`, optionally escalates to `LlmJudge.evaluate(input)`.
   - `hybrid` short-circuits on a rule-confirmed `HIGH` to save tokens.
   - Merges reasons, takes the max risk level, generates a scan UUID.
4. `ShieldService.persistAudit(…)` writes a row to `scan_audit`. The write is best-effort: a failed audit write must not fail the main request (compliance > availability is a policy choice you can flip).
5. `ScanController` returns `ScanResponse` to the browser.

## Why rule engine first

- Zero-cost: no API call, no rate limit, no network dependency.
- Explainable: the reason list names the exact rule that matched.
- Deterministic: unit-testable with fixtures, reproducible across runs.
- Fast: typical `/scan` with rules-only completes in 1–5 ms.

The LLM judge is genuinely useful but shouldn't be the first line of defence. It's a second opinion for inputs that look ambiguous, not a replacement.

## Why SHA-256 hashing by default

The audit log stores a hash of the input, not the input itself. Reasons:

- **PII hygiene**: user prompts often contain names, emails, account numbers.
- **GDPR / APP compliance posture**: easier to argue "we don't store user text" than to argue how long retention should be.
- **Deduplication**: the hash lets you count how often the same input was seen, without knowing what it was.

If the operator explicitly wants raw storage (for auditor evidence), flip `shield.audit.store-raw=true`. That decision is now a config choice with a paper trail, not an accident.

## Extending the rule set

`RuleEngine.RULES` is a list of `(code, risk, pattern)` tuples. Adding a rule:

1. Add the `Rule` entry.
2. Bump `RuleEngine.VERSION` (string, semver-ish).
3. Add a test case in `RuleEngineTest`.
4. Tag the repo. The tag becomes the `rulesetVersion` in every audit row from now on — a free changelog for compliance.

## Where this lives in a real deployment

Place the shield between the user-input surface and the LLM call. One HTTP hop:

```
 User input ──► your app ──► POST /scan ──► risk decision ──┐
                                                            ▼
                                            ┌───────── HIGH: refuse / strip
                                            ├───────── MEDIUM: flag / log / human review
                                            └───────── LOW: proceed to LLM
```

For regulated environments, the `/audit` table is the evidence trail. For developer environments, it's debugging data.
