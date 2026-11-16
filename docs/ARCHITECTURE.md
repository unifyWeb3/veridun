# Veridun architecture

## Topology

```text
Agent Games
    │ signed JSON over HTTPS
    ▼
Fastify API ───────────────► React operational dashboard
    │                                  │
    ├── HMAC/raw-body verifier         └── read-only JSON API
    ├── PostgreSQL repository
    ├── deterministic policy engine
    ├── local Circom witness + snarkjs Groth16 prover
    ├── inbound proof-reference finality verifier
    └── Kurier client ───────────────► zkVerify mainnet
```

The API and dashboard are one deployable artifact. The API serves `/agent`, `/health`, `/api/*`, and the compiled dashboard. PostgreSQL is the only durable system of record. Circuit artifacts are downloaded during image preparation and checksum-verified before the service starts.

## Request lifecycle

1. Fastify's JSON parser reads the request as a buffer.
2. The parser verifies `x-agent-games-signature` over those exact bytes. A failure returns a signed 401 before `JSON.parse` is called.
3. The envelope is schema-validated. Preflight returns the signed `{ok:true,protocolVersion:"v1"}` response.
4. The repository transactionally inserts the task ID and proof reference. A unique task ID returns the stored response; a unique proof owned by another task yields `PROOF_REUSED`.
5. The policy engine evaluates the documented checks in a fixed order and never asks a model.
6. The prover maps task fields to the official circuit inputs, generates Groth16, and verifies the proof locally.
7. The proof is submitted to Kurier when configured. Finalization is recorded but never changes the decision.
8. The response body and HMAC are stored atomically. The exact stored bytes are returned, including on a retry.

## Decision and circuit relationship

The circuit can prove an approval only if every circuit-visible check passes. It can also prove a rejection caused by a failed circuit-visible check. Replay is external state, so `PROOF_REUSED` intentionally returns without a proof, matching the published scoring rule.

Circuit inputs use the recovered camelCase signal names:

- `registeredVkHash`, `proofVkHash`
- `minimum`, `publicBalance`
- `expiryBlock`, `currentBlock`
- `recipient`, `conditionRecipient`
- `amount`, `maxTransfer`
- `decision` (`1` approve, `0` reject)
- `taskId`
- private `salt`

The expected public-signal order is commitment, registered VK, proof VK, minimum, balance, expiry, current block, recipients, amount, cap, decision, task ID.

## Persistence model

### `agent_tasks`

One row per task ID. Stores the request digest and envelope, lifecycle state, decision, reason, response bytes/signature, proof, public signals, timings, errors, and Kurier metadata.

### `proof_references`

One row per incoming proof transaction. The first task that claims a reference owns it. A later task with the same reference is a replay.

### `proof_attempts`

Append-only proof lifecycle evidence: generation, local verification, Kurier submission, polling state, finalization, and errors.

## Concurrency and failure recovery

- Task claiming is protected by a primary key and `INSERT ... ON CONFLICT` semantics.
- The first claimant owns the proof reference. A retry of the same task does not become a replay.
- A completed task returns its exact stored body and signature.
- A concurrent duplicate waits for the first response up to the task budget.
- A failed task can be reclaimed by a later retry because its proof-reference owner remains the same task ID.
- Database unavailability returns a retryable 503; it never silently converts uncertainty into approval.

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/agent` | Signed preflight and Proof Gatekeeper tasks |
| `GET` | `/health` | Liveness and dependency readiness (unsigned, non-secret) |
| `GET` | `/api/dashboard/summary` | Aggregate task, proof, latency, and finalization metrics |
| `GET` | `/api/tasks` | Paginated task list with decision/reason/status filters |
| `GET` | `/api/tasks/:taskId` | Task detail, policy checks, proof, signals, and attempts |
| `GET` | `/api/proofs` | Proof and Kurier evidence ledger |

## Dashboard route hierarchy

1. `/overview` — operational status, decision mix, proof health, recent failures.
2. `/tasks` — searchable task queue.
3. `/tasks/:taskId` — full decision and evidence trail.
4. `/proofs` — proof generation/finalization ledger.

The dashboard reads real database state. It does not ship synthetic activity as if it were live.

## Security boundaries

- HMAC secret, Kurier key, and database URL are environment-only.
- Request bodies are capped and rejected before expensive work.
- The API never logs raw signed envelopes, signatures, or secrets.
- Public task references are stored, but dashboard responses omit raw envelope bodies by default.
- The outbound Kurier API key appears in a URL path; URLs are never logged.
- Proofs are checked locally before publication or submission.
- The service fails closed on malformed data, expired envelopes, verifier uncertainty, proof failure, or time exhaustion.

## Deployment shape

The included Docker Compose stack runs:

- `api`: Node.js service, compiled dashboard, official circuit artifacts;
- `db`: PostgreSQL 16 with a health check and persistent volume.

Production must place the API behind an HTTPS reverse proxy/load balancer and use a persistent, non-sleeping host. The service exposes no custom port requirement to the Agent Games platform; the public proxy owns 443 and routes to the container.
