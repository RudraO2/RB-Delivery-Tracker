import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Development only: lets the browser preview (npm run dev) run real tracking checks by
// passing each request to tracking/worker.mjs with this computer's Node. The installed app
// never uses this; its Rust backend runs the bundled node.exe instead.
function trackingBridge(): Plugin {
  const worker = fileURLToPath(new URL("./tracking/worker.mjs", import.meta.url));
  const failure = (error: string) => ({ ok: false, kind: "transport", error, retry_after_ms: null });
  return {
    name: "rb-tracking-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__track", (req, res) => {
        const reply = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        // Only the preview page itself may ask; other websites open in the browser may not.
        const origin = req.headers.origin;
        if (req.method !== "POST" || (origin && new URL(origin).host !== req.headers.host)) return reply(403, failure("Not allowed."));
        let input = "";
        req.on("data", (chunk) => {
          input += chunk;
          if (input.length > 8192) req.destroy();
        });
        req.on("end", () => {
          const child = spawn(process.execPath, [worker], { stdio: ["pipe", "pipe", "ignore"] });
          let output = "";
          const timer = setTimeout(() => child.kill(), 90_000);
          child.stdout.on("data", (chunk) => (output += chunk));
          child.on("error", () => reply(502, failure("Could not start the tracking engine.")));
          child.on("close", (code) => {
            clearTimeout(timer);
            if (res.writableEnded) return;
            try {
              if (code !== 0) throw new Error();
              reply(200, JSON.parse(output));
            } catch {
              reply(502, failure("Tracking engine failed. Run npm run setup:tracking once."));
            }
          });
          child.stdin.end(input);
        });
      });
    },
  };
}

// base "./" so the built index.html loads its assets from file:// inside the desktop app (Tauri).
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), trackingBridge()],
  server: { port: 5173, strictPort: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
