import express, { type Express } from "express";
import cors from "cors";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402ExactEvmErc7710ServerScheme } from "@metamask/x402";
import { FACILITATOR_BASE_SEPOLIA } from "@briefcase/chain";
import { intelRouter } from "./intel.js";

export interface BuildAppOptions {
  payTo: `0x${string}`;
  facilitatorUrl?: string;
}

export function buildApp(opts: BuildAppOptions): Express {
  const app = express();
  app.use(cors({ exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"] }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  const facilitator = new HTTPFacilitatorClient({
    url: opts.facilitatorUrl ?? FACILITATOR_BASE_SEPOLIA,
  });
  const resourceServer = new x402ResourceServer(facilitator).register(
    "eip155:84532",
    new x402ExactEvmErc7710ServerScheme(),
  );

  app.use(
    paymentMiddleware(
      {
        "GET /api/intel/:topic": {
          accepts: [
            {
              scheme: "exact",
              price: "$0.01",
              network: "eip155:84532",
              payTo: opts.payTo,
              extra: { assetTransferMethod: "erc7710" },
            },
          ],
          description: "Premium intel feed",
          mimeType: "application/json",
        },
      },
      resourceServer,
    ),
  );

  app.use(intelRouter);
  return app;
}

// Boot only when run directly (not when imported by tests).
const entry = process.argv[1] ?? "";
if (entry.endsWith("index.ts") || entry.endsWith("index.js")) {
  const payTo = process.env.SERVER_PAYTO as `0x${string}` | undefined;
  if (!payTo) throw new Error("SERVER_PAYTO required");
  const port = Number(process.env.PORT ?? 4021);
  buildApp({ payTo }).listen(port, () => {
    console.log(`intel API listening on :${port}`);
  });
}
