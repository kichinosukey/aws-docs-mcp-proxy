import test from "node:test";
import assert from "node:assert/strict";
import { timed } from "../src/timing.js";

test("timed returns value and non-negative ms", async () => {
  const { value, ms } = await timed(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return "ok";
  });
  assert.equal(value, "ok");
  assert.ok(ms >= 0);
});
