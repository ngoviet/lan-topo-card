import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, readPort, resolveLinks, linkPortsOf } from "../dist/lan-topo-card.js";

// Trạng thái thật ngày 2026-11-19 (routeros_ha): dây CRS310-1 ↔ CRS310-2 chuyển từ ether1 sang
// sfp-sfpplus2; LLDP ở cả hai đầu báo thấy nhau, ether1 hai bên mất link. Cạnh vẫn khai ether1.
const st = (state, attributes = {}) => ({ state: String(state), attributes });
const link = (on, device, source = device ? "lldp" : null) =>
  st(on ? "on" : "off", { speed_mbps: on ? 10000 : null, device: device ?? null, device_source: source });

const STATES = {
  ccr_s1: link(true, "CRS310-1"),
  ccr_s2: link(true), // CRS326 không gửi LLDP
  c1_s1: link(true, "CCR2004"),
  c1_s2: link(true, "CRS310-2"),
  c1_e1: link(false),
  c1_e3: link(true), // GS108PE: không có LLDP
  c1_e4: link(true, "Aruba T2"),
  c2_s2: link(true, "CRS310-1"),
  c2_e1: link(false),
  c2_e2: link(true, "SRV|NAS-N100|-|Synology", "dhcp"),
  c326_s1: link(true),
  gs_8: link(true),
};

const CONFIG = {
  nodes: [
    { id: "internet", type: "internet" },
    { id: "modem", type: "modem" },
    { id: "ccr2004", name: "CCR2004", ports: { adapter: "routeros", device: "CCR2004" } },
    { id: "crs310_1", name: "CRS310-1", ports: { adapter: "routeros", device: "CRS310-1" } },
    { id: "crs310_2", name: "CRS310-2", ports: { adapter: "routeros", device: "CRS310-2" } },
    { id: "crs326", name: "CRS326", ports: { adapter: "routeros", device: "CRS326" } },
    { id: "gs108pe", name: "GS108PE", ports: { adapter: "netgear_plus", prefix: "gs108pe" } },
  ],
  edges: [
    { from: "internet", to: "modem", down: ["sensor.a"], up: ["sensor.b"] },
    { from: "modem", to: "ccr2004", to_port: ["ether1", "ether2"] },
    { from: "ccr2004", to: "crs310_1", from_port: "sfp-sfpplus1", to_port: "sfp-sfpplus1" },
    { from: "crs310_1", to: "crs310_2", from_port: "ether1", to_port: "ether1" },
    { from: "ccr2004", to: "crs326", from_port: "sfp-sfpplus2", to_port: "sfp-sfpplus1" },
    { from: "crs310_1", to: "gs108pe", from_port: "ether3", to_port: 8 },
  ],
};

const port = (name, key) => readPort(STATES, { name, link: key });
function portsOf(states = STATES) {
  const p = (name, key) => readPort(states, { name, link: key });
  return new Map([
    ["ccr2004", [p("ether1", "x"), p("ether2", "x"), p("sfp-sfpplus1", "ccr_s1"), p("sfp-sfpplus2", "ccr_s2")]],
    ["crs310_1", [p("ether1", "c1_e1"), p("ether3", "c1_e3"), p("ether4", "c1_e4"), p("sfp-sfpplus1", "c1_s1"), p("sfp-sfpplus2", "c1_s2")]],
    ["crs310_2", [p("ether1", "c2_e1"), p("ether2", "c2_e2"), p("sfp-sfpplus2", "c2_s2")]],
    ["crs326", [p("sfp-sfpplus1", "c326_s1")]],
    ["gs108pe", [p("8", "gs_8")]],
  ]);
}
const ends = (topo, to) => {
  const e = topo.edges.find((x) => x.to === to);
  return [e.fromPorts, e.toPorts];
};

test("readPort: giữ nguồn của tên thiết bị (lldp / dhcp)", () => {
  assert.equal(port("sfp-sfpplus2", "c1_s2").deviceSource, "lldp");
  assert.equal(port("ether2", "c2_e2").deviceSource, "dhcp");
});

test("resolveLinks: cổng khai mất link, LLDP hai đầu thấy nhau ở cổng khác → dây theo LLDP", () => {
  const base = normalizeConfig(CONFIG);
  const topo = resolveLinks(base, portsOf());
  assert.deepEqual(ends(topo, "crs310_2"), [["sfp-sfpplus2"], ["sfp-sfpplus2"]]);
  assert.equal(topo.edges.find((e) => e.to === "crs310_2").autoPorts, true);
  // Đúng một cạnh đổi, năm cạnh còn lại giữ như khai.
  const changed = topo.edges.filter((e, i) => e !== base.edges[i]).map((e) => e.key);
  assert.deepEqual(changed, ["crs310_1>crs310_2"]);
  // Cổng nối mới được ẩn khỏi cột thiết bị, cổng cũ thì không còn là cổng nối (hết viền đỏ).
  assert.ok(linkPortsOf(topo, "crs310_1").has("sfp-sfpplus2"));
  assert.ok(!linkPortsOf(topo, "crs310_1").has("ether1"));
  // children cùng trỏ vào cạnh mới (buildTree đi theo children).
  assert.equal(topo.children.get("crs310_1").find((e) => e.to === "crs310_2"), topo.edges.find((e) => e.to === "crs310_2"));
  assert.notEqual(base.edges.find((e) => e.to === "crs310_2").fromPorts[0], "sfp-sfpplus2", "không sửa topo gốc");
});

test("resolveLinks: không có gì đổi → trả lại đúng object (không vẽ lại bố cục)", () => {
  const base = normalizeConfig({
    ...CONFIG,
    edges: CONFIG.edges.map((e) => (e.to === "crs310_2" ? { ...e, from_port: "sfp-sfpplus2", to_port: "sfp-sfpplus2" } : e)),
  });
  assert.equal(resolveLinks(base, portsOf()), base);
});

test("resolveLinks: kết quả lần trước giữ nguyên object khi vẫn đúng", () => {
  const base = normalizeConfig(CONFIG);
  const first = resolveLinks(base, portsOf());
  assert.equal(resolveLinks(base, portsOf(), { prev: first }), first);
});

test("resolveLinks: LLDP tạm mất mà cổng vẫn có link → giữ kết quả cũ, không nhảy về ether1", () => {
  const base = normalizeConfig(CONFIG);
  const first = resolveLinks(base, portsOf());
  const blip = { ...STATES, c1_s2: link(true, null), c2_s2: link(true, null) };
  assert.deepEqual(ends(resolveLinks(base, portsOf(blip), { prev: first }), "crs310_2"), [["sfp-sfpplus2"], ["sfp-sfpplus2"]]);
  // Dây sfp rút ra hẳn → bỏ kết quả cũ, quay về cấu hình.
  const unplugged = { ...STATES, c1_s2: link(false), c2_s2: link(false) };
  assert.equal(resolveLinks(base, portsOf(unplugged), { prev: first }), base);
});

test("resolveLinks: cổng khai còn link thì tin cấu hình, kể cả khi LLDP chỉ chỗ khác", () => {
  const states = { ...STATES, c1_e1: link(true), c2_e1: link(true) };
  const base = normalizeConfig(CONFIG);
  assert.equal(resolveLinks(base, portsOf(states)), base);
});

test("resolveLinks: hai đầu LLDP chỉ hai cặp khác nhau, hay nhiều ứng viên → không đoán", () => {
  const base = normalizeConfig(CONFIG);
  const two = { ...STATES, c1_e4: link(true, "CRS310-2") }; // CRS310-1 thấy CRS310-2 ở 2 cổng
  const m = portsOf(two);
  m.get("crs310_1").find((p) => p.name === "ether4").deviceSource = "lldp";
  const r = resolveLinks(base, m);
  // Đầu CRS310-1 mơ hồ → giữ cấu hình (ether1); đầu CRS310-2 rõ ràng → sfp-sfpplus2.
  assert.deepEqual(ends(r, "crs310_2"), [["ether1"], ["sfp-sfpplus2"]]);
});

test("resolveLinks: tên DHCP trùng tên node không được tính là LLDP", () => {
  const states = { ...STATES, c1_s2: link(true, "CRS310-2", "dhcp"), c2_s2: link(true, "CRS310-1", "dhcp") };
  const base = normalizeConfig(CONFIG);
  assert.equal(resolveLinks(base, portsOf(states)), base);
});

test("resolveLinks: tắt bằng lldp: false (cả thẻ hoặc từng cạnh)", () => {
  const base = normalizeConfig(CONFIG);
  assert.equal(resolveLinks(base, portsOf(), { enabled: false }), base);
  const off = normalizeConfig({ ...CONFIG, edges: CONFIG.edges.map((e) => (e.to === "crs310_2" ? { ...e, lldp: false } : e)) });
  assert.equal(resolveLinks(off, portsOf()), off);
});

test("resolveLinks: cạnh chưa khai cổng giữa hai switch nói LLDP → tự điền cổng", () => {
  const base = normalizeConfig({
    ...CONFIG,
    edges: CONFIG.edges.map((e) => (e.to === "crs310_2" ? { from: "crs310_1", to: "crs310_2" } : e)),
  });
  assert.deepEqual(ends(resolveLinks(base, portsOf()), "crs310_2"), [["sfp-sfpplus2"], ["sfp-sfpplus2"]]);
});

test("resolveLinks: chỉ một đầu có LLDP, đầu kia khai cổng đã mất link → đầu kia vào cạnh thẻ", () => {
  const states = { ...STATES, c2_s2: link(true, null) }; // CRS310-2 không báo LLDP
  const base = normalizeConfig(CONFIG);
  assert.deepEqual(ends(resolveLinks(base, portsOf(states)), "crs310_2"), [["sfp-sfpplus2"], []]);
});

test("readPort: IPv6 link-local (fe80::) không được coi là IP của thiết bị", () => {
  const s = { l: st("on", { device: "CRS310-2", device_ip: "fe80::3a32:7aff:fe34:d6d2", device_source: "lldp" }) };
  assert.equal(readPort(s, { name: "x", link: "l" }).deviceIp, null);
  const v4 = { l: st("on", { device_ip: "192.168.12.21" }) };
  assert.equal(readPort(v4, { name: "x", link: "l" }).deviceIp, "192.168.12.21");
});

test("resolveLinks: có kết quả cũ mà cổng khai sống lại → cấu hình thắng ngay, không đợi tải lại", () => {
  const base = normalizeConfig(CONFIG);
  const first = resolveLinks(base, portsOf());
  const back = { ...STATES, c1_e1: link(true), c2_e1: link(true) }; // cắm lại ether1, sfp2 vẫn có link
  assert.equal(resolveLinks(base, portsOf(back), { prev: first }), base);
});
