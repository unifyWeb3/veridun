# Event rules and gates

_Last verified against official Agent Games pages on 2026-11-15, and against the live deployment on 2026-11-17. This file is the submission specification; update it when the platform or deployment state changes._

Machine-generated values (circuit digests, VK hash, toolchain versions, live endpoint probe) are produced by `npm run claims` into `docs/CLAIMS.md` and are not transcribed here.

## Event

| Item | Value |
| --- | --- |
| Event name | zkVerify Agent Games 2026 — Proof Gatekeeper |
| Official URL | https://agentgames.zkverify.io/events/proof-gatekeeper |
| Sponsor / platform | zkVerify / Horizen Labs |
| Prize structure, prize count, currency | 100,000 VFY for Proof Gatekeeper: 50,000 / 30,000 / 20,000 VFY for first / second / third. Entry is free; no sponsor allowance is documented. |
| Submission opens (with timezone) | Registration opened 2026-10-21. Scored rounds run 2026-11-13 through 2026-11-21; each daily round is 16:00–02:00 IST. |
| Deadline (with timezone) | Competition closes 2026-11-21 22:00 UTC. |
| **Total time budget** | The build was resumed on 2026-11-15 with a fixed six-day event window; no artificial time-box was imposed beyond the official deadline. |
| **Phase split derived from the budget** | Rules/product brief and architecture first; proof-path implementation and tests second; dashboard third; deployment and official practice verification last. |
| Judging model | Deterministic task scoring plus reliability bonus; final prize placement is by cumulative round score with published tie-breakers. |
| Screening before scoring | Registration, profile eligibility, signed preflight, and at least one practice task are required before an agent is active. |
| Submission order effect | No published first-submit advantage. Task IDs are idempotency keys and the platform may retry deliveries. |
| Editable after submitting | Agent endpoint and profile remain editable in the dashboard, but one agent per owner is allowed and entries lock while a round is open. |
| Required build tool or platform, and how it is verified | TypeScript/Node.js service with local Groth16/BN128 proof generation using the official Circom 2.x WASM and proving key. The platform independently verifies every submitted proof against its registered key. |

## Rubric and gates

The event publishes point deltas rather than percentage weights. They are used as the rubric weights below; this is not a percentage model.

| Criterion (verbatim) | Weight | Our plan | Evidence we will produce | Owner | Status |
| --- | ---: | --- | --- | --- | --- |
| Correct APPROVE (verified) | +12 | Approve only when every deterministic rule passes and a locally verified proof is attached. | Unit fixtures for every rule; local Groth16 verification; practice result. | Builder | In progress |
| Correct REJECT (verified) | +12 | Reject the exact trap with the documented reason code and attach a proof when the circuit can prove it. | One fixture per trap plus a negative circuit-enforcement test. | Builder | In progress |
| Incorrect APPROVE | −6 | Fail closed; the circuit must also reject an invalid approval witness. | Negative witness-generation test and decision/proof mismatch test. | Builder | In progress |
| Incorrect REJECT | −3 | Exercise equality boundaries and official practice traps. | Boundary suite and practice history. | Builder | In progress |
| Delivery timeout | −2 | Time-box all work to 55 seconds; use a persistent queue and a response-budget guard. | Load test plus request-duration telemetry. | Builder | In progress |
| Missing / invalid proof | −2 | Generate locally, verify against the official verification key, and never fabricate evidence. | Proof test that exits non-zero if verification fails. | Builder | In progress |
| Reliability bonus | +0 to +5 | Track proof generation, local verification, Kurier status, and finalization per task. | Database evidence plus dashboard proof ledger. | Builder | In progress |

## Required submission fields

| Field | Value we will submit | Verified link or artifact | Status |
| --- | --- | --- | --- |
| Project name | Veridun | `README.md` and package metadata | Ready |
| One-line claim (vision) | Every proof-backed payment decision leaves a durable, inspectable trail. | `README.md` | Ready |
| Description | Veridun is a production-oriented Proof Gatekeeper agent and proof-operations dashboard with deterministic policy, durable replay protection, local Groth16 proofs, zkVerify/Kurier integration, and auditable evidence. | `README.md` | Ready |
| Live app URL | `https://veridun-oxunify.vercel.app/` (agent endpoint: `https://veridun-oxunify.vercel.app/agent`) | `npm run claims -- --live https://veridun-oxunify.vercel.app` | Ready |
| Repository URL | `https://github.com/unifyWeb3/veridun` | Repository `origin` | Ready |
| Repository revision submitted | `main` at the commit that produced the current production deployment (recorded in the deployment metadata and in `docs/CLAIMS.md` generation log) | `git rev-parse HEAD` | Ready |
| Contract address(es) | None; this track uses the platform-registered Groth16 key recorded in `docs/CLAIMS.md` | Official circuit-info endpoint | Ready |
| Example transaction hash | Pending official practice/Kurier finalization | — | Open |
| Explorer link | Pending example transaction | — | Open |
| Video URL | Not required by the Proof Gatekeeper page; pending optional demo | — | Open |
| Builder profile URL | User-managed Agent Games profile | — | Open |
| Required tool or platform project URL | zkVerify Agent Games | https://agentgames.zkverify.io | Ready |
| Disclosures (funding, prior work, team) | Single builder; original implementation; no sponsor funding | `README.md` | Ready |
| Other | Product name is one distinctive word. GitHub repository-name search returned zero exact-name matches for “Veridun” when checked on 2026-11-15; this is a collision check, not trademark clearance. | Name research record in `docs/PRODUCT-BRIEF.md` | Ready |

## Eligibility

| Requirement | Met | Evidence |
| --- | --- | --- |
| Built with the required tool | Yes | TypeScript/Node.js, official Circom 2.x artifacts, Groth16/BN128. |
| Deployed to the target network | Yes for the service; the event itself has no contract deployment | The agent is live on Vercel (`https://veridun-oxunify.vercel.app/agent`) against the mainnet event circuit and the mainnet zkVerify chain. |
| Real value moved through the contract and the app | Not applicable to Proof Gatekeeper scoring | The track verifies decision proofs; the task payload does not move user funds. |
| Not testnet-only | Yes | The event circuit and registered key are mainnet, the Kurier endpoint is mainnet, and the live agent verifies inbound mainnet finality. |
| Not a mockup, deck, or design | Yes in implementation | Executable service, PostgreSQL persistence, proof harness, live deployment, and dashboard are included. |
| Not already funded by a sponsor program | Yes | No funding is recorded. |
| Work is ours, or we have the right to submit it | Yes | Original implementation based on the published protocol and public circuit artifacts. |
| Jurisdiction and sanctions eligibility | User-managed | Not documented in the public event rules; the registered profile governs eligibility. |
| One submission per project | Yes | One Veridun submission is planned. |

## Artifact identity

| Field | Value |
| --- | --- |
| Toolchain and version | Generated in `docs/CLAIMS.md` (Node.js engine `24.x`, npm, and resolved dependency versions) |
| Compiler version | Circom 2.x official artifact (the event does not publish the exact patch version) |
| Optimizer / runs | Official published proving key; not recompiled |
| EVM target | Not applicable |
| `viaIR` | Not applicable |
| Artifact path in repository | `artifacts/circuit/gatekeeper.wasm`, `artifacts/circuit/gatekeeper_final.zkey`; downloaded and checksum-verified by `scripts/prepare-circuit.mjs` |
| Artifact keccak-256 | Not generated; SHA-256 integrity is the reproducible source of truth |
| Artifact byte length | Recorded in `docs/CLAIMS.md` and in `artifacts/circuit/checksums.txt` |
| Deployment transaction and block | Not applicable before deployment; Kurier proof transactions are recorded per task |
| On-chain runtime keccak-256 | Not applicable |
| On-chain byte length | Not applicable |
| Comparison result | Local proof verification must pass against the verification key exported from the official proving key |
| Test suite re-run against this configuration (date, output file) | `npm test` re-run on 2026-11-16: 51 passed, 1 skipped (live zkVerify test is opt-in) |

## Headline claim enforcement

| Assertion in the claim | Enforced by (contract rule / code path / mechanism) | Status |
| --- | --- | --- |
| Every decision is deterministic | `src/agent/policy.ts`; no model participates in the decision path | Implemented |
| Every decision leaves a durable trail | PostgreSQL `agent_tasks`, `proof_references`, and `proof_attempts`; transaction before response | Implemented |
| Approval evidence is cryptographically checked | `src/agent/prover.ts`; `snarkjs.groth16.verify` against the exported official verification key | Implemented |
| Reused proofs cannot be approved twice | Unique `proof_references.proof_tx` plus first-task ownership check | Implemented |
| Platform retries receive the same response | Task-ID idempotency record stores the exact signed response bytes | Implemented |

## Limitations consistency

| Limitation | Does it negate the headline claim? | Action |
| --- | --- | --- |
| Official practice has not yet validated the platform’s expected task-ID field encoding | No; the circuit proof remains cryptographically valid, but public-signal semantics could be rejected | `TASK_ID_ENCODING` supports `auto`, `hex-suffix`, `sha256`, and `keccak256`; validate in practice mode before a scored round. |
| Live hosting is live, but no official practice round has been scored yet | No for the implementation; yes for "platform-verified" claims | The service is externally verified; a practice round is an operator action. Do not describe a locally verified proof as platform-verified until the platform confirms it. |
| Inbound proof-reference finality uses the public zkVerify RPC and the public Subscan-rendered page because no public read API key is available | No | Keep finality checks explicit and observable; replace with a keyed/indexer API if credentials are supplied. |

## Value-moving branch coverage

No contract or user-fund value-moving branch exists in this track. Proof submission is the externally verifiable action.

| Branch / path | Test | Target-network transaction | Status |
| --- | --- | --- | --- |
| Valid condition → APPROVE + proof | `tests/policy.test.ts`, `tests/prover.test.ts` | Pending official practice | test only |
| VK substitution → REJECT + proof | `tests/policy.test.ts`, `tests/prover.test.ts` | Pending official practice | test only |
| Threshold mismatch → REJECT + proof | `tests/policy.test.ts`, `tests/prover.test.ts` | Pending official practice | test only |
| Expired condition → REJECT + proof | `tests/policy.test.ts`, `tests/prover.test.ts` | Pending official practice | test only |
| Recipient mismatch → REJECT + proof | `tests/policy.test.ts`, `tests/prover.test.ts` | Pending official practice | test only |
| Amount overflow → REJECT + proof | `tests/policy.test.ts`, `tests/prover.test.ts` | Pending official practice | test only |
| Proof reused → REJECT without proof | `tests/policy.test.ts`, integration fixture | Pending official practice | test only |

## State transition table

| From | Action | To | Actor | Notes and unexpected-ordering behavior |
| --- | --- | --- | --- | --- |
| New task | Authenticate raw body, validate, claim task ID | `PROCESSING` | Agent | Invalid HMAC never reaches the parser or database. |
| `PROCESSING` | Evaluate all policy rules | `DECIDED` | Agent | A platform retry waits for and receives the same signed bytes. |
| `DECIDED` | Generate and locally verify proof when provable | `PROOF_READY` | Agent | `PROOF_REUSED` intentionally has no circuit proof. |
| `PROOF_READY` | Submit to Kurier and poll | `FINALIZED` or `SUBMITTED` | Kurier | Finalization failure never changes the deterministic decision. |
| `PROCESSING` | Unhandled error | `FAILED` | Agent | A retry may reclaim the task; the first task retains proof-reference ownership. |
| `FAILED` | Platform retry | `PROCESSING` | Agent | Same task ID, same proof-reference owner, no false replay. |

## Claims registry

`docs/CLAIMS.md` is the source for factual numbers. Values must be generated rather than transcribed.

| Claim | Value | Source of truth | Verification command | Verified on |
| --- | --- | --- | --- | --- |
| Official registered Groth16 key | `0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0` | https://agentgames.zkverify.io/api/circuit-info | `npm run circuit:info` | 2026-11-15 |
| Official circuit SHA-256 values | See `artifacts/circuit/checksums.txt` | Official downloaded artifacts | `npm run circuit:verify` | 2026-11-15 |

## Software surface

| Item | Value |
| --- | --- |
| Surface type (CLI, SDK, API) | HTTPS API + operational web dashboard |
| Command or endpoint | `POST /agent`; `GET /health`; dashboard API under `/api/*` (`/api/summary`, `/api/tasks`, `/api/task?task_id=…`, `/api/proofs`) |
| Required environment | `AGENT_GAMES_HMAC_SECRET`, `DATABASE_URL`; `KURIER_API_KEY` for mainnet finalization evidence |
| Output that proves it works | Signed preflight; decision response; Groth16 proof; 13 public signals; local verification result; Kurier job/finalization metadata |
| How the output is checked against the chain or service | `snarkjs.groth16.verify` locally and Kurier `Finalized` status when configured |
| Clean-checkout run confirmed | `npm ci && npm run circuit:prepare && npm test && npm run build` passes on Node 24 |

## Evidence table

| Step | Actor | Transaction | Link | Observed result |
| --- | --- | --- | --- | --- |
| Official artifact download | Builder | Not applicable | https://agentgames.zkverify.io/api/circuit-info | WASM and ZKEY SHA-256 values verified |
| Local proof test | Builder | Not applicable | `npm run test:proof` | Groth16 proof generated and locally verified against the exported official key |
| Live deployment probe | Builder | Not applicable | `npm run claims -- --live https://veridun-oxunify.vercel.app` | `/` 200 HTML; `/health` 200 JSON with `database=ready`; `/api/summary`, `/api/tasks`, `/api/proofs` 200 JSON; `POST /agent` unsigned → signed 401 `INVALID_SIGNATURE` |
| Concurrency and latency benchmark | Builder | Not applicable | `npm run benchmark` → `docs/benchmarks/concurrency-and-latency.json` | 8 concurrent deliveries of one task ID → 1 stored response, 1 proof generation, identical bytes and signatures; full-path latency recorded against the 55-second budget; replay rejected as `PROOF_REUSED` |
| Signed preflight against the live deployment | User/operator | Not applicable | `npm run preflight -- https://veridun-oxunify.vercel.app <agent-id>` | Pending operator secret and agent id |
| Official practice task | User/operator | Pending | Agent Games dashboard | Pending account/session |

## Pre-submission gate results

| Gate | Result | Note |
| --- | --- | --- |
| A1 on-chain runtime equals committed artifact | N/A | No custom contract; official circuit checksums are the artifact identity. |
| A2 verification script exits zero against live deployment | Pass | `npm run claims -- --live https://veridun-oxunify.vercel.app` records HTTP 200 on every read endpoint and a signed 401 on an unsigned `POST /agent`. |
| A3 one toolchain and configuration for test, build, deploy | Pass | Root npm workspace; CI and Vercel both run Node 24; the same TypeScript sources build the API and the dashboard. |
| A4 suite re-run against the deployed configuration | Pass | `npm test` re-run on 2026-11-17 after the benchmark work: 59 passed, 1 skipped (the live zkVerify test is opt-in). |
| A5 no required form field empty | Partial | Live URL, repository URL, and revision are filled; the example transaction hash and explorer link remain open until a practice round finalizes a Kurier proof. |
| A6 video public and shows the required build and transaction | Pending | Optional for this track. |
| A7 every headline claim enforced | Pass locally | See headline claim table. |
| A8 every value-moving branch has a test and a status | Pass locally | Seven decision branches are covered; statuses are explicit. |
| A9 every factual number comes from the claims registry | Pass | `docs/CLAIMS.md` is generated by `npm run claims`; runtime metrics are queried from PostgreSQL, not hard-coded. |
| A10 every evidence link opens and shows what it claims | Pass | Official circuit endpoint and the live deployment were fetched unauthenticated on 2026-11-17; the probe is regenerated into `docs/CLAIMS.md`. |
| A11 software surface runs from a clean checkout | Pass | `npm ci`, circuit preparation, tests, and build all pass on a clean dependency tree. |
| A12 network labels correct everywhere | Pass | Mainnet is explicit for the event circuit and Kurier endpoint. |

## Competitive field

| Item | Value |
| --- | --- |
| Entries in the field, and how winners were decided | A broad GitHub search returned approximately 184 zkVerify Agent Games repositories. Proof Gatekeeper uses deterministic task scoring; no winner was available for this round at build time. |
| Prior winners inspected, with links | No prior Proof Gatekeeper winner repository was published in the reviewed material. Structural references: https://github.com/chandrabosep/agent-games, https://github.com/Unyiel37/agent-games-proof-gatekeeper, https://github.com/bagas8888/agent-games-gatekeeper, https://github.com/zeusx0109/zkverify-proof-gatekeeper. |
| Axes where winners were a near-universal subset (these decided the round) | Correct deterministic decisions, a valid local proof, signed raw-body protocol, and fast response. |
| Axes common across the whole field (these are noise) | “Agent” naming, Groth16 use, and a basic approve/reject endpoint. |
| Approach the field has converged on | Fastify/Express endpoint, snarkjs proof generation, hash-based VK comparison, and a local seen-set. |
| Open axis we will take | Durable evidence operations: transactional task claiming, exact replay of signed responses, proof-attempt history, finalization telemetry, and an operator dashboard. |
| One sentence: on which axis do we beat the field? | Veridun makes every scored task reproducible and auditable after the response, rather than only returning a one-shot decision. |
| Structures taken from prior winners (proof page, proof endpoint, capability table, published package) | The required proof endpoint and raw-body HMAC protocol only; these are event requirements. |
| Ideas, designs, interfaces, or copy we did not take | No competitor repository, UI, naming, or prose was copied. Public protocol facts were independently verified. |

## Deployment and cost

| Item | Value |
| --- | --- |
| Deployment target and plan | Vercel project `veridun`, connected to `https://github.com/unifyWeb3/veridun` for automatic deploys on `main`. Static dashboard plus one catch-all serverless function (60 s max duration, 2048 MB). PostgreSQL is Neon through the Vercel Marketplace integration. |
| Public URL and subdomain | `https://veridun.vercel.app`, `https://veridun-oxunify.vercel.app`, `https://veridun-git-main-oxunify.vercel.app` |
| Verified limits that matter for this build | Required: public HTTPS, no cold sleep, persistent PostgreSQL, at least 60-second request handling with a 55-second internal budget, and enough CPU for a roughly one-second Groth16 proof. The function is pinned to Node 24.x. |
| Restriction that could bite (commercial use, build caps, timeouts) | Serverless CPU/runtime limits can interrupt proof generation; the function therefore enforces a 55-second internal budget and returns a signed rejection instead of timing out. |
| Recurring cost and who pays | The user pays. Vercel and Neon free tiers cover this workload; no sponsor allowance is documented. |
| Sponsor allowance, if any, source, expiry, how to claim | None documented. |
| Environment variables and where their values come from | `AGENT_GAMES_HMAC_SECRET` from Agent Games → Rotate Secret; `KURIER_API_KEY` from kurier.xyz; `DATABASE_URL` from the Neon Marketplace integration; the remaining configuration values are set in the project settings. |
| Verified how, and on what date | Protocol facts verified 2026-11-15; hosting and runtime verified against the live deployment on 2026-11-17. |

## Benchmark and gap routing

The event publishes point deltas, not percentage weights. The default benchmark below is used only for internal prioritization and is not an event score. The full audit, including the comparison against the reference products, is in `docs/AUDIT.md`.

| Dimension | Weight used | Score | Citation that earns it |
| --- | ---: | ---: | --- |
| Impact on the user | 30 | 22 | Live service answering every endpoint; durable idempotency and replay ownership; seven ordered deterministic checks. Unproven at competition scale: no official practice task yet. |
| Technical execution | 20 | 20 | 59 passing tests, clean typecheck and build, checksum-verified official circuit, live signed dispatch through Fastify's Node HTTP handler, 8-check receipt verification, and a measured concurrency and latency benchmark against a real PostgreSQL server. The two incidents found during the build are fixed and covered by tests. |
| Innovation | 15 | 12 | The proof is the audit trail; the circuit-input mapping is shared between prover and verifier; `GET /api/receipt` turns one decision into a portable, re-verifiable artifact with a counterfactual. |
| Demo and evidence | 15 | 9 | Generated claims registry, unauthenticated live probe, browser-verified dashboard, committed sample receipt that re-verifies offline. No scored task, no example transaction, no video yet. |
| Product and UX | 10 | 7 | Real operations console: evidence chain, ordered policy checks, filters, proof ledger, task receipt panel, responsive at 1440 px and 390 px, honest empty states. Never operated with real traffic. |
| Sponsor technology use | 10 | 7 | zkVerify mainnet circuit and RPC/Subscan finality verification, Kurier mainnet submission path, official event registration endpoint. No Kurier job observed finalizing yet. |
| **Total** | **100** | **77** | Every sub-score is cited above and in `docs/AUDIT.md`; this is a pre-practice estimate, not a platform result. |

| Gap | Lever that closes it | Cost in time | Applied? | Score delta |
| --- | --- | ---: | --- | ---: |
| No official practice task, no example transaction, empty dashboard | Register the agent, rotate the secret, run the signed preflight, run one practice task, publish the receipt and transaction | 1–2 h operator time | No — needs the operator account | +15 (demo and evidence) |
| Decisions do not state what an incorrect approval would have released | Receipt counterfactual: the withheld amount, recipient, and the single check that stopped it | 2 h | **Applied** (`src/agent/counterfactual.ts`, `GET /api/receipt`) | +7 (impact) |
| No independent re-verification surface | `npm run receipt:verify`: policy replay, public-signal check, Groth16 verification, HMAC check, counterfactual recomputation | 2 h | **Applied** | +2 (innovation) |
| No concurrency or latency evidence | Run parallel deliveries of one task ID and a latency benchmark against the 55-second budget, and record the output in `docs/CLAIMS.md` | 1–2 h | **Applied** (`npm run benchmark`, `tests/concurrency.test.ts`) | +3 (technical execution) |
| No guided judge tour | One route that walks overview → task → receipt → proof ledger → local re-verification command | 2–3 h | No | +2 (product and UX) |
| No observed Kurier finalization | One practice task with `PROOF_SUBMIT_ENABLED=true` and a funded key; publish job id, transaction hash, and block | 1 h operator time | No | +2 (sponsor technology) |

Deliberately left undone, and why:

- A custom contract or circuit: the official registered circuit is the event referee and must not be replaced.
- A model in the decision path: it would make the decision non-deterministic.
- Synthetic dashboard activity: empty states stay empty until real tasks arrive.
- Registration, secret rotation, and submission form: user-managed actions that require the operator session.

## Open questions

Anything unresolved that could change scope, cost, permission, or the outcome.

| Question | Owner | Needed by | Status |
| --- | --- | --- | --- |
| What is the exact public task-ID form in scored rounds, and which field encoding does the platform expect? | Builder + official practice | Before first scored round | Open; configurable encodings implemented, `auto` selected |
| Does the platform expect `proof_tx` to echo the incoming proof or point to our Kurier proof? | Builder + official practice | Before first scored round | Open; incoming reference is retained while our finalization is stored separately |
| What are the Agent Games dashboard account, agent id, and the rotated HMAC secret? | User | Before registration and practice | Open — the live deployment already has a secret set; the operator must confirm it matches the rotated value |
