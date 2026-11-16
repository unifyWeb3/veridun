# Veridun architecture

## Topology

```text
Agent Games
    │ signed JSON over HTTPS
    ▼
Vercel edge ──► api/[...path].ts (catch-all serverless function)
                     │  raw request bytes
                     ▼
                 src/api/vercel.ts ──► src/api/node-dispatch.ts ──► Fastify application
                     │                                              ├── HMAC/raw-body verifier
                     │                                              ├── deterministic policy engine
                     │                                              ├── local Circom witness + snarkjs Groth16 prover
                     │                                              ├── inbound proof-reference finality verifier
                     │                                              └── Kurier client ──► zkVerify mainnet
                     │                                              │
                     ▼                                              ▼
              static dashboard (React) ◄──────────── PostgreSQL repository (Neon)
```

The deployed artifact is one Vercel project: the dashboard is static output and
every API call is routed to a single catch-all serverless function, so the
signed raw-body contract is byte-identical on Vercel and on the local Node
server. PostgreSQL is the only durable system of record. Circuit artifacts are
downloaded during the build, checksum-verified before the build continues, and
bundled into the function.

## Request lifecycle

1. The Vercel Web Handler receives the request and reads the exact body bytes.
2. `src/api/node-dispatch.ts` dispatches those bytes through Fastify's Node HTTP
   handler (`app.routing`) rather than `app.inject()`. Fastify's injection helper
   depends on `light-my-request`, whose CommonJS `require()` of the ESM-only
   `cookie` package fails inside the Vercel Node runtime (`ERR_REQUIRE_ESM`).
   `tests/vercel-handler.test.ts` guards against reintroducing `inject()`.
3. Fastify's JSON parser reads the request as a buffer.
4. The handler verifies `x-agent-games-signature` over those exact bytes. A
   failure returns a signed 401 before `JSON.parse` is called.
5. The envelope is schema-validated. Preflight returns the signed
   `{ok:true,protocolVersion:"v1"}` response.
6. The repository transactionally inserts the task ID and proof reference. A
   unique task ID returns the stored response; a unique proof owned by another
   task yields `PROOF_REUSED`.
7. The policy engine evaluates the documented checks in a fixed order and never
   asks a model.
8. The prover maps task fields to the official circuit inputs, generates Groth16,
   and verifies the proof locally.
9. The proof is submitted to Kurier when configured. Finalization is recorded but
   never changes the decision.
10. The response body and HMAC are stored atomically. The exact stored bytes are
    returned, including on a retry.

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
| `POST` | `/api/agent` | Same handler, API-prefixed alias |
| `GET` | `/health` | Liveness and dependency readiness (unsigned, non-secret) |
| `GET` | `/api/health` | Same handler, API-prefixed alias |
| `GET` | `/api/summary` | Aggregate task, proof, latency, and finalization metrics |
| `GET` | `/api/tasks` | Paginated task list with decision/reason/status filters |
| `GET` | `/api/task?task_id=…` | Task detail, policy checks, proof, signals, and attempts |
| `GET` | `/api/proofs` | Proof and Kurier evidence ledger |

`/api/dashboard/summary` and `/api/tasks/:taskId` are registered aliases for
direct Fastify access. Vercel only routes one-segment `/api/*` paths to the
catch-all function, so `vercel.json` rewrites the nested aliases onto the
canonical single-segment paths; the dashboard calls the canonical paths
directly.

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

### Production (current)

- **Vercel** project `veridun`, connected to `https://github.com/unifyWeb3/veridun`
  so every push to `main` produces an automatic deployment. Production aliases:
  `veridun.vercel.app`, `veridun-oxunify.vercel.app`,
  `veridun-git-main-oxunify.vercel.app`.
- **One serverless function** (`api/[...path].ts`) with `maxDuration: 60`,
  `memory: 2048`, and the circuit artifacts bundled through `includeFiles`.
- **Node.js 24.x**, pinned in `package.json` and in the project settings.
  Node 26 removed `require(esm)`, which the runtime loader needs to load the
  Fastify injection helper; the deployed handler no longer depends on it, but
  the pin keeps local and deployed behaviour identical.
- **Neon PostgreSQL** through the Vercel Marketplace integration; `DATABASE_URL`
  is injected as a production environment variable.
- **Circuit artifacts** are downloaded and checksum-verified by
  `npm run circuit:prepare` during every build, then bundled into the function.

### Local and self-hosted

The included Docker Compose stack runs:

- `api`: Node.js service, compiled dashboard, official circuit artifacts;
- `db`: PostgreSQL 16 with a health check and persistent volume.

Production behind a self-managed proxy must place the API behind an HTTPS
reverse proxy/load balancer and use a persistent, non-sleeping host. The service
exposes no custom port requirement to the Agent Games platform; the public proxy
owns 443 and routes to the container.
