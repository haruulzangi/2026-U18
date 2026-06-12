#!/usr/bin/env node --disallow-code-generation-from-strings --disable-proto=delete
import util from "node:util";
import { runInNewContext } from "node:vm";
import { setTimeout as sleep } from "node:timers/promises";

function createVmExecutableCode(code: string) {
  return [
    // prevent prototype manipulation
    "Object.getPrototypeOf = () => ({})",
    "Reflect.getPrototypeOf = () => ({})",
    "Object.setPrototypeOf = () => false",
    "Reflect.setPrototypeOf = () => false",
    "Object.freeze(Promise.prototype)",
    "Object.seal(Promise.prototype)",

    // prevent Error.prepareStackTrace RCE attack BEFORE disabling defineProperty
    // This V8 API allows accessing the real global object via stack frame's getThis()
    "delete Error.prepareStackTrace",
    "delete Error.captureStackTrace",
    'Object.defineProperty(Error, "prepareStackTrace", { configurable: false, writable: false, value: undefined })',
    'Object.defineProperty(Error, "captureStackTrace", { configurable: false, writable: false, value: undefined })',

    // prevent defineProperty attacks (used to bypass sandbox via Error.prepareStackTrace)
    // Must come AFTER we've locked down Error properties above
    "Object.defineProperty = () => ({})",
    "Object.defineProperties = () => ({})",

    // wrap user code
    `((async function VmCodeWrapper() {${code}\n})())`,
  ].join("; ");
}

export async function evaluate(code: string) {
  let flag_value: string = "haha, not yet 😜";

  const result = runInNewContext(
    createVmExecutableCode(code),
    { get_flag: () => flag_value },
    {
      timeout: 100,
      microtaskMode: "afterEvaluate",
    },
  );
  await sleep(150);
  flag_value = process.env.FLAG!;

  return await new Promise((resolve, reject) =>
    result.then(resolve).catch(reject),
  )
    .then((result) => ({ status: "ok", result }) as const)
    .catch(
      (error) =>
        ({
          status: "error",
          message: Error.isError(error) ? error.message : "halp 🥺",
        }) as const,
    );
}

function sanitizeResult({
  value,
  maxDepth = 0,
}: {
  value: Record<string, unknown>;
  maxDepth?: number;
}): unknown {
  if (typeof value !== "object") {
    return typeof value !== "function" ? value : null;
  }
  if (util.types.isProxy(value)) {
    return null;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.value) {
      // Nah, not here, do better.
      continue;
    }
    if (typeof descriptor.value === "object") {
      if (maxDepth > 0) {
        result[key] = sanitizeResult({
          value: descriptor.value as Record<string, unknown>,
          maxDepth: maxDepth - 1,
        });
      }
      continue;
    }
    if (typeof descriptor.value === "function") {
      // Why would you do that?
      continue;
    }
    result[key] = descriptor.value;
  }
  return result;
}

const sendResult = process.send
  ? process.send.bind(process)
  : (result: unknown) => console.log(JSON.stringify(result));
const errorHandler = (err: unknown) => {
  sendResult({
    status: "error",
    message: Error.isError(err) ? err.message : "what's going on here 😵‍💫",
  });
  process.exit(0);
};
process.on("uncaughtException", errorHandler);
process.on("unhandledRejection", errorHandler);

if (!process.connected && process.argv.length < 3) {
  console.error(
    "How nice of you to run me directly! Please provide code as the first argument.",
  );
  console.error('Example: ./sandbox.js "return 1 + 1;"');
  process.exit(1);
}
const code =
  process.argv[2] ??
  (await new Promise((resolve) => process.once("message", resolve)));
const outcome = sanitizeResult({
  value: await evaluate(code),
  maxDepth: 2,
});
sendResult(outcome);
