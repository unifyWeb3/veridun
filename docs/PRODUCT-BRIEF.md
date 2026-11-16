# Veridun — product brief

## Weakest part first

The weakest part is not the policy logic; it is the boundary between our locally valid proof and the platform’s unpublished task-ID encoding and live finality evidence. The event publishes the circuit artifacts but not the exact field conversion for `task_id`, and the official task payload contains an on-chain proof reference rather than the proof bytes. Veridun therefore treats those boundaries as configurable, observable, and fail-closed. A local proof is never described as platform-verified until official practice confirms it.

## Product name

**Veridun** is a single invented word. It evokes a guarded threshold without borrowing the event name. A GitHub repository-name search for the exact word returned zero matching repositories on 2026-11-15, compared with generic candidates such as “ProofGatekeeper” that are highly likely to collide. This is a practical collision check, not trademark clearance.

## Primary user

A competition operator who needs to answer eight proof-backed payment tasks per round without using manual judgment, then prove and audit every decision under a 60-second deadline.

## Situation that creates the need

The Agent Games platform sends signed payment tasks to a public endpoint. A valid incoming zero-knowledge proof can still authorize the wrong recipient, amount, threshold, expiry window, verification key, or reused proof reference. The operator must apply every rule deterministically, return a signed decision, attach a fresh Groth16 proof, and remain available throughout eight scored rounds.

## What they do today

The common substitute is a lightweight endpoint that checks a few strings, keeps an in-memory `Set` of seen proof references, generates a snarkjs proof, and returns. That is adequate for a demo but weak operationally: a restart loses replay history, concurrent retries can race, a retried task can produce a different answer, and there is little evidence for diagnosing a missed proof or timeout.

## Outcome that changes

Veridun turns the endpoint into an auditable decision service:

- raw-body HMAC authentication occurs before JSON parsing;
- PostgreSQL transactionally claims each task ID and each proof reference;
- a platform retry receives the exact original signed response bytes;
- every rule is deterministic and ordered against the published trap taxonomy;
- a proof is generated only when the circuit can prove the decision, then verified locally;
- Kurier submission and finalization are tracked separately from the decision;
- the dashboard shows the live decision queue, proof evidence, replay ownership, timing, and failures.

## Essential journey

1. The platform signs and posts a task to `/agent`.
2. Veridun authenticates the exact body, claims the task, checks the inbound proof reference, and evaluates all seven rules.
3. Veridun generates and locally verifies a Groth16 proof where the circuit permits one.
4. Veridun persists the signed response and proof evidence, then returns it before the internal deadline.
5. The operator opens the dashboard to see what happened, why, and whether the proof/finalization is healthy.

## Constraints

- Public HTTPS endpoint with no cold sleep.
- Signed requests and responses using the platform-issued HMAC secret.
- HMAC verification over the raw body before parsing.
- Structured `decision` and `reason_code` response; proof and 13 public signals on every provable task.
- 60-second hard platform deadline; Veridun uses a 55-second internal budget.
- One agent per owner; no manual task responses.
- Official mainnet Groth16/BN128 circuit and registered key.
- PostgreSQL persistence is required for replay and idempotency guarantees.
- Secrets remain in environment variables and are never logged.

## Explicit non-goals

- No language model in the final decision path.
- No replacement circuit, custom contract, or alternate scoring model.
- No custodial wallet, token transfer, or treasury management.
- No multi-track strategy engine; this build targets Proof Gatekeeper only.
- No fabricated live metrics in the dashboard; empty and error states are shown honestly.
- No deployment, account creation, secret rotation, or event submission without explicit user action/authorization.

## Substitute, including doing nothing

Doing nothing forfeits every task and loses the entry’s evidence value. A memory-only endpoint is the realistic substitute, but it trades reliability for speed and cannot demonstrate durable replay handling. Veridun is justified only if its operational evidence materially reduces missed tasks and makes failures diagnosable; the final practice/round results must validate that hypothesis.

## Claims, evidence, and confidence

| Claim | Label | Evidence | Confidence |
| --- | --- | --- | --- |
| The official circuit is Groth16/BN128 with 13 public signals and 647 variables. | Verified | Exported official proving key and verification key; SHA-256 values recorded in `docs/EVENT-RULES.md`. | High |
| The circuit input names are camelCase signals recovered by independent artifact probes. | Verified locally | Local witness/proof test against the official WASM/ZKEY; implementation additionally pins the public-signal order. | High locally, pending official practice |
| A task ID ending in a UUID is encoded as the 128-bit UUID suffix in the circuit field. | Assumed | Independent implementations and live artifact behavior point to this conversion; the official build guide does not publish it. | Medium |
| The inbound `proof_tx` is finalized before approval. | Assumed unless live-checked | The task references a chain transaction, but no public read API key is available. Veridun can inspect the public Subscan-rendered extrinsic. | Medium |
| Durable PostgreSQL replay protection improves competition reliability over a memory set. | Proposed | Database constraints and failure-recovery tests implement the mechanism; competition outcome is unmeasured. | High mechanism / low outcome |
| The dashboard helps an operator diagnose a missed task quickly. | Proposed | The operational hierarchy and evidence fields are designed for this; no operator usability study has been run. | Medium-low |

## Acceptance evidence

| Requirement | Output | Verification |
| --- | --- | --- |
| Raw HMAC before parsing | Signed API handler | Invalid-signature test must fail before policy/DB access. |
| Deterministic seven-rule policy | `src/agent/policy.ts` | One test per rule plus equality boundaries. |
| Durable task idempotency | PostgreSQL migration/repository | Concurrent duplicate test must produce one stored response and identical bytes. |
| Durable replay detection | `proof_references` table | Same proof under another task must yield `PROOF_REUSED`. |
| Valid proof | `src/agent/prover.ts` | Local `groth16.verify` must return true against the exported official key. |
| No false proof | Circuit enforcement test | An APPROVE witness on a trap must fail witness generation. |
| Kurier integration | `src/agent/kurier.ts` | Contract test for submit/poll mapping; live finalization pending key. |
| Operational dashboard | `web/` | Browser check of loading, empty, populated, and failure states. |
| Clean checkout | npm workspace + Docker | Install, migrate, test, build, and health check from a clean dependency directory. |
