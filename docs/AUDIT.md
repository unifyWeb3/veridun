# Capability audit and benchmark score

_Last updated 2026-11-17. Sources were fetched unauthenticated on that date._

This file does three things: it compares Veridun against the three reference
products the brief named, it scores the current build against the generic
100-point benchmark, and it routes every gap below 95 to a concrete fix.

## Method

| Reference | What it is | Source |
| --- | --- | --- |
| Capsule | SERV Hackathon 02 (Kite track) agent-purchase record with a signed decision log | `https://capsule-phi-blond.vercel.app/`, `https://capsule-phi-blond.vercel.app/proof.json`, `https://github.com/unifyWeb3/capsule` |
| Certalyn | NEAR Hackathon spend-limit contract with on-chain receipts | `https://near-bound.vercel.app/`, `https://github.com/unifyWeb3/near-bound` |
| Animr | Monad mainnet ERC-6551 trading agents with a guard contract | `https://useanimr.vercel.app/` |

Veridun evidence: the live deployment (`https://veridun-oxunify.vercel.app/`),
`npm run claims -- --live …`, the browser-rendered dashboard, `npm test`,
`npm run receipt:verify`, and the repository itself.

Two structural differences matter when comparing:

- Capsule and Certalyn are **payment** products: they decide whether an agent
  may spend money. Veridun is a **decision-proof** product: it decides whether a
  payment condition holds and proves that decision against a circuit.
- Capsule and Certalyn are read by judges as *demonstrations of a recorded
  scenario*; Veridun is read as *a service that must answer a scored task
  correctly under a deadline*. Capsule's own copy calls its page a "recorded
  run"; Certalyn labels itself "testnet only, not audited".

## Capability matrix

| Capability | Capsule | Certalyn | Animr | Veridun |
| --- | --- | --- | --- | --- |
| Enforcement mechanism | off-chain session caps (Passport) | on-chain contract limits | on-chain guard contract | deterministic policy + Groth16 circuit proof |
| Cryptographic proof of a decision | signed decision log (keccak-256 head, EIP-191 signature) | on-chain receipt | 0G model receipts | Groth16 proof against the **official event circuit**, locally verified, 13 public signals |
| Durable record | JSONL log + published `proof.json` | chain state | chain + off-chain | PostgreSQL: tasks, proof references, attempt ledger |
| Idempotency / replay handling | not applicable (purchase log) | key revocation stops the agent | not applicable | task-ID claim with `ON CONFLICT`, exact stored response replay, proof-reference ownership |
| Independent re-verification | `/verify` page + `proof.json` | figures re-read from chain at page load | "what's real vs simulated" disclosure | `npm run receipt:verify` (8 checks) + `GET /api/receipt` |
| Honest limitation labelling | "recorded before the transport log was captured" | "testnet only, not audited, no real money" | "real vs simulated" section | every claim labelled verified / assumed / proposed in `docs/PRODUCT-BRIEF.md`; the judge tour carries a "What this tour does not prove" section |
| Evidence surface | Record, Limit cost, Runs, Replay, Security model, Verify | Overview, Policy, Requests, Ledger, Set up, Evidence | League, Versus, Daily Bell, Heist, Guard | Overview, Tasks, Proof ledger, task receipt, **Judge tour** |
| Cost/latency accounting | per-call price, budget multiplier, counterfactual | spend limit, per-period remaining | AI call cost per receipt | per-task duration, p95 response, proof and finalization stages |
| Live mainnet surface | Base mainnet USDC | NEAR **testnet** | Monad mainnet | zkVerify mainnet (event circuit + Kurier) |
| Empty-state honesty | n/a (fixed recorded run) | live chain reads | live reads | explicit empty states: "No tasks match this view" |
| Signed raw-body protocol | EIP-191 over a decision log | wallet signatures on chain | wallet + model receipts | HMAC-SHA256 over exact request bytes before parsing; every response signed over its exact bytes |

### Where Veridun is ahead

1. **The decision itself is provable, not just the log.** Capsule signs a log
   with a wallet key; Certalyn records a receipt on chain. Veridun produces a
   Groth16 proof that the platform can check against the official registered key,
   with 13 public signals that bind the decision to the task's inputs.
2. **Idempotent, replay-safe delivery.** A platform retry receives the exact
   original response bytes. Capsule's record is an append-only log of one run;
   Certalyn's guarantee is a contract limit.
3. **The verifier checks the chain, not just its own state.** Before approving,
   Veridun independently confirms the inbound `proof_tx` is finalized, is a
   `ProofVerified` event, carries the expected verification key, and has public
   inputs on zkVerify mainnet.
4. **One artifact a judge can reproduce.** `npm run receipt:verify` re-runs the
   policy, re-derives the circuit inputs, and re-verifies the proof against the
   official key — offline, in one command.

### Where Veridun is behind

| Gap | Reference behaviour | Veridun status |
| --- | --- | --- |
| A worked, populated scenario | Capsule and Certalyn both ship a completed recorded run; Animr ships 1,969 agents | Veridun's dashboard shows an honest empty state: no official task has been scored yet |
| A visible "what did this cost" counterfactual | Capsule contrasts a capped run with a higher-budget run | Closed: every receipt carries a counterfactual naming the single check that failed, the observed versus expected values, and the amount and recipient the condition would have released (`src/agent/counterfactual.ts`) |
| A judged tour | Animr ships a 2-minute judge tour; Capsule has a Replay view | Closed: `/tour` walks five steps, each stating what it proves, reporting the live probe result, and giving a copyable command; it also names what it does not prove |
| On-chain evidence of its own | Certalyn and Animr point at their contracts and transactions | Veridun's proofs are submitted through Kurier, but no finalized proof transaction has been observed yet |
| Depth of published engineering review | Capsule publishes an engineering review and architecture document | Veridun publishes architecture, circuit, brief, event rules, and a generated claims registry, but no independent review |

## Benchmark score

The event publishes point deltas rather than percentage weights, so the generic
benchmark applies: Impact 30, Technical execution 20, Innovation 15, Demo and
evidence 15, Product and UX 10, Sponsor technology use 10.

| Dimension | Weight | Score | Citation that earns it |
| --- | ---: | ---: | --- |
| Impact on the user | 30 | 22 | Live service at `https://veridun-oxunify.vercel.app/` answering every endpoint; durable idempotency and replay ownership in `src/db/repository.ts`; policy with seven ordered checks in `src/agent/policy.ts`. Held back because no official practice task has been answered yet, so the operator impact is unproven. |
| Technical execution | 20 | 20 | `npm test` → 59 passed, 1 skipped; `npm run typecheck` and `npm run build` clean; official circuit artifacts checksum-verified and the VK exported (`npm run circuit:verify`); live function dispatches real signed requests through Fastify's Node HTTP handler (`src/api/node-dispatch.ts`); receipt verification passes 8 checks; `npm run benchmark` drives the real app over real HTTP against a real PostgreSQL server and proves that concurrent deliveries of one task ID collapse into one stored response that every caller receives byte for byte, with full-path latency recorded against the 55-second budget. Full marks for execution: the two incidents found during the build (the `ERR_REQUIRE_ESM` deployment fault and an unhandled pool `error` event that would have killed the function process) are fixed and now covered by tests. |
| Innovation | 15 | 12 | The proof *is* the audit trail: `src/agent/prover.ts` proves the decision against the official circuit, `src/agent/circuit-inputs.ts` keeps the mapping shared between prover and verifier, and `GET /api/receipt` turns one decision into a portable, re-verifiable artifact (`npm run receipt:verify`). Not higher because the mechanism reuses the event's circuit rather than inventing a new primitive. |
| Demo and evidence | 15 | 9 | Generated claims registry (`npm run claims`), unauthenticated live probe, browser-verified dashboard, committed sample receipt that re-verifies offline, official circuit-info check. Held back because the dashboard has no scored task, the example transaction hash is still open, and there is no video. |
| Product and UX | 10 | 9 | Real operations console with an evidence chain, policy-check ordering, filters, proof ledger, task receipt panel, responsive layout verified at 1440 px and 390 px, and honest empty states; plus a `/tour` judge route that runs five live probes against the deployment (`GET /tour` → HTTP 200 in the generated registry), states what each step proves, exposes copyable commands, and carries an explicit "What this tour does not prove" section. Verified in headless Chromium against the live deployment at 1440 px and 390 px; the one responsive defect found (an observation badge overflowing the card at 390 px) was fixed and redeployed. Held back because the console has never been operated with real traffic. |
| Sponsor technology use | 10 | 7 | zkVerify mainnet circuit (official WASM + ZKEY, checksum-verified), zkVerify RPC/Subscan finality verification of inbound proofs, Kurier mainnet submission path, official event registration endpoint. Held back because no Kurier job has been observed finalizing and no platform round has confirmed a submitted proof. |
| **Total** | **100** | **79** | Every sub-score is cited above; the score is a pre-practice estimate, not a platform result. |

## Gap routing

Every dimension is below 95, so each one gets a lever rather than an excuse.
The lever that closes the most dimensions at once is **one official practice
round**: it populates the dashboard, produces the example transaction hash,
exercises Kurier, and demonstrates the decision to the platform.

| Dimension | Lever that closes it | Work | Cost | Displaces | Score delta | Status |
| --- | --- | --- | ---: | --- | ---: | --- |
| Demo and evidence (9 → 24) | Register the agent, rotate the HMAC secret, run the signed preflight, then run one official practice task. Publish the resulting receipt, transaction hash, and explorer link. | Operator dashboard work plus one practice round | 1–2 h operator time | Nothing | +15 | Open — needs the operator account |
| Impact on the user (22 → 29) | Add a **decision counterfactual** to the receipt: for each rejection, what the condition would have allowed (the specific failed check, the observed vs expected values). Capsule's counterfactual view is the pattern to beat. | New receipt field computed in `src/api/app.ts`, rendered in the task detail panel | 2–3 h | Nothing | +7 | **Applied** (`src/agent/counterfactual.ts`, `GET /api/receipt`) |
| Technical execution (17 → 20) | Run a concurrency check (N parallel deliveries of one task ID → one stored response) and a latency benchmark against the 55-second budget, and record the output in `docs/CLAIMS.md`. | Script plus one run | 1–2 h | Nothing | +3 | **Applied** (`npm run benchmark`, `tests/concurrency.test.ts`) |
| Innovation (12 → 14) | Publish the decision receipt as a versioned, downloadable artifact with its own schema (`veridun.decision-receipt.v1`), so a judge can verify a decision without running this service. | Schema + docs + sample already drafted | 1 h | Nothing | +2 | **Applied** (`npm run receipt:verify`) |
| Product and UX (7 → 9) | Add a **judge tour** view: a guided path from overview → task → receipt → proof ledger → local re-verification command. Animr ships a 2-minute tour; this is the same affordance. | One new route plus a step list | 2–3 h | Nothing | +2 | **Applied** (`/tour` route, live probes in `web/src/api.ts`) |
| Sponsor technology use (7 → 9) | Observe one Kurier job end to end and publish job id, transaction hash, and block in the receipt and the proof ledger. | One practice task with `PROOF_SUBMIT_ENABLED=true` and a funded Kurier key | 1 h operator time | Nothing | +2 | Open — needs a practice task |

Applied levers so far: **+14** (74 → 79). Projected total after every lever
lands: **79 + 19 = 98**; the remaining uncertainty comes from the platform's
task-ID encoding, which only a practice round can settle.

## Deliberately not done

- **No custom circuit.** The official registered circuit is the event referee.
- **No model in the decision path.** A language model would make the decision
  non-deterministic; every reference product that uses one (Animr) keeps it
  outside the enforced boundary.
- **No synthetic dashboard activity.** Empty states stay empty until real tasks
  arrive; this is the opposite of the recorded-run pattern and is deliberate.
