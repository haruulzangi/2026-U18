import { beforeAll, describe, expect, it } from "vitest";

import { invokeSandbox } from "./index";

beforeAll(() => {
  process.env.FLAG = "HZU18{w0w_$1_you_w1n_$2}";
});

describe("evaluate function", () => {
  it("should return normal result for safe code", async () => {
    const code = `
			const a = 1 + 2;
			return a;
		`;
    const result = await invokeSandbox(code);
    expect(result).toMatchObject({ status: "ok", result: 3 });
  });
  it("should return an error if code throws", async () => {
    const code = `
			throw new Error("Test error");
		`;
    const result = await invokeSandbox(code);
    expect(result).toMatchObject({ status: "error", message: "Test error" });
  });

  it("should not allow code execution in the parent context", async () => {
    const code = `return this.constructor.constructor('return process')().toString()`;
    const result = await invokeSandbox(code);
    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining(
        "Code generation from strings disallowed for this context"
      ),
    });
  });
  it("should allow code execution in the VM context", async () => {
    const code = "return Function`return get_flag()`()";
    const result = await invokeSandbox(code);
    expect(result).toMatchObject({
      status: "ok",
      result: "haha, not yet 😜",
    });
  });

  it("should not allow returning Proxy objects", async () => {
    const code = `return new Proxy({}, {
  ownKeys() { return ["flag"]; },
  getOwnPropertyDescriptor(_t, _p) {
    return { value: get_flag(), enumerable: true, configurable: true, writable: true };
  },
});`;
    const result = await invokeSandbox(code);
    expect(result).toMatchObject({ status: "ok", result: null });
  });

  it("should ignore prototype pollution", async () => {
    const code = `const z = {}; Object.prototype.__defineGetter__("flag", function(){ this.pwn = get_flag(); return get_flag(); }); return z;`;
    const result = await invokeSandbox(code);
    expect(result).toMatchObject({ status: "ok", result: {} });
    expect(result).toHaveProperty("result");
    expect((result as any).result).not.toHaveProperty("pwn");
  });

  it("should prevent Promise.prototype modification", async () => {
    const code = `Promise.prototype.then=r=>(r(get_flag()),{catch(){}})`;
    const result = await invokeSandbox(code);
    expect(result).toMatchObject({ status: "ok" });
    expect(result).not.toHaveProperty("result");
  });

  it("should return flag when get_flag is called after timeout", async () => {
    const code = `
			return 0;
		}, result = {
			then: (resolve) => {
        resolve(get_flag());
				return {catch: () => {}};
      }
    },
    z = function VmCodeWrapper2() {
      return result
		`;
    const result = await invokeSandbox(code);
    expect(result).toMatchObject({ status: "ok" });
    expect((result as any).result).toMatch(/^HZU18\{w0w_.+_you_w1n_.+\}$/);
  });
});
