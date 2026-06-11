import { randomBytes } from "node:crypto";
import { bytesToHex, type Hex } from "viem";
import {
  createDelegation,
  ScopeType,
  type Delegation,
  type SmartAccountsEnvironment,
} from "@metamask/smart-accounts-kit";

export interface SliceRequest {
  name: string;
  amount: bigint;
}
export interface SlicePlan extends SliceRequest {
  salt: Hex;
}

/** Validate a budget split and assign fresh random salts (replay protection). */
export function planSlices(parentBudget: bigint, slices: SliceRequest[]): SlicePlan[] {
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
  /** Signed parent delegation — present when chaining from another delegation. */
  parentDelegation?: Delegation | Hex;
  /** 7715 permission context — present when the slice spends a user's grant. */
  parentPermissionContext?: Hex;
}

/** Build an (unsigned) ERC20-capped redelegation from Chief to one specialist. */
export function buildSliceDelegation(a: BuildSliceArgs): Delegation {
  if (a.parentDelegation && a.parentPermissionContext) {
    throw new Error("parentDelegation and parentPermissionContext are mutually exclusive");
  }
  const base = {
    to: a.toAddress,
    from: a.from.address,
    environment: a.from.environment,
    salt: a.salt,
  };
  const scope = {
    type: ScopeType.Erc20TransferAmount,
    tokenAddress: a.tokenAddress,
    maxAmount: a.amount,
  } as const;

  if (a.parentDelegation) {
    return createDelegation({ ...base, scope, parentDelegation: a.parentDelegation });
  }
  if (a.parentPermissionContext) {
    return createDelegation({
      ...base,
      scope,
      parentPermissionContext: a.parentPermissionContext as never,
    });
  }
  return createDelegation({ ...base, scope });
}
