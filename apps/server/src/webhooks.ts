import { Router, type Router as RouterType } from "express";
import { verifyWebhook, WebhookDeduper } from "@briefcase/chain";
import type { EventBus } from "./events.js";

type KeyProvider = () => Promise<Record<string, Uint8Array>>;

/**
 * 1Shot webhook receiver. Always 200s quickly (at-least-once delivery — never
 * make the relayer retry forever); invalid or duplicate events are dropped.
 * Event types: 4 = Submitted, 0 = Confirmed, 1 = Reverted.
 */
export function makeWebhookRouter(bus: EventBus, getKeys: KeyProvider): RouterType {
  const router = Router();
  const deduper = new WebhookDeduper();

  router.post("/webhooks/oneshot", async (req, res) => {
    // Verification is a fast local operation, so we do it before acking. We
    // always return 200 regardless of the outcome (at-least-once delivery —
    // never make the relayer retry a malformed/duplicate event forever).
    try {
      const event = req.body as {
        type?: number;
        keyId?: string;
        data?: { id?: string; status?: number; hash?: string; memo?: string };
      };
      const taskId = event?.data?.id;
      if (typeof taskId === "string") {
        const keys = await getKeys();
        if (
          (await verifyWebhook(event as Record<string, unknown>, keys)) &&
          deduper.admit(taskId, event.type ?? -1)
        ) {
          // memo convention: "job:<jobId>" links a settlement to its job
          const jobId = event.data?.memo?.startsWith("job:")
            ? event.data.memo.slice(4)
            : undefined;
          bus.publish({
            kind: "settlement.update",
            jobId,
            taskId,
            status: event.data?.status ?? 0,
            tx: event.data?.hash,
            webhookType: event.type,
          });
        }
      }
    } catch {
      // swallow — we still ack below
    }
    res.status(200).json({ ok: true });
  });

  return router;
}
