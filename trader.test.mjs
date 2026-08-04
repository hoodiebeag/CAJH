import assert from "node:assert/strict";
import test from "node:test";
import { parseConfirmedSell } from "./trader.js";

test("confirmed full sell returns only terminal executed volume", () => {
  assert.deepEqual(parseConfirmedSell({ status: "closed", vol_exec: "2.5", price: "101" }, 2.5), {
    volume: 2.5, price: 101, fee: 0
  });
});

test("confirmed partial sell returns the exact executed remainder basis", () => {
  const fill = parseConfirmedSell({ status: "closed", vol_exec: "0.4", price: "101", fee: "0.02" }, 1);
  assert.deepEqual(fill, { volume: 0.4, price: 101, fee: 0.02 });
});

test("non-terminal or invalid sell results cannot be treated as fills", () => {
  for (const order of [
    { status: "open", vol_exec: "1", price: "101" },
    { status: "canceled", vol_exec: "1", price: "101" },
    { status: "closed", vol_exec: "0", price: "101" },
    { status: "closed", vol_exec: "1", price: "0" }
  ]) {
    assert.throws(() => parseConfirmedSell(order, 1));
  }
});
