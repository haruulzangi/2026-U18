#!/usr/bin/env node
import express from "express";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";

function generateFlag(template: string): string {
  const seen = new Map<string, string>();
  return template.replace(/\$\d+/g, (placeholder) => {
    if (!seen.has(placeholder)) {
      seen.set(placeholder, randomBytes(8).toString("base64url"));
    }
    return seen.get(placeholder)!;
  });
}

export async function invokeSandbox(code: string) {
  const sandboxProcess = fork("./sandbox.ts", {
    timeout: 1000,
    execArgv: [
      "--disallow-code-generation-from-strings",
      "--disable-proto=delete",
    ],
    env: { FLAG: generateFlag(process.env.FLAG ?? "") },
  });
  sandboxProcess.send(code);
  const result = await Promise.race([
    new Promise((resolve) =>
      sandboxProcess.once("message", (message) => resolve(message)),
    ),
    new Promise((resolve) =>
      sandboxProcess.once("exit", (code) =>
        resolve({
          status: "error",
          message: code !== 0 ? "timeout 😤" : "nothing happened 😭",
        }),
      ),
    ),
  ]);
  return result;
}
function main() {
  if (!process.env.FLAG) {
    throw new Error("FLAG environment variable must be set");
  }
  const app = express();
  app.use(express.json());
  app.use(express.static("public"));

  app.post("/evaluate", async (req, res) => {
    const code = req.body.code;
    if (typeof code !== "string" || code.length > 200) {
      return res
        .status(400)
        .json({ status: "error", error: "Invalid code submission" });
    }

    const result = await invokeSandbox(code);
    res.json(result);
  });

  const server = app.listen(
    parseInt(process.env.PORT ?? "3000") || 3000,
    process.env.HOST ?? "::",
    (err) => {
      const addr = server.address();
      if (err || !addr) {
        console.error("Failed to start server:", err);
        process.exit(1);
      }
      if (typeof addr === "string") {
        console.log(`Server is running on http://${addr}`);
        return;
      }
      console.log(
        `Server is running on http://${
          addr.family === "IPv6" ? `[${addr.address}]` : addr.address
        }:${addr.port}`,
      );
    },
  );
}
if (process.env.NODE_ENV !== "test") {
  main();
}
