// «حساب من» opens each invoice on the ledger's own sheet («#view»): the server sends the saved invoice's printed parts only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sheetOf } from "../portal.mjs";

test("the sheet gets the saved inputs, gold, trade and transfer; never the purchase wage, product ids or the other party's id", () => {
  const s = sheetOf({ kind: "whole", doc: "pd", no: "15", date: "۱۴۰۵/۰۸/۱۰", vals: ["۱۴۰۵/۰۸/۱۰", "۱۵", 3], rows: 8, tax: "۰", gp: 78000000, rets: [1, "x"],
    disc2: ["", "۰٫۲۵", "100000"], rprev: ["۲۰۰۰۰۰۰", "cr"], deltaG: 8.4, partyId: "c1", upd: "2026", ver: 2,
    items: [{ desc: "النگو", costAj: 1.5, pid: "prod-77" }],
    gold: [{ type: "ab", weight: 2, purity: "740", lab: "", ang: "", note: "", g750: 1.97, src: "lot-9" }], goldDir: "dr",
    trade: { type: "sell", mode: "w", w: 1, gp: 78000000, amount: 78000000, note: "قسط اول", cin: 50000000, cout: 0, secret: 1 },
    hav: { partyId: "ab1", partyName: "آبشده‌فروش", w: 0.5, dir: "out" } });
  assert.deepEqual(s.vals, ["۱۴۰۵/۰۸/۱۰", "۱۵", "3"]);
  assert.deepEqual(s.rets, [1]);
  assert.deepEqual(s.hav, { partyId: "h", partyName: "آبشده‌فروش", w: 0.5, dir: "out" });
  assert.equal(s.trade.note, "قسط اول");
  assert.equal(s.goldDir, "dr");
  const raw = JSON.stringify(s);
  for (const secret of ["costAj", "prod-77", "ab1", "c1", "lot-9", "secret", "items", "deltaG"]) assert.ok(!raw.includes(secret), secret);
});
