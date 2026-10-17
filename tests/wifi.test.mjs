import { test } from "node:test";
import assert from "node:assert/strict";
import { signalBars, qualityColor, coChannel, groupClients, QUALITY_COLORS } from "../dist/lan-topo-card.js";

// Hình dạng thuộc tính của sensor aruba_instant_ha (đo 2026-10-18, tên/IP giả)
const clients = [
  { name: "Cam-T1-Imou-1", ip: "192.168.20.113", essid: "Ga", ap: "Aruba T1", band: "2.4", signal: 46, quality: "good", speed_mbps: 72 },
  { name: "iPhone", ip: "192.168.10.27", essid: "QuantumPulse", ap: "Aruba T2", band: "5", signal: 41, quality: "good", speed_mbps: 866 },
  { name: "espressif", ip: "192.168.20.16", essid: "Ga", ap: "Aruba T2", band: "2.4", signal: 12, quality: "poor", speed_mbps: 6 },
  { name: "SL-T1-Bep", ip: "192.168.20.69", essid: "Ga", ap: "Aruba T1", band: "2.4", signal: 17, quality: "ok", speed_mbps: 52 },
];
const aps = {
  "Aruba T1": { radios: [{ band: "5", channel: "44+" }, { band: "2.4", channel: "6" }] },
  "Aruba T2": { radios: [{ band: "5", channel: "100E" }, { band: "2.4", channel: "1" }] },
  "Aruba T3": { radios: [{ band: "5", channel: "52E" }, { band: "2.4", channel: "1" }] },
};

test("signalBars theo SNR", () => {
  assert.equal(signalBars(46), 4);
  assert.equal(signalBars(30), 3);
  assert.equal(signalBars(21), 2);
  assert.equal(signalBars(12), 1);
  assert.equal(signalBars(null), 0);
});

test("qualityColor: nhãn Aruba trước, không có thì suy từ số", () => {
  assert.equal(qualityColor("poor", 45), QUALITY_COLORS.poor);
  assert.equal(qualityColor(null, 45), QUALITY_COLORS.good);
  assert.equal(qualityColor(undefined, 22), QUALITY_COLORS.ok);
  assert.equal(qualityColor(undefined, 5), QUALITY_COLORS.poor);
});

test("coChannel: T2 và T3 cùng kênh 1 (2,4 GHz); 5 GHz 100E/52E không trùng", () => {
  const o = coChannel(aps);
  assert.deepEqual(Object.keys(o).sort(), ["Aruba T2", "Aruba T3"]);
  assert.deepEqual(o["Aruba T2"], [{ band: "2.4", channel: "1", with: ["Aruba T3"] }]);
  assert.equal(coChannel({}).length, undefined);
});

test("groupClients: nhóm theo AP, sắp theo tên / sóng yếu trước / tốc độ", () => {
  const g = groupClients(clients);
  assert.deepEqual(g.map((x) => x.name), ["Aruba T1", "Aruba T2"]);
  assert.deepEqual(g[0].clients.map((c) => c.name), ["Cam-T1-Imou-1", "SL-T1-Bep"]);
  const weak = groupClients(clients, { sort: "signal" });
  assert.deepEqual(weak[1].clients.map((c) => c.name), ["espressif", "iPhone"]);
  const fast = groupClients(clients, { sort: "speed", by: "ssid" });
  assert.deepEqual(fast.map((x) => x.name), ["Ga", "QuantumPulse"]);
  assert.equal(fast[0].clients[0].name, "Cam-T1-Imou-1");
});

test("groupClients: lọc SSID / băng tần, nhóm theo băng", () => {
  assert.equal(groupClients(clients, { ssid: "QuantumPulse" })[0].clients.length, 1);
  assert.deepEqual(groupClients(clients, { by: "band" }).map((x) => [x.name, x.clients.length]), [["2.4 GHz", 3], ["5 GHz", 1]]);
  assert.deepEqual(groupClients(clients, { band: "5", by: "band" }).map((x) => x.name), ["5 GHz"]);
  assert.deepEqual(groupClients([], {}), []);
});
