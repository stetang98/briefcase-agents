// Step 1 (FREE, read-only): discover Venice's x402 top-up payment requirements.
// No signing, no spending — just print what they ask for so we can verify
// amount/token/receiver before paying.
import "dotenv/config";

const res = await fetch("https://api.venice.ai/api/v1/x402/top-up", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});

console.log("status:", res.status);
console.log("--- headers ---");
for (const [k, v] of res.headers.entries()) {
  if (k.toLowerCase().includes("payment") || k.toLowerCase().includes("x402")) {
    console.log(`${k}: ${v.slice(0, 120)}${v.length > 120 ? "…" : ""}`);
  }
}
const body = await res.text();
console.log("--- body ---");
console.log(body.slice(0, 2000));

// If the requirements are in a base64 header, decode them too.
const header = res.headers.get("PAYMENT-REQUIRED") ?? res.headers.get("payment-required");
if (header) {
  console.log("--- decoded PAYMENT-REQUIRED ---");
  console.log(JSON.stringify(JSON.parse(Buffer.from(header, "base64").toString()), null, 2));
}
