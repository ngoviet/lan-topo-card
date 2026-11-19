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

// ── Chi tiết 5 phút (aruba_instant_ha ≥ 0.2.0): mọi trường tuỳ chọn ──
import { clientBadges, clientRetry, fmtUptime, fmtKbps, radioWarnings, shortAp, strings } from "../dist/lan-topo-card.js";

test("clientBadges: integration cũ (không trường mới) ⇒ không huy hiệu", () => {
  for (const c of clients) assert.deepEqual(clientBadges(c), []);
  assert.deepEqual(clientBadges(undefined), []);
});

test("clientBadges: ưu tiên AP nghe to hơn, rồi retry, tối đa 2", () => {
  const c = { louder_ap: "Aruba T2", louder_gain: 25, retry_5m: 54, retry_pct: 10, stuck_24: true };
  assert.deepEqual(clientBadges(c), [
    { kind: "louder", ap: "T2", gain: 25 },
    { kind: "retry", pct: 54 },
  ]);
  assert.deepEqual(clientBadges({ retry_pct: 29.9 }), []);
  assert.deepEqual(clientBadges({ retry_pct: 30, stuck_24: true }), [{ kind: "retry", pct: 30 }, { kind: "stuck" }]);
});

test("clientRetry: 5 phút trước, từ lúc nối sau, rỗng ⇒ null", () => {
  assert.equal(clientRetry({ retry_5m: 12, retry_pct: 40 }), 12);
  assert.equal(clientRetry({ retry_pct: 40 }), 40);
  assert.equal(clientRetry({}), null);
  assert.equal(clientRetry({ retry_5m: null }), null);
});

test("fmtUptime / fmtKbps", () => {
  assert.equal(fmtUptime(3 * 86400 + 17 * 3600 + 5, { d: "n", h: "g", m: "p" }), "3n 17g");
  assert.equal(fmtUptime(2 * 3600 + 5 * 60), "2h 5m");
  assert.equal(fmtUptime(undefined), null);
  assert.equal(fmtKbps(850.4), "850 kb/s");
  assert.equal(fmtKbps(1234), "1.2 Mb/s");
  assert.equal(fmtKbps(25000), "25 Mb/s");
  assert.equal(fmtKbps(undefined), null);
});

test("radioWarnings: reset > 2/ngày, retry ≥ 15%", () => {
  assert.deepEqual(radioWarnings({ resets_per_day: 3.9, retry_5m: 4 }), [{ kind: "resets", value: 3.9 }]);
  assert.deepEqual(radioWarnings({ resets_per_day: 1.1, retry_pct: 16 }), [{ kind: "retry", value: 16 }]);
  assert.deepEqual(radioWarnings({}), []);
});

test("chuỗi cảnh báo: mọi mã integration gửi đều có chữ ở cả vi và en", () => {
  const codes = ["radio_resets", "radio_retry", "open_network", "louder_ap", "stuck_24", "detail_failed"];
  const a = { ap: "Aruba T1", band: "2.4", value: 3.9, ssid: "Setup", channel: 6 };
  for (const lang of ["vi", "en"]) {
    const T = strings(lang);
    for (const code of codes) assert.match(T.alerts[code](a), /\S/, `${lang} ${code}`);
  }
  assert.equal(shortAp("Aruba T3"), "T3");
});
