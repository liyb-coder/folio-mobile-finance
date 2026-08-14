import { createDeepSeekProvider } from "./deepseek-provider.js";
import { createFolioBffServer } from "./server.js";

const apiKey = process.env.DEEPSEEK_API_KEY;
const provider = createDeepSeekProvider({
  apiKey,
  model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
});
const port = Number.parseInt(process.env.FOLIO_BFF_PORT || "8787", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("FOLIO_BFF_PORT is invalid.");
}
const allowedOrigins = (process.env.FOLIO_BFF_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const server = createFolioBffServer({
  configured: true,
  parseFinancialText: provider.parseFinancialText,
  ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Folio test BFF listening on http://127.0.0.1:${port}\n`);
  process.stdout.write("DeepSeek credential remains in the server process environment.\n");
});
