import { randomBytes } from "node:crypto";
import { bytesToHex, type Hex } from "viem";
import {
  createDelegation,
  ScopeType,
  CaveatType,
  type Caveats,
  type Delegation,
  type SmartAccountsEnvironment,
} from "@metamask/smart-accounts-kit";
import { hashDelegation } from "@metamask/smart-accounts-kit/utils";

/** Stable identifier for a delegation (UI/event correlation). */
export function delegationId(delegation: Delegation): Hex {
  return hashDelegation(delegation);
}

export interface SliceRequest {
  name: string;
  amount: bigint;
}
export interface SlicePlan extends SliceRequest {
  salt: Hex;
}

/** Validate a budget split and assign fresh random salts (replay protection). */
export function planSlices(parentBudget: bigint, slices: SliceRequest[]): SlicePlan[] {
  if (slices.length === 0) throw new Error("slices must be non-empty");
  for (const s of slices) {
    if (s.amount <= 0n) throw new Error(`slice "${s.name}" has non-positive amount ${s.amount}`);
  }
  const total = slices.reduce((sum, s) => sum + s.amount, 0n);
  if (total > parentBudget) {
    throw new Error(`slice total ${total} exceeds parent budget ${parentBudget}`);
  }
  return slices.map((s) => ({ ...s, salt: bytesToHex(randomBytes(32)) }));
}

export interface BuildSliceArgs {
  from: { address: Hex; environment: SmartAccountsEnvironment };
  toAddress: Hex;
  tokenAddress: Hex;
  amount: bigint;
  salt: Hex;
  /**
   * Validity window in seconds from now (timestamp caveat). SECURITY: without
   * this, a signed delegation remains exercisable forever until revoked.
   */
  expirySeconds?: number;
  /** Signed parent delegation — present when chaining from another delegation. */
  parentDelegation?: Delegation | Hex;
  /** 7715 permission context — present when the slice spends a user's grant. */
  parentPermissionContext?: Hex;
}

type CreateDelegationArgs = Parameters<typeof createDelegation>[0];

/** Build an (unsigned) ERC20-capped, time-boxed redelegation. */
export function buildSliceDelegation(a: BuildSliceArgs): Delegation {
  if (a.parentDelegation && a.parentPermissionContext) {
    throw new Error("parentDelegation and parentPermissionContext are mutually exclusive");
  }
  const caveats: Caveats | undefined = a.expirySeconds
    ? [
        {
          type: CaveatType.Timestamp,
          afterThreshold: 0,
          beforeThreshold: Math.floor(Date.now() / 1000) + a.expirySeconds,
        },
      ]
    : undefined;

  const args = {
    to: a.toAddress,
    from: a.from.address,
    environment: a.from.environment,
    salt: a.salt,
    scope: {
      type: ScopeType.Erc20TransferAmount,
      tokenAddress: a.tokenAddress,
      maxAmount: a.amount,
    },
    ...(caveats ? { caveats } : {}),
    ...(a.parentDelegation ? { parentDelegation: a.parentDelegation } : {}),
    ...(a.parentPermissionContext ? { parentPermissionContext: a.parentPermissionContext } : {}),
  } as CreateDelegationArgs;

  return createDelegation(args);
}
