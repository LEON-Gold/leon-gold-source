// The melt seller whose prices «خرید و فروش آبشده» shows and on whose site every approved trade is placed again, on
// the owner's own account (owner, 2026-11-16). Only this file talks to that seller.
//
// The key: MELT_API_KEY (and MELT_API_URL) live only in the server's environment on Liara. They are never stored in the
// database, never sent to a browser, never written to a log, never returned in an error. Every error that leaves this
// file is one of the fixed words below.
//
// Until the seller's API arrives, MELT_SUPPLIER=mock gives a stand-in with steady prices (and test switches); with no
// supplier set, prices are «not available» and nothing can be traded.
//
//   (the seller's app shows TOMAN; the real adapter converts: rial = toman × 10)
//   quote()  → { at, items: { m1: { bid, ask, ok }, ... } }   rial per unit (mithqal, gram, coin, bar); bid = what the
//              seller pays (a colleague's «فروش» mirrors to it), ask = what the seller charges (a colleague's «خرید»)
//   place({ k, side, qm, ref, price }) → { ok: true, ref, price } | { ok: false, err }   side as the colleague's:
//              "buy" = we buy from the seller; qm = quantity × 1000; ref = our order id, sent so a retry can never
//              place twice; price = the seller's price we expect
//   An answer that never comes throws: the trade's outcome is then unknown and must be checked by hand.

const ERR = new Set(["no_api", "unavailable", "price_moved", "rejected", "bad_answer", "timeout"]);
export const errWord = e => ERR.has(e) ? e : "rejected";

// ---------- the stand-in (its numbers: the seller's screen of 2026-11-16, toman × 10) ----------
const MOCK0 = { m1: [1059900000, 1061400000], m2: [1064200000, 1065400000], g18: [244725060, 245025150], c1: [2493000000, 2499000000],
  c2: [1292000000, 1304000000], c4: [693000000, 705000000], s1: [0, 0], s2: [0, 0] };
export const mock = { prices: JSON.parse(JSON.stringify(MOCK0)), fail: "", hang: false, placed: [], down: false };
export function mockReset() { mock.prices = JSON.parse(JSON.stringify(MOCK0)); mock.fail = ""; mock.hang = false; mock.placed = []; mock.down = false; }
const mockSupplier = {
  async quote() {
    if (mock.down) throw new Error("unavailable");
    const items = {};
    for (const [k, [bid, ask]] of Object.entries(mock.prices)) items[k] = { bid, ask, ok: bid > 0 && ask > 0 };
    return { at: Date.now(), items };
  },
  async place(o) {
    if (mock.hang) return new Promise(() => {});
    if (mock.placed.some(x => x.ref === o.ref)) return { ok: true, ref: "mock-" + o.ref, price: o.price, again: true };
    if (mock.fail) return { ok: false, err: mock.fail };
    mock.placed.push({ ...o });
    return { ok: true, ref: "mock-" + o.ref, price: o.price };
  },
};

// ---------- the real seller (filled in when its API and its documentation arrive) ----------
const realSupplier = (url, key) => ({
  async quote() { void url; void key; throw new Error("no_api"); },
  async place() { throw new Error("no_api"); },
});

const none = { async quote() { throw new Error("no_api"); }, async place() { return { ok: false, err: "no_api" }; } };

export function make(env = process.env) {
  const kind = String(env.MELT_SUPPLIER || "").trim();
  if (kind === "mock") return mockSupplier;
  if (kind === "live" && env.MELT_API_URL && env.MELT_API_KEY) return realSupplier(env.MELT_API_URL, env.MELT_API_KEY);
  return none;
}

// a call that must answer in time; past it, "timeout" (for place: the outcome is unknown)
export const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);
