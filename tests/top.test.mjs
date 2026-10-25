import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, topTalkers, topLimit, usagePct, heatLevel } from "../dist/lan-topo-card.js";

const port = (name, tx, rx, extra = {}) => ({ name, linked: true, speedMbps: 1000, txBps: tx, rxBps: rx, ...extra });
const topo = normalizeConfig({
  nodes: [
    { id: "ccr", name: "CCR2004", port_names: { ether10: { name: "Camera", icon: "mdi:cctv" } } },
    { id: "crs326", name: "CRS326", port_names: { ether24: false } },
  ],
  edges: [{ from: "ccr", to: "crs326", from_port: "sfp-sfpplus2", to_port: "sfp-sfpplus1" }],
});
const portsByNode = new Map([
  ["ccr", [port("ether10", 0.2e6, 7e6), port("sfp-sfpplus2", 500e6, 10e6), port("ether11", 5e3, 1e3)]],
  ["crs326", [port("sfp-sfpplus1", 10e6, 500e6), port("ether11", 452e6, 9e6, { device: "PC1" }), port("ether12", 2e6, 0.4e6), port("ether24", 900e6, 0), port("ether9", 0, 0, { linked: false })]],
]);

test("topTalkers: xếp theo tổng ↓+↑, bỏ cổng nối, cổng ẩn, cổng rảnh, cổng không link", () => {
  const rows = topTalkers(topo, portsByNode, { limit: 5 });
  assert.deepEqual(rows.map((r) => `${r.nodeName}:${r.port.name}`), ["CRS326:ether11", "CCR2004:ether10", "CRS326:ether12"]);
  assert.equal(rows[0].name, "PC1"); // tên từ thuộc tính device
  assert.equal(rows[0].down, 452e6); // ↓ = tx của cổng switch (về phía thiết bị)
  assert.equal(rows[1].name, "Camera");
  assert.equal(rows[1].icon, "mdi:cctv");
  assert.equal(topTalkers(topo, portsByNode, { limit: 1 }).length, 1);
});

test("usagePct: log 10 kbps → 0, 1 Gbps → 100", () => {
  assert.equal(usagePct(0), 0);
  assert.equal(usagePct(1e4), 0);
  assert.equal(usagePct(1e6), 40);
  assert.equal(usagePct(1e9), 100);
  assert.equal(usagePct(1e11), 100);
});

test("heatLevel: ≥10 Mbps ấm, ≥50 Mbps nóng, tuỳ chỉnh được", () => {
  assert.equal(heatLevel(5e6), 0);
  assert.equal(heatLevel(12e6), 1);
  assert.equal(heatLevel(60e6), 2);
  assert.equal(heatLevel(60e6, { warmMbps: 100, hotMbps: 500 }), 0);
  assert.equal(heatLevel(null), 0);
});

test("topLimit: số dùng thẳng, true / bỏ trống / giá trị lạ → 5, false / 0 → ẩn", () => {
  assert.equal(topLimit(undefined), 5);
  assert.equal(topLimit(true), 5); // trước đây Number(true) = 1 → bảng chỉ còn 1 dòng
  assert.equal(topLimit(null), 5);
  assert.equal(topLimit("abc"), 5);
  assert.equal(topLimit(-3), 5);
  assert.equal(topLimit(8), 8);
  assert.equal(topLimit("3"), 3);
  assert.equal(topLimit(0), 0);
  assert.equal(topLimit(false), 0);
});
