# Circuit notes and evidence

## Official artifacts

The authoritative digests, byte lengths, registered VK hash, and verification-key
properties are generated into [`CLAIMS.md`](CLAIMS.md) by `npm run claims`. That
file is the single source of truth; the values are not transcribed here.

`scripts/prepare-circuit.mjs` downloads both official artifacts, verifies their
SHA-256 digests, and exports the verification key used by local proof checks.
`npm run circuit:verify` re-checks the same identities, and `npm run
circuit:info` re-reads the registered VK hash from the official endpoint and
fails if it changed.

The circuit is Circom 2.x Groth16/BN128 with 13 public inputs plus one output,
and 13 public signals in the response.

## Recovered interface

The official artifact is a Circom 2.x Groth16/BN128 circuit whose proving key
reports 647 variables and 13 public inputs. The response carries 13 public
signals.

Input names recovered by independent probes of the WASM signal map:

```text
registeredVkHash
proofVkHash
minimum
publicBalance
expiryBlock
currentBlock
recipient
conditionRecipient
amount
maxTransfer
decision
taskId
salt             (private)
```

Expected public-signal order:

```text
0  commitment
1  registeredVkHash
2  proofVkHash
3  minimum
4  publicBalance
5  expiryBlock
6  currentBlock
7  recipient
8  conditionRecipient
9  amount
10 maxTransfer
11 decision
12 taskId
```

## Policy semantics enforced by the circuit

The circuit's `decision` input must equal the conjunction of the five circuit-visible policy groups:

- registered VK equals proof VK;
- public balance is at least the minimum;
- current block is below expiry block;
- recipient equals condition recipient;
- amount does not exceed max transfer.

Therefore:

- all checks passing and `decision=1` is provable;
- a failed circuit-visible check and `decision=0` is provable;
- forcing `decision=1` on a trap fails witness generation;
- replay is external state, so a `PROOF_REUSED` decision has no valid proof because all circuit-visible checks still pass.

## Field conversions

| Task value | Circuit field |
| --- | --- |
| decimal integer | exact decimal integer |
| `0x` address | integer value of the 20-byte address |
| VK hash | integer value reduced modulo the BN128 scalar field |
| decision | `1` for APPROVE, `0` for REJECT |
| task ID with UUID suffix | integer value of the UUID hex suffix |
| task ID without UUID suffix | configurable: SHA-256, Keccak-256, or auto fallback |

The task-ID conversion is the only materially undocumented part of the official protocol. `auto` uses a UUID suffix when present and SHA-256 otherwise. Official practice mode is the acceptance test; `docs/EVENT-RULES.md` keeps this as an open gate.

## Deployment of the artifacts

`npm run circuit:prepare` runs as the first step of the Vercel build
(`buildCommand: npm run build:vercel`). It downloads the official artifacts into
`artifacts/circuit/`, verifies their checksums, and exports
`gatekeeper_vkey.json`. `vercel.json` bundles `artifacts/circuit/**` into the
serverless function with `includeFiles`, so the deployed function can prove
without network access.

## Salt

The salt is private. Veridun derives it deterministically from the task ID and request digest so a retry can reproduce the same witness inputs, while the Groth16 prover still produces a fresh proof. The salt is never included in a response or log.
