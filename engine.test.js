// Regression test: Diego Gobbi's official card, 24 Aug 2026 (842 counting / 12 played / divisor 11 / 76.55 avg / #100).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DATA } from "./data.js";
import { pointsFor, scenario, autoPerf, dnum } from "./engine.js";

const diego = JSON.parse(fs.readFileSync(new URL("./diego-gobbi.example.json", import.meta.url)));

test("Diego's history reproduces his official ranking card", () => {
  // Pinned to the card's own date: results expire on a rolling window, so an
  // unpinned test would start failing the day the oldest result drops out.
  const items = diego.played.map(h => ({ d: dnum(h.date), pts: pointsFor(h, diego.perf), incl: true }));
  const s = scenario(items, DATA.rankings, dnum(diego.card.date));
  assert.equal(s.total, 842);
  assert.equal(s.played, 12);
  assert.equal(s.divisor, 11);
  assert.equal(Math.round(s.avg * 100) / 100, 76.55);
  assert.equal(s.rank, 100);
});

test("points precedence: exact beats range beats expected round", () => {
  const perf = { Gold: "17/32 (32)" };
  assert.equal(pointsFor({ size: "Gold" }, perf), 165);
  assert.equal(pointsFor({ size: "Gold", rfrom: "5/8 (8)", rto: "W (1)" }, perf), 1035);
  assert.equal(pointsFor({ size: "Gold", exact: "RU (2)", rfrom: "3/4 (4)", rto: "W (1)" }, perf), 1170);
  assert.equal(pointsFor({ size: "Copper", exact: "33/64 (64)" }, perf), 0);
});

test("divisor and expected-round derivation", () => {
  assert.deepEqual(autoPerf(76.55)["Challenger 6"], "3/4 (4)");
  assert.deepEqual(autoPerf(76.55)["Bronze"], "17/32 (32)");
  assert.deepEqual(autoPerf(76.55)["Diamond"], "33/64 (64)");
});
