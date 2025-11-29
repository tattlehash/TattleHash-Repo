export type ReceiptMode = "pending" | "confirmed" | "anchored";
export interface Receipt {
  id: string;
  mode: ReceiptMode;
  initiatorCommit?: string;
  txHash?: string;
  receivedAt: number;
  policyVersion: string;
}

import { Env } from "../types";

export function makeReceipt(env: Env, initiatorCommit?: string): Receipt {
  return {
    id: crypto.randomUUID(),
    mode: "pending",
    initiatorCommit,
    receivedAt: Date.now(),
    policyVersion: env.POLICY_VERSION || "shield-v1",
  };
}
