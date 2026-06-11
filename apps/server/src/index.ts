import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { isAddress, getAddress } from "viem";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402ExactEvmErc7710ServerScheme } from "@metamask/x402";
import { FACILITATOR_BASE_SEPOLIA } from "@briefcase/chain";
import { intelRouter } from "./intel.js";
import { EventBus, sseHandler } from "./events.js";
import { makeJobsRouter, type JobStore, type RunJobFn } from "./jobs.js";
import { makeWebhookRouter } from "./webhooks.js";

export interface BuildAppOptions {
  payTo: `0x${string}`;
  /** CAIP-2 network for payments (default Base Sepolia). */
  network?: `${string}:${string}`;
  facilitatorUrl?: string;
  /** Allowed CORS origins; defaults to permissive for the hackathon demo dapp. */
  corsOrigins?: string[] | boolean;
  /** Orchestrator that runs a research job; omit to disable the jobs API. */
  runJob?: RunJobFn;
  /** Ed25519 key provider for 1Shot webhook verification; omit to disable webhooks. */
  webhookKeys?: () => Promise<Record<string, Uint8Array>>;
}

export function buildApp(opts: BuildAppOptions): Express {
  if (!isAddress(opts.payTo)) {
    throw new Error("payTo must be a valid EVM address (0x + 40 hex chars)");
  }
  const payTo = getAddress(opts.payTo);
  const network = opts.network ?? "eip155:84532";

  const app = express();
  // CORP must be cross-origin: this API is consumed by the Vercel-hosted
  // dashboard from a different origin (helmet defaults to same-origin).
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: opts.corsOrigins ?? true,
      exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"],
    }),
  );
  app.use(
    rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }),
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // --- Free (un-paywalled) surfaces: events, jobs, webhooks ---
  const bus = new EventBus();
  app.get("/api/events", sseHandler(bus));
  if (opts.runJob || opts.webhookKeys) {
    app.use(express.json());
  }
  if (opts.runJob) {
    const store: JobStore = new Map();
    const jobLimiter = rateLimit({
      windowMs: 60_000,
      limit: 8,
      standardHeaders: true,
      legacyHeaders: false,
    });
    app.use(makeJobsRouter({ bus, store, runJob: opts.runJob, postLimiter: jobLimiter }));
  }
  if (opts.webhookKeys) {
    app.use(makeWebhookRouter(bus, opts.webhookKeys));
  }

  const facilitator = new HTTPFacilitatorClient({
    url: opts.facilitatorUrl ?? FACILITATOR_BASE_SEPOLIA,
  });
  const resourceServer = new x402ResourceServer(facilitator).register(
    network,
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
              network,
              payTo,
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

  // Final error handler: never leak stack traces to clients.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("unhandled error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}

// Boot only when run directly (not when imported by tests).
const entry = process.argv[1] ?? "";
if (entry.endsWith("index.ts") || entry.endsWith("index.js")) {
  const payTo = process.env.SERVER_PAYTO;
  if (!payTo || !isAddress(payTo)) {
    throw new Error("SERVER_PAYTO must be set to a valid EVM address");
  }
  const port = Number(process.env.PORT ?? 4021);
  const corsOrigins = process.env.CORS_ORIGINS?.split(",");
  if (!corsOrigins && process.env.NODE_ENV === "production") {
    console.warn("WARN: CORS_ORIGINS unset in production — all origins accepted (set CORS_ORIGINS=https://your-frontend.vercel.app)");
  }
  // Lazy import so the agents package isn't loaded in test/import paths.
  const { buildOrchestrator } = await import("./orchestrator.js");
  const runJob = buildOrchestrator() ?? undefined;
  buildApp({ payTo: getAddress(payTo), corsOrigins, runJob }).listen(port, () => {
    console.log(`Briefcase server on :${port}${runJob ? " (orchestrator live)" : " (intel API only)"}`);
  });
}
