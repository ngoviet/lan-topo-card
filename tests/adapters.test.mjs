import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discoverAttrPorts,
  discoverNetgearPorts,
  discoverPorts,
  findDevice,
  readPort,
  edgeTraffic,
  visiblePorts,
  normalizeConfig,
  linkPortsOf,
} from "../dist/lan-topo-card.js";

// Dữ liệu mô phỏng đúng hình dạng HA thật (đo 2026-10-18): routeros_ha + netgear_plus.
const st = (state, attributes = {}) => ({ state: String(state), attributes });
const mbit = (v, port, direction) =>
  st(v, { unit_of_measurement: "Mbit/s", device_class: "data_rate", port, direction });

const states = {
  "binary_sensor.crs310_ether3_link": st("on", { port: "ether3", rate: "1Gbps", speed_mbps: 1000, device_class: "connectivity" }),
  "sensor.crs310_ether3_rx": mbit("1.5", "ether3", "rx"),
  "sensor.crs310_ether3_tx": mbit("12.0", "ether3", "tx"),
  "binary_sensor.crs310_ether4_link": st("on", { port: "ether4", rate: "2.5Gbps", speed_mbps: 2500 }),
  "sensor.crs310_ether4_rx": mbit("0.2", "ether4", "rx"),
  "sensor.crs310_ether4_tx": mbit("3.0", "ether4", "tx"),
  "binary_sensor.crs310_ether1_link": st("off", { port: "ether1", rate: null, speed_mbps: null, disabled: true }),
  "sensor.crs310_ether1_rx": mbit("0.0", "ether1", "rx"),
  "sensor.crs310_ether1_tx": mbit("0.0", "ether1", "tx"),
  "binary_sensor.crs310_sfp_sfpplus1_link": st("on", { port: "sfp-sfpplus1", rate: "10Gbps", speed_mbps: 10000 }),
  "sensor.crs310_sfp_sfpplus1_rx": mbit("19.6", "sfp-sfpplus1", "rx"),
  "sensor.crs310_sfp_sfpplus1_tx": mbit("5.9", "sfp-sfpplus1", "tx"),
  "sensor.crs310_cpu_load": st("4", { unit_of_measurement: "%" }),
  // CCR2004
  "binary_sensor.ccr2004_sfp_sfpplus1_link": st("on", { port: "sfp-sfpplus1", rate: "10Gbps", speed_mbps: 10000 }),
  "sensor.ccr2004_sfp_sfpplus1_rx": mbit("5.9", "sfp-sfpplus1", "rx"),
  "sensor.ccr2004_sfp_sfpplus1_tx": mbit("19.6", "sfp-sfpplus1", "tx"),
  // GS108PE (netgear_plus)
  "binary_sensor.gs108pe_port_1_status": st("on", { device_class: "connectivity" }),
  "sensor.gs108pe_port_1_link_speed": st("1000", { unit_of_measurement: "Mbit/s" }),
  "sensor.gs108pe_port_1_receiving": st("0.6", { unit_of_measurement: "MB/s" }),
  "sensor.gs108pe_port_1_sending": st("1.5", { unit_of_measurement: "MB/s" }),
  "switch.gs108pe_port_1": st("on"),
  "binary_sensor.gs108pe_port_5_status": st("off"),
  "sensor.gs108pe_port_5_link_speed": st("0", { unit_of_measurement: "Mbit/s" }),
  "sensor.gs108pe_port_5_receiving": st("0.0", { unit_of_measurement: "MB/s" }),
  "sensor.gs108pe_port_5_sending": st("0.0", { unit_of_measurement: "MB/s" }),
  "switch.gs108pe_port_5": st("off"),
};

const devices = {
  d310: { id: "d310", name: "CRS310", name_by_user: null },
  d326snmp: { id: "d326snmp", name: "CRS326", name_by_user: null },
  dccr: { id: "dccr", name: "CCR2004", name_by_user: "Router chính" },
};
const entities = Object.fromEntries(
  Object.keys(states)
    .filter((id) => id.includes("crs310") || id.includes("ccr2004"))
    .map((id) => [id, { entity_id: id, device_id: id.includes("crs310") ? "d310" : "dccr", platform: "routeros_ha" }]),
);
// entity cùng device nhưng của integration khác (vd SNMP) → phải bị bỏ qua
entities["sensor.crs310_ether3_rx_throughput"] = { entity_id: "sensor.crs310_ether3_rx_throughput", device_id: "d310", platform: "snmp_switch_manager" };
states["sensor.crs310_ether3_rx_throughput"] = st("999", { unit_of_measurement: "bit/s", port: "ether3", direction: "rx" });

test("findDevice: theo name_by_user, name hoặc id, không phân biệt hoa thường", () => {
  assert.equal(findDevice(devices, "crs310").id, "d310");
  assert.equal(findDevice(devices, "Router chính").id, "dccr");
  // đã đặt name_by_user thì tên gốc không còn khớp
  assert.equal(findDevice(devices, "CCR2004"), undefined);
  assert.equal(findDevice(devices, "d326snmp").id, "d326snmp");
  assert.equal(findDevice(devices, "không có"), undefined);
});

test("adapter routeros: gom link + rx + tx theo thuộc tính port, sắp xếp tự nhiên", () => {
  const ports = discoverAttrPorts({ entities, devices, states }, { device: "CRS310" });
  assert.deepEqual(
    ports.map((p) => p.name),
    ["ether1", "ether3", "ether4", "sfp-sfpplus1"],
  );
  const e3 = ports.find((p) => p.name === "ether3");
  assert.equal(e3.link, "binary_sensor.crs310_ether3_link");
  assert.equal(e3.rx, "sensor.crs310_ether3_rx"); // không lấy nhầm entity SNMP cùng device
  assert.equal(e3.tx, "sensor.crs310_ether3_tx");
});

test("adapter routeros: 2 device trùng tên → chọn device có entity đúng platform", () => {
  const devs = { s: { id: "s", name: "CRS310" }, ...devices };
  const ents = { ...entities, "switch.crs310_ether3": { entity_id: "switch.crs310_ether3", device_id: "s", platform: "snmp_switch_manager" } };
  const ports = discoverAttrPorts({ entities: ents, devices: devs, states }, { device: "CRS310" });
  assert.equal(ports.length, 4);
});

test("adapter routeros: platform null nhận entity của mọi integration", () => {
  const ports = discoverAttrPorts({ entities, devices, states }, { device: "CRS310", platform: null });
  assert.equal(ports.find((p) => p.name === "ether3").rx, "sensor.crs310_ether3_rx_throughput");
});

test("adapter routeros: không có registry thì dò theo tiền tố entity_id", () => {
  const ports = discoverAttrPorts({ entities: undefined, devices: undefined, states }, { device: "CRS310" });
  assert.ok(ports.some((p) => p.name === "sfp-sfpplus1" && p.link === "binary_sensor.crs310_sfp_sfpplus1_link"));
});

test("readPort routeros: đổi Mbit/s → bit/s, tốc độ link từ speed_mbps", () => {
  const [def] = discoverAttrPorts({ entities, devices, states }, { device: "CRS310" }).filter((p) => p.name === "ether4");
  const p = readPort(states, def);
  assert.equal(p.linked, true);
  assert.equal(p.speedMbps, 2500);
  assert.equal(p.rxBps, 0.2e6);
  assert.equal(p.txBps, 3e6);
  assert.equal(p.entity, "sensor.crs310_ether4_rx"); // chạm = xem lưu lượng, không mở công tắc
  const down = readPort(states, discoverAttrPorts({ entities, devices, states }, { device: "CRS310" })[0]);
  assert.equal(down.linked, false);
  assert.equal(down.disabled, true);
  assert.equal(down.speedMbps, null);
});

test("readPort: tên thiết bị tự động từ thuộc tính device / device_ip của link", () => {
  const p = readPort(
    { "binary_sensor.x_link": st("on", { port: "ether8", speed_mbps: 2500, device: "Nas - N100", device_ip: "192.168.10.12" }) },
    { name: "ether8", link: "binary_sensor.x_link" },
  );
  assert.equal(p.device, "Nas - N100");
  assert.equal(p.deviceIp, "192.168.10.12");
});

test("adapter netgear_plus: cổng theo tiền tố, MB/s → bit/s, PoE chỉ đọc", () => {
  const defs = discoverNetgearPorts({ states }, { prefix: "gs108pe" });
  assert.deepEqual(defs.map((d) => d.name), ["1", "5"]);
  const p1 = readPort(states, defs[0]);
  assert.equal(p1.linked, true);
  assert.equal(p1.speedMbps, 1000);
  assert.equal(p1.rxBps, 4.8e6); // receiving 0.6 MB/s = từ thiết bị vào switch
  assert.equal(p1.txBps, 12e6); // sending 1.5 MB/s = switch gửi xuống thiết bị
  assert.equal(p1.poe, true);
  assert.equal(p1.entity, "binary_sensor.gs108pe_port_1_status"); // không bao giờ là switch.* PoE
  const p5 = readPort(states, defs[1]);
  assert.equal(p5.linked, false);
  assert.equal(p5.poe, false);
});

test("adapter manual + lỗi adapter lạ", () => {
  const node = { name: "X", ports: { adapter: "manual", ports: [{ name: "Line 1", rx: "sensor.crs310_ether3_rx", speed: "1G" }] } };
  const [def] = discoverPorts({ states }, node);
  const p = readPort(states, def);
  assert.equal(p.speedMbps, 1000);
  assert.equal(p.linked, true); // không có entity link → có tốc độ/lưu lượng là có link
  assert.throws(() => discoverPorts({ states }, { ports: { adapter: "snmp" } }), /không hỗ trợ/);
});

test("readPort: entity unavailable → null, không ném lỗi", () => {
  const p = readPort({ "sensor.x": st("unavailable", { unit_of_measurement: "Mbit/s" }) }, { name: "a", rx: "sensor.x", link: "binary_sensor.none" });
  assert.equal(p.rxBps, null);
  assert.equal(p.linked, null);
});

const topoCfg = {
  nodes: [
    { id: "internet", type: "internet" },
    { id: "ccr", type: "router", ports: { adapter: "routeros", device: "CCR2004" } },
    { id: "crs310", type: "switch", ports: { adapter: "routeros", device: "CRS310" }, port_names: { ether4: "AP Aruba T2 | 192.168.10.4" } },
    { id: "gs", type: "switch", ports: { adapter: "netgear_plus", prefix: "gs108pe" } },
  ],
  edges: [
    { from: "internet", to: "ccr", down: ["sensor.crs310_ether3_tx"], up: ["sensor.crs310_ether3_rx"] },
    { from: "ccr", to: "crs310", from_port: "sfp-sfpplus1", to_port: "sfp-sfpplus1" },
    { from: "crs310", to: "gs", from_port: "ether3", to_port: "8" },
  ],
};

function portsByNode(topo) {
  const ctx = { entities, devices, states };
  return new Map([...topo.nodes.values()].filter((n) => n.ports).map((n) => [n.id, discoverPorts(ctx, n).map((d) => readPort(states, d))]));
}

test("edgeTraffic: from_port trên node cha → tx là chiều xuống", () => {
  const topo = normalizeConfig(topoCfg);
  const t = edgeTraffic(topo.edges[1], portsByNode(topo), states);
  assert.equal(t.down, 19.6e6); // CCR gửi xuống CRS310
  assert.equal(t.up, 5.9e6);
  assert.equal(t.speedMbps, 10000);
  assert.equal(t.linked, true);
});

test("edgeTraffic: down/up khai báo tay được ưu tiên, cộng dồn danh sách", () => {
  const topo = normalizeConfig(topoCfg);
  const t = edgeTraffic(topo.edges[0], portsByNode(topo), states);
  assert.equal(t.down, 12e6);
  assert.equal(t.up, 1.5e6);
  const sum = edgeTraffic(
    { ...topo.edges[0], down: ["sensor.crs310_ether3_tx", "sensor.crs310_ether4_tx"], up: [] },
    portsByNode(topo),
    states,
  );
  assert.equal(sum.down, 15e6);
  assert.equal(sum.up, null);
});

test("edgeTraffic: chỉ có to_port trên node con → rx là chiều xuống", () => {
  const topo = normalizeConfig({
    nodes: [{ id: "a" }, { id: "b", ports: { adapter: "routeros", device: "CRS310" } }],
    edges: [{ from: "a", to: "b", to_port: ["ether3", "ether4"] }],
  });
  const t = edgeTraffic(topo.edges[0], portsByNode(topo), states);
  assert.equal(t.down, 1.7e6);
  assert.equal(t.up, 15e6);
  assert.equal(t.speedMbps, 2500);
});

test("visiblePorts: chỉ cổng có link, ẩn cổng nối switch, tôn trọng port_names", () => {
  const topo = normalizeConfig(topoCfg);
  const node = topo.nodes.get("crs310");
  const ports = portsByNode(topo).get("crs310");
  const hidden = linkPortsOf(topo, "crs310");
  assert.deepEqual([...hidden].sort(), ["ether3", "sfp-sfpplus1"]);
  assert.deepEqual(visiblePorts(node, ports, hidden).map((p) => p.name), ["ether4"]);
  assert.deepEqual(
    visiblePorts(node, ports, hidden, { showAll: true }).map((p) => p.name),
    ["ether1", "ether4"],
  );
  node.portNames.ether4 = { hide: true };
  assert.deepEqual(visiblePorts(node, ports, hidden).map((p) => p.name), []);
});

test("portLabel: nhãn ngắn trên ô cổng", async () => {
  const { portLabel } = await import("../dist/lan-topo-card.js");
  assert.equal(portLabel("ether7"), "7");
  assert.equal(portLabel("ether16"), "16");
  assert.equal(portLabel("sfp-sfpplus1"), "S1");
  assert.equal(portLabel("qsfp28-1-1"), "S1");
  assert.equal(portLabel("3"), "3");
  assert.equal(portLabel("wan"), "wan");
});

test("poeOn: chỉ khi PoE bật và có link, port_names poe:false tắt hẳn", async () => {
  const { poeOn } = await import("../dist/lan-topo-card.js");
  assert.equal(poeOn({ poe: true, linked: true }), true);
  assert.equal(poeOn({ poe: true, linked: false }), false); // cổng trống
  assert.equal(poeOn({ poe: false, linked: true }), false);
  assert.equal(poeOn({ poe: null, linked: true }), false); // switch không có PoE
  assert.equal(poeOn({ poe: true, linked: true }, { poe: false }), false); // uplink
});

test("readPort: sensor tốc độ báo -1 (chưa biết) → speedMbps null, không coi là có link", () => {
  const states = { "sensor.sw_port_1_link_speed": st("-1", { unit_of_measurement: "Mbit/s" }) };
  const p = readPort(states, { name: "1", speed: "sensor.sw_port_1_link_speed" });
  assert.equal(p.speedMbps, null);
  assert.equal(p.linked, false);
});
