declare module 'snarkjs' {
  export interface Groth16Proof {
    pi_a: [string, string, string];
    pi_b: [[string, string], [string, string], [string, string]];
    pi_c: [string, string, string];
    protocol: 'groth16';
    curve: 'bn128';
  }

  export interface ZKey {
    // zkey structure
  }

  export interface VerificationKey {
    protocol?: string;
    curve?: string;
    nPublic: number;
    IC: string[][];
    vk_alpha_1?: [string, string];
    vk_beta_2?: [[string, string], [string, string]];
    vk_gamma_2?: [[string, string], [string, string]];
    vk_delta_2?: [[string, string], [string, string]];
    [key: string]: unknown;
  }

  export namespace groth16 {
    export function fullProve(input: Record<string, unknown>, wasmPath: string, zkeyPath: string): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
    export function verify(vkey: VerificationKey, publicSignals: string[], proof: Groth16Proof): Promise<boolean>;
    export function exportSolidityVerifier(vkey: VerificationKey): string;
  }

  export namespace plonk {
    export function fullProve(input: Record<string, unknown>, wasmPath: string, zkeyPath: string): Promise<{ proof: unknown; publicSignals: string[] }>;
    export function verify(vkey: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  }

  export namespace zKey {
    export function exportVerificationKey(zkey: ZKey): Promise<VerificationKey>;
    export function newZKey(r1cs: unknown, ptau: string): Promise<ZKey>;
    export function contribute(zkey: ZKey, entropy: string): Promise<ZKey>;
    export function beacon(zkey: ZKey, beaconHash: string): Promise<ZKey>;
    export function verify(r1cs: unknown, ptau: string, zkey: ZKey): Promise<boolean>;
    export function verifyFromFile(r1csPath: string, ptauPath: string, zkeyPath: string): Promise<boolean>;
  }

  export namespace r1cs {
    export function fromFile(path: string): Promise<unknown>;
  }

  export namespace ptau {
    export function newPtau(power: number): Promise<string>;
    export function contribute(ptau: string, entropy: string): Promise<string>;
    export function beacon(ptau: string, beaconHash: string): Promise<string>;
  }

  export namespace powersOfTau {
    export function newPtau(power: number): Promise<string>;
    export function contribute(ptau: string, entropy: string): Promise<string>;
    export function beacon(ptau: string, beaconHash: string): Promise<string>;
    export function verify(ptau: string): Promise<boolean>;
  }
}