# Veridun

**Every proof-backed payment decision leaves a durable, inspectable trail.**

Veridun is the Proof Gatekeeper agent for the zkVerify Agent Games event: a signed,
raw-body decision service that verifies every rule deterministically, produces a
locally verified Groth16 proof against the **official** zkVerify circuit, and
records every decision, proof, and finalization in PostgreSQL behind an
operational dashboard.

| | |
| --- | --- |
| Live agent endpoint | `https://veridun-oxunify.vercel.app/agent` |
| Live dashboard | `https://veridun-oxunify.vercel.app/` |
| Health | `https://veridun-oxunify.vercel.app/health` |
| Repository | `https://github.com/unifyWeb3/veridun` |
| Track | zkVerify Agent Games — Proof Gatekeeper |
| Registered circuit | Mainnet Groth16/BN128 gatekeeper circuit (see `docs/CLAIMS.md`) |

Machine-generated facts (circuit digests, VK hash, toolchain versions, live
endpoint probe) live in [`docs/CLAIMS.md`](docs/CLAIMS.md) and are regenerated
with `npm run claims`.

---

## What the platform sends, and what Veridun returns

The Agent Games platform signs every request body with HMAC-SHA256 and sends it
to `POST /agent`.

```text
POST /agent
x-agent-games-signature: <hex hmac-sha256 of the exact body bytes>
content-type: application/json

{"type":"agent-games.proof-gatekeeper.v1", "task_id":"...", ...}
```

Veridun answers with a signed JSON body:

```json
{
  "decision": "APPROVE",
  "reason_code": "VALID_CONDITION",
  "proof_tx": "0x...",
  "proof": { "pi_a": ["..."], "pi_b": [["..."]], "pi_c": ["..."], "protocol": "groth16", "curve": "bn128" },
  "public_signals": ["...", "..."]
}
```

Contract guarantees:

- **Raw-body authentication.** The HMAC is verified over the exact request bytes
  *before* `JSON.parse` is called. An invalid signature is rejected with a signed
  `401` and never reaches the parser, the policy engine, or the database.
- **Signed responses.** Every response body is signed with the same secret and
  carries `x-agent-games-signature` over its exact bytes.
- **Proofs on every provable task.** A Groth16 proof and its 13 public signals are
  attached to every decision the circuit can prove, and are verified locally
  against the official verification key before they are returned or submitted.
- **Fail closed.** Malformed envelopes, expired windows, uncertain verifier
  results, and proof failures produce a signed rejection — never an approval.
- **Bounded time.** The internal budget is 55 seconds; the serverless function
  enforces a hard ceiling and always responds inside the 60-second platform limit.

---

## Decision policy

Seven checks, evaluated in a fixed order, with no model in the decision path.
The first failing check sets the reason code.

| Order | Check | Fails with | Provable |
| ---: | --- | --- | --- |
| 1 | Registered verification key equals the proof verification key | `VK_SUBSTITUTION` | yes |
| 2 | Public balance is at least the minimum | `THRESHOLD_MISMATCH` | yes |
| 3 | Proof reference has not been claimed by another task | `PROOF_REUSED` | **no** — replay is external state |
| 4 | Current block is below the expiry block | `EXPIRED_CONDITION` | yes |
| 5 | Recipient equals the condition recipient | `RECIPIENT_MISMATCH` | yes |
| 6 | Amount does not exceed the maximum transfer | `AMOUNT_OVERFLOW` | yes |
| 7 | Inbound proof reference is finalized on zkVerify | `PROOF_NOT_FINALIZED` | no |

`VALID_CONDITION` is the only approving reason code. The circuit can prove an
approval only when every circuit-visible check passes, and it can prove a
rejection caused by a failed circuit-visible check — which is why `PROOF_REUSED`
and `PROOF_NOT_FINALIZED` intentionally return without a proof.

### Inbound proof verification

Before approving, Veridun independently checks the inbound `proof_tx` against the
public zkVerify RPC and Subscan: the extrinsic must be finalized, the event must
be `ProofVerified`, the submitted verification key must match the task's
`proof_vk`, and the on-chain public inputs must be present. Approval requires all
four; anything uncertain becomes `PROOF_NOT_FINALIZED`.

---

## Architecture

```text
Agent Games
    │  signed JSON over HTTPS
    ▼
┌──────────────────────────────── Vercel (single region, Node 24) ───────────────────────────────┐
│  api/[...path].ts  →  src/api/vercel.ts  →  src/api/node-dispatch.ts  →  Fastify application │
│        raw bytes in ────────────────────────────────────────────────► raw bytes out             │
│  • HMAC verifier (raw body, before parse)      • Groth16 prover (official WASM + ZKEY)        │
│  • deterministic policy engine                 • zkVerify inbound finality verifier             │
│  • Kurier submission client                    • signed-response serializer                   │
└───────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                │ SQL
                                       ┌────────▼────────┐        ┌──────────────────────────┐
                                       │   PostgreSQL    │        │  React operations console│
                                       │ (Neon, durable) │◄──────►│  /overview /tasks /proofs │
                                       └─────────────────┘        └──────────────────────────┘
```

The dashboard is static output served by Vercel; every API call goes through one
catch-all serverless function so the signed raw-body contract is identical on
Vercel and on the local Node server.

### Why the handler does not use `app.inject()`

Fastify's `inject()` helper depends on `light-my-request`, whose CommonJS
`require()` of the ESM-only `cookie` package fails inside the Vercel Node
runtime (`ERR_REQUIRE_ESM`). `src/api/node-dispatch.ts` dispatches through
Fastify's real Node HTTP handler instead, which keeps identical routing, hooks,
content-type parsing, and raw-body semantics without the test-only dependency.
`tests/vercel-handler.test.ts` guards against reintroducing `inject()`.

---

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/agent` | Signed preflight and Proof Gatekeeper tasks |
| `POST` | `/api/agent` | Same handler, API-prefixed alias |
| `GET` | `/health` | Liveness and dependency readiness (unsigned, non-secret) |
| `GET` | `/api/health` | Same handler, API-prefixed alias |
| `GET` | `/api/summary` | Aggregate task, proof, latency, and finalization metrics |
| `GET` | `/api/tasks` | Paginated task list with decision/reason/status filters |
| `GET` | `/api/task?task_id=…` | Task detail, policy checks, proof, signals, and attempts |
| `GET` | `/api/receipt?task_id=…` | Re-verifiable receipt: exact signed response bytes, signature, envelope, checks, proof |
| `GET` | `/api/proofs` | Proof and Kurier evidence ledger |

`/api/dashboard/summary` and `/api/tasks/:taskId` remain available as aliases
and are mapped onto the canonical single-segment paths by `vercel.json`
rewrites, because Vercel only routes one-segment `/api/*` paths to the catch-all
function.

---

## Persistence

PostgreSQL is the only system of record.

| Table | Contents |
| --- | --- |
| `agent_tasks` | One row per task ID: request digest, envelope, lifecycle state, decision, reason, exact response bytes and signature, proof, public signals, timings, errors, Kurier metadata |
| `proof_references` | One row per incoming proof transaction; the first task that claims a reference owns it, so a later task with the same reference is a replay |
| `proof_attempts` | Append-only proof lifecycle evidence: generation, local verification, Kurier submission, polling state, finalization, errors |

Task claiming is protected by a primary key with `INSERT ... ON CONFLICT`
semantics. A platform retry receives the exact original signed response bytes. A
concurrent duplicate waits for the first response within the task budget. A
failed task can be reclaimed by a later retry because proof-reference ownership
never transfers away from the first task.

---

## Verify a decision without trusting this service

Every completed task keeps a **receipt**: the exact signed response bytes, the
HMAC over them, the task envelope, the evaluated policy checks, and the proof.
The receipt is enough to re-derive the decision and re-verify the proof.

```bash
# a local sample receipt generated with the official circuit artifacts
npm run receipt:sample
npm run receipt:verify -- docs/samples/sample-receipt.json

# the receipt of a task the live service processed
curl "https://veridun-oxunify.vercel.app/api/receipt?task_id=<task-id>" > receipt.json
AGENT_GAMES_HMAC_SECRET=<secret> npm run receipt:verify -- receipt.json
```

`npm run receipt:verify` runs seven independent checks and exits non-zero if any
of them fails:

```text
PASS  task envelope parses against the published contract
PASS  decision is present
PASS  policy replay matches the recorded decision
PASS  receipt carries 13 public signals
PASS  public signals match the circuit inputs derived from the envelope
PASS  Groth16 proof verifies against the official verification key
PASS  response HMAC over the exact response bytes
```

The committed sample receipt is explicitly labelled as a local sample: it is
produced by the same code path as a live task, but it is not a platform-signed
response and it is not a record of a live Agent Games task.

---

## Running it locally

```bash
npm ci
cp .env.example .env          # fill in the values below
npm run circuit:prepare       # download + checksum-verify the official artifacts
npm run db:migrate            # create the schema
npm run dev                   # API on :3000, dashboard on :5173
```

Required environment:

| Variable | Source |
| --- | --- |
| `AGENT_GAMES_HMAC_SECRET` | Agent Games dashboard → Rotate Secret |
| `DATABASE_URL` | PostgreSQL connection string (Neon in production) |
| `KURIER_API_KEY` | kurier.xyz, for on-chain proof submission evidence |
| `INBOUND_PROOF_VERIFIER` | `zkverify` (default) or `trusted-payload` |
| `TASK_ID_ENCODING` | `auto` (default), `hex-suffix`, `sha256`, `keccak256` |
| `PROOF_SUBMIT_ENABLED` | `true` to submit proofs to Kurier |
| `DASHBOARD_ENABLED` | `true` to serve the compiled dashboard from the API |
| `SUBSCAN_BASE_URL` | zkVerify Subscan base URL |
| `ZKVERIFY_RPC_URL` | zkVerify public RPC base URL |

Secrets are environment-only. They are never logged, never returned by the API,
and never written to the repository.

### Verification commands

| Command | What it proves |
| --- | --- |
| `npm test` | Full suite: policy traps, HMAC raw-body contract, task-ID encoding, prover, repository, inbound verifier, Vercel handler |
| `npm run test:proof` | Groth16 proof generation and local verification against the official key |
| `npm run typecheck` | TypeScript strictness across API, agent, and dashboard sources |
| `npm run build` | API compilation and dashboard bundle |
| `npm run circuit:verify` | Official artifact checksums and exported verification key |
| `npm run circuit:info` | Registered VK hash still matches the official endpoint |
| `npm run claims` | Regenerates `docs/CLAIMS.md` from artifacts, lockfile, and live endpoints |
| `npm run receipt:sample` | Generates a labelled local sample receipt with a real official-circuit proof |
| `npm run receipt:verify -- <file>` | Re-verifies a receipt: policy replay, public signals, Groth16 proof, response HMAC |
| `npm run preflight -- <base-url> <agent-id>` | Official signed preflight against a live deployment (needs `AGENT_GAMES_HMAC_SECRET`) |

---

## Deployment

- **Hosting:** Vercel project `veridun`, connected to this GitHub repository so
  every push to `main` produces an automatic deployment. The dashboard is static
  output; the API is one catch-all serverless function with a 60-second maximum
  duration and 2048 MB memory.
- **Database:** Neon (Vercel Marketplace integration), with `DATABASE_URL`
  injected as a production environment variable.
- **Runtime:** Node.js `24.x`, pinned in both `package.json` and the project
  settings. Node 26 removed `require(esm)`, which the runtime loader needs.
- **Circuit artifacts:** downloaded and checksum-verified during every build by
  `npm run circuit:prepare`, then bundled into the function with
  `includeFiles`.
- **Cost:** Vercel and Neon free tiers are sufficient for this workload; no
  sponsor allowance is documented for the event.

Local development can also run as containers: `docker compose up` starts the API
and PostgreSQL 16.

---

## Repository layout

```text
api/[...path].ts        Vercel Web Handler entry point
src/api/                Fastify application, Vercel bridge, Node HTTP dispatcher
src/agent/              policy engine, HMAC, prover, zkVerify verifier, Kurier client
src/db/                 PostgreSQL pool, repository, migrations
src/shared/protocol.ts  Zod schemas for the platform contract
web/                    React operations console
scripts/                circuit preparation, claims registry, preflight, migrations
tests/                  unit, integration, and live-verifier tests
docs/                   architecture, circuit notes, product brief, event rules, claims
```

---

## Security notes

- HMAC verification happens over the raw body before parsing; signature and
  secret headers are redacted from logs.
- Request bodies are capped and rejected before expensive work.
- The API never returns raw envelopes, secrets, or the Kurier API key.
- Proofs are verified locally before they are published or submitted; a failed
  verification aborts the approval path.
- The service fails closed on malformed data, expired envelopes, verifier
  uncertainty, proof failure, or time exhaustion.

## Known limitations

- The official build guide does not publish the task-ID field conversion.
  Veridun encodes a UUID suffix as the 128-bit value and supports `sha256` and
  `keccak256` alternatives; official practice mode is the acceptance test.
- A locally verified proof is described as locally verified until the platform
  confirms it in a scored round.
- The inbound proof-reference check uses the public zkVerify RPC and the
  Subscan-rendered page because no keyed indexer credential is available.

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Topology, request lifecycle, persistence, deployment shape |
| [`docs/CIRCUIT.md`](docs/CIRCUIT.md) | Circuit identity, recovered interface, field conversions |
| [`docs/PRODUCT-BRIEF.md`](docs/PRODUCT-BRIEF.md) | User, situation, outcome, non-goals, evidence |
| [`docs/EVENT-RULES.md`](docs/EVENT-RULES.md) | Submission specification, gates, rubric, evidence table |
| [`docs/CLAIMS.md`](docs/CLAIMS.md) | Generated factual registry (do not edit by hand) |
