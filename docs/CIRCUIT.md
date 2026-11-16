# Circuit notes and evidence

## Official artifacts

| Artifact | SHA-256 |
| --- | --- |
| `gatekeeper.wasm` | `be00aefe3c8ba910951a242f50e55937bf82a0375ad4b69c2ef10629ab92764f` |
| `gatekeeper_final.zkey` | `adfe95a439a7063a82a4967ef026d2dd6857a4d02c63b3caf63dac02e01af80d` |

Registered mainnet verification-key hash:

`0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0`

`scripts/prepare-circuit.sh` downloads both artifacts, verifies these hashes, and exports the verification key used by local proof checks.

## Recovered interface

The official artifact is a Circom 2.x Groth16/BN128 circuit with 647 variables, 13 public inputs plus one output, and 13 public signals in the response.

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

## Salt

The salt is private. Veridun derives it deterministically from the task ID and request digest so a retry can reproduce the same witness inputs, while the Groth16 prover still produces a fresh proof. The salt is never included in a response or log.
