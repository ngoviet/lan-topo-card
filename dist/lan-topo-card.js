/**
 * lan-topo-card — Lovelace card vẽ sơ đồ mạng LAN (Internet → modem → router → switch → cổng).
 *
 * - Topo khai báo bằng YAML (nodes + edges), không gắn cứng khuôn router/switch nào.
 * - Cổng switch lấy qua adapter: `routeros` (integration routeros_ha, hoặc bất kỳ integration
 *   nào gắn thuộc tính `port`/`direction` lên entity), `netgear_plus`, hoặc khai báo tay.
 * - Không bước build: Lit lấy từ frontend Home Assistant. Phần logic thuần (đổi đơn vị,
 *   adapter, bố cục) được export để test bằng `node --test`.
 *
 * MIT © ngoviet — https://github.com/ngoviet/lan-topo-card
 */

export const VERSION = "0.6.0";

const ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;

// ═══════════════════════════════ Đơn vị & màu ═══════════════════════════════

// Hệ số đổi về bit/s. Khoá viết thường, bỏ khoảng trắng.
const RATE_UNITS = {
  "bit/s": 1, bps: 1, "b/s": 1,
  "kbit/s": 1e3, kbps: 1e3, "kb/s": 1e3,
  "mbit/s": 1e6, mbps: 1e6, "mb/s": 1e6,
  "gbit/s": 1e9, gbps: 1e9, "gb/s": 1e9,
  "tbit/s": 1e12,
  "kibit/s": 1024, "mibit/s": 1024 ** 2, "gibit/s": 1024 ** 3,
};
// Byte/s — phân biệt hoa/thường: "MB/s" là megabyte, "Mb/s" là megabit.
const BYTE_UNITS = {
  "B/s": 8, "kB/s": 8e3, "KB/s": 8e3, "MB/s": 8e6, "GB/s": 8e9, "TB/s": 8e12,
  "KiB/s": 8 * 1024, "MiB/s": 8 * 1024 ** 2, "GiB/s": 8 * 1024 ** 3,
  "Bps": 8, "kBps": 8e3, "KBps": 8e3, "MBps": 8e6, "GBps": 8e9,
};

/** Giá trị + đơn vị bất kỳ (bit/s, kbit/s, Mbit/s, B/s, kB/s, MB/s, KiB/s…) → bit/s. */
export function toBps(value, unit) {
  const v = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(v)) return null;
  const u = String(unit ?? "bit/s").trim();
  if (u in BYTE_UNITS) return v * BYTE_UNITS[u];
  const f = RATE_UNITS[u.toLowerCase().replace(/\s+/g, "")];
  return f === undefined ? null : v * f;
}

/** "1 Gbps", "2.5Gbps", "100Mbps", "10M", 1000 (Mbit/s), "Disconnected" → Mbit/s | null. */
export function parseLinkSpeed(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value > 0 ? value : null;
  const m = String(value).trim().match(/^(\d+(?:[.,]\d+)?)\s*([kmgt])?\s*(?:bit\/s|bps|b\/s|bit)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  const mult = { k: 1e-3, m: 1, g: 1e3, t: 1e6 }[(m[2] || "m").toLowerCase()];
  const mbps = n * mult;
  return mbps > 0 ? mbps : null;
}

export const SPEED_TIERS = [
  { id: "10g", min: 10000, color: "#3b82f6", vi: "10 Gbps", en: "10 Gbps" },
  { id: "2g5", min: 2500, color: "#14b8a6", vi: "2,5 Gbps", en: "2.5 Gbps" },
  { id: "1g", min: 1000, color: "#22c55e", vi: "1 Gbps", en: "1 Gbps" },
  { id: "100m", min: 100, color: "#f59e0b", vi: "100 Mbps", en: "100 Mbps" },
  { id: "10m", min: 0, color: "#9ca3af", vi: "10 Mbps", en: "10 Mbps" },
];
export const NO_LINK_COLOR = "#ef4444";
export const UNKNOWN_SPEED_COLOR = "#22d3ee";

/** Màu cổng/đường theo tốc độ link. linked=false → đỏ; có link nhưng chưa biết tốc độ → cyan. */
export function speedColor(mbps, linked = true) {
  if (!linked) return NO_LINK_COLOR;
  if (!mbps) return UNKNOWN_SPEED_COLOR;
  return SPEED_TIERS.find((t) => mbps >= t.min).color;
}

/** Nhãn ngắn của tốc độ link: 10000 → "10G", 2500 → "2.5G", 100 → "100M". */
export function speedLabel(mbps) {
  if (!mbps) return "";
  if (mbps >= 1000) return `${+(mbps / 1000).toFixed(1)}G`;
  return `${Math.round(mbps)}M`;
}

/** bit/s → chuỗi dễ đọc ("12,3 Mbps"). null → "—". */
export function formatRate(bps, locale = "en") {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "—";
  const steps = [[1e9, "Gbps"], [1e6, "Mbps"], [1e3, "kbps"], [1, "bps"]];
  const [div, unit] = steps.find(([d]) => Math.abs(bps) >= d) || steps[3];
  const v = bps / div;
  const digits = v >= 100 || div === 1 ? 0 : v >= 10 ? 1 : 2;
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v);
  return `${num} ${unit}`;
}

/** Mức chạy của đường (0 = đứng yên). Ngưỡng theo bậc 10 để đổi mức ít, không giật. */
export function flowLevel(bps, idleBps = 20e3) {
  if (!bps || bps < idleBps) return 0;
  if (bps < 1e6) return 1;
  if (bps < 10e6) return 2;
  if (bps < 100e6) return 3;
  if (bps < 1e9) return 4;
  return 5;
}

/**
 * Độ dày (px) của sợi lưu lượng, tỉ lệ log10 với bit/s: 100 kbps ≈ 1,2 · 1 Mbps ≈ 2,3 ·
 * 10 Mbps ≈ 3,4 · 100 Mbps ≈ 4,5 · 1 Gbps ≈ 5,6 (chặn trong [min, max]).
 */
export function flowWidth(bps, { min = 1.2, max = 7, perDecade = 1.1 } = {}) {
  if (!bps || bps <= 0) return min;
  return Math.min(max, Math.max(min, min + perDecade * Math.log10(bps / 1e5)));
}

/** So sánh tự nhiên: ether2 < ether10 < sfp-sfpplus1. */
export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

export function slugify(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ═══════════════════════════════ Cấu hình ═══════════════════════════════

const NODE_TYPES = {
  internet: { icon: "mdi:web", color: "#a78bfa" },
  modem: { icon: "mdi:router-network", color: "#fb923c" },
  router: { icon: "mdi:router", color: "#22d3ee" },
  switch: { icon: "mdi:switch", color: "#34d399" },
  ap: { icon: "mdi:access-point", color: "#60a5fa" },
  server: { icon: "mdi:server", color: "#f472b6" },
  device: { icon: "mdi:devices", color: "#94a3b8" },
};

const asList = (v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]);

/** Chuẩn hoá `port_names`: { ether9: "HA | 192.168.10.15" } → { ether9: {name, ip, icon, hide} }. */
export function normalizePortNames(raw) {
  const out = {};
  for (const [port, v] of Object.entries(raw || {})) {
    if (v === false || v === null) out[port] = { hide: true };
    else if (typeof v === "string") {
      const [name, ip] = v.split("|").map((s) => s.trim());
      out[port] = { name: name || undefined, ip: ip || undefined };
    } else if (typeof v === "object") out[port] = { ...v };
  }
  return out;
}

/**
 * Kiểm tra + chuẩn hoá cấu hình. Ném Error (HA hiện thành thẻ lỗi) khi topo sai.
 * Trả { nodes: Map(id → node), edges, roots, children: Map(id → [edge]) }.
 */
export function normalizeConfig(config) {
  if (!config || !Array.isArray(config.nodes) || !config.nodes.length) {
    throw new Error("lan-topo-card: cần khai báo `nodes` (danh sách thiết bị)");
  }
  const nodes = new Map();
  for (const raw of config.nodes) {
    if (!raw || !raw.id) throw new Error("lan-topo-card: mỗi node cần `id`");
    const id = String(raw.id);
    if (nodes.has(id)) throw new Error(`lan-topo-card: trùng node id "${id}"`);
    const type = raw.type in NODE_TYPES ? raw.type : "device";
    nodes.set(id, {
      ...raw,
      id,
      type,
      name: raw.name ?? id,
      icon: raw.icon ?? NODE_TYPES[type].icon,
      color: raw.color ?? NODE_TYPES[type].color,
      portNames: normalizePortNames(raw.port_names),
    });
  }
  const edges = [];
  const children = new Map([...nodes.keys()].map((k) => [k, []]));
  const parentOf = new Map();
  for (const [i, raw] of (config.edges || []).entries()) {
    const from = String(raw?.from ?? "");
    const to = String(raw?.to ?? "");
    if (!nodes.has(from)) throw new Error(`lan-topo-card: edge ${i + 1} — không có node from "${from}"`);
    if (!nodes.has(to)) throw new Error(`lan-topo-card: edge ${i + 1} — không có node to "${to}"`);
    if (parentOf.has(to)) throw new Error(`lan-topo-card: node "${to}" có 2 node cha (sơ đồ phải là cây)`);
    const edge = {
      ...raw,
      key: `${from}>${to}`,
      from,
      to,
      fromPorts: asList(raw.from_port).map(String),
      toPorts: asList(raw.to_port).map(String),
      down: asList(raw.down),
      up: asList(raw.up),
    };
    parentOf.set(to, from);
    edges.push(edge);
    children.get(from).push(edge);
  }
  // Phát hiện vòng (A → B → A) — vòng thì không có gốc hoặc đệ quy vô hạn.
  for (const id of nodes.keys()) {
    const seen = new Set([id]);
    let cur = parentOf.get(id);
    while (cur !== undefined) {
      if (seen.has(cur)) throw new Error(`lan-topo-card: sơ đồ có vòng quanh node "${cur}"`);
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }
  const roots = [...nodes.keys()].filter((id) => !parentOf.has(id));
  return { nodes, edges, roots, children, parentOf };
}

/** Node mở sẵn khi tải: danh sách id, hoặc "all" = mọi node có cổng. */
export function initialExpanded(topo, expanded, multi) {
  const ids =
    expanded === "all"
      ? [...topo.nodes.values()].filter((n) => n.ports).map((n) => n.id)
      : asList(expanded).map(String).filter((id) => topo.nodes.has(id));
  return new Set(multi ? ids : ids.slice(0, 1));
}

/** Cổng của node đang dùng để nối với node khác → ẩn khỏi cột thiết bị. */
export function linkPortsOf(topo, nodeId) {
  const used = new Set();
  for (const e of topo.edges) {
    if (e.from === nodeId) e.fromPorts.forEach((p) => used.add(p));
    if (e.to === nodeId) e.toPorts.forEach((p) => used.add(p));
  }
  return used;
}

// ═══════════════════════════════ Adapter cổng ═══════════════════════════════

const BAD_STATES = new Set(["unavailable", "unknown", "none", ""]);

function stateOf(states, id) {
  const st = id ? states?.[id] : undefined;
  return st && !BAD_STATES.has(String(st.state)) ? st : undefined;
}

function rateOf(states, id) {
  const st = stateOf(states, id);
  return st ? toBps(st.state, st.attributes?.unit_of_measurement) : null;
}

function isOn(states, id) {
  const st = stateOf(states, id);
  return st ? st.state === "on" : null;
}

/** Mọi device khớp tên (name_by_user hoặc name, không phân biệt hoa thường) hoặc id. */
export function matchDevices(devices, wanted) {
  if (!devices || !wanted) return [];
  if (devices[wanted]) return [devices[wanted]];
  const w = String(wanted).toLowerCase();
  const list = Object.values(devices);
  const byUser = list.filter((d) => (d.name_by_user || "").toLowerCase() === w);
  return byUser.length ? byUser : list.filter((d) => !d.name_by_user && (d.name || "").toLowerCase() === w);
}

export function findDevice(devices, wanted) {
  return matchDevices(devices, wanted)[0];
}

/**
 * Adapter `routeros`: entity của 1 device có thuộc tính `port` —
 * binary_sensor (link, kèm `speed_mbps`/`rate`) + sensor `direction: rx|tx`.
 * Không có registry (hass.entities) thì dò theo tiền tố entity_id = slug tên device.
 */
export function discoverAttrPorts({ entities, devices, states }, opts) {
  const platform = "platform" in opts ? opts.platform : "routeros_ha";
  // Nhiều device trùng tên (vd. cùng router có cả SNMP lẫn REST) → lấy entity đúng platform.
  let ids;
  const devIds = new Set(matchDevices(devices, opts.device).map((d) => d.id));
  if (entities && devIds.size) {
    ids = Object.values(entities)
      .filter((e) => devIds.has(e.device_id) && (!platform || e.platform === platform))
      .map((e) => e.entity_id);
  } else {
    const prefix = slugify(opts.device);
    ids = Object.keys(states || {}).filter((id) => id.split(".")[1]?.startsWith(`${prefix}_`));
  }
  const ports = new Map();
  for (const id of ids) {
    const st = states?.[id];
    const port = st?.attributes?.port;
    if (!port) continue;
    const p = ports.get(port) || { name: String(port) };
    const domain = id.split(".")[0];
    if (domain === "binary_sensor") p.link = id;
    else if (domain === "sensor" && st.attributes.direction === "rx") p.rx = id;
    else if (domain === "sensor" && st.attributes.direction === "tx") p.tx = id;
    ports.set(port, p);
  }
  return [...ports.values()].sort((a, b) => naturalCompare(a.name, b.name));
}

/**
 * Adapter `netgear_plus` (switch Netgear ProSAFE Plus, vd GS108PE): theo tiền tố entity
 * `<prefix>_port_N_*`. receiving = switch nhận vào cổng (rx), sending = gửi ra (tx).
 * `switch.<prefix>_port_N` = nguồn PoE — chỉ ĐỌC trạng thái, card không bao giờ bật/tắt.
 */
export function discoverNetgearPorts({ states }, opts) {
  const prefix = opts.prefix ?? slugify(opts.device ?? "");
  const re = new RegExp(`^binary_sensor\\.${prefix}_port_(\\d+)_status$`);
  const nums = Object.keys(states || {})
    .map((id) => id.match(re)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  return nums.map((n) => ({
    name: String(n),
    link: `binary_sensor.${prefix}_port_${n}_status`,
    speed: `sensor.${prefix}_port_${n}_link_speed`,
    rx: `sensor.${prefix}_port_${n}_receiving`,
    tx: `sensor.${prefix}_port_${n}_sending`,
    poe: `switch.${prefix}_port_${n}`,
    info: `binary_sensor.${prefix}_port_${n}_status`,
  }));
}

/** Danh sách định nghĩa cổng (entity id) của 1 node theo adapter. */
export function discoverPorts(ctx, node) {
  const spec = node.ports;
  if (!spec) return [];
  if (Array.isArray(spec)) {
    return spec.map((p, i) => ({ ...p, name: String(p.name ?? p.port ?? i + 1) }));
  }
  const adapter = spec.adapter ?? "routeros";
  if (adapter === "routeros") return discoverAttrPorts(ctx, { ...spec, device: spec.device ?? node.name });
  if (adapter === "netgear_plus") return discoverNetgearPorts(ctx, spec);
  if (adapter === "manual") return asList(spec.ports).map((p, i) => ({ ...p, name: String(p.name ?? i + 1) }));
  throw new Error(`lan-topo-card: adapter "${adapter}" không hỗ trợ (routeros | netgear_plus | manual)`);
}

/** Nhãn ngắn trên ô cổng: ether7 → "7", sfp-sfpplus1 → "S1", "3" → "3", wan → "wan". */
export function portLabel(name) {
  const n = String(name ?? "");
  const m = n.match(/(\d+)$/);
  if (!m) return n.slice(0, 4);
  return /sfp|qsfp/i.test(n) ? `S${m[1]}` : m[1];
}

/**
 * ⚡ chỉ khi cổng đang cấp PoE thật: công tắc PoE bật VÀ có link (netgear_plus báo "bật PoE"
 * cả ở cổng trống). `port_names: { 8: { poe: false } }` tắt hẳn (vd cổng uplink).
 */
export function poeOn(port, meta = {}) {
  return meta.poe !== false && port.poe === true && port.linked === true;
}

/** Đọc giá trị hiện tại của 1 cổng. rx = switch nhận vào cổng, tx = switch gửi ra cổng. */
export function readPort(states, def) {
  const linkSt = stateOf(states, def.link);
  let speedMbps = null;
  const speedEntity = typeof def.speed === "string" && ENTITY_RE.test(def.speed);
  if (def.speed !== undefined && def.speed !== null && !speedEntity) {
    speedMbps = parseLinkSpeed(def.speed);
  } else if (speedEntity) {
    const st = stateOf(states, def.speed);
    if (st) {
      const bps = toBps(st.state, st.attributes?.unit_of_measurement ?? "Mbit/s");
      speedMbps = bps ? bps / 1e6 : null;
    }
  }
  if (speedMbps === null && linkSt) {
    speedMbps = parseLinkSpeed(linkSt.attributes?.speed_mbps ?? linkSt.attributes?.rate ?? linkSt.attributes?.Speed);
  }
  const rxBps = rateOf(states, def.rx);
  const txBps = rateOf(states, def.tx);
  let linked;
  if (def.link) linked = linkSt ? linkSt.state === "on" : null;
  else linked = (rxBps ?? 0) > 0 || (txBps ?? 0) > 0 || !!speedMbps;
  if (linked === false) speedMbps = null;
  return {
    name: def.name,
    linked,
    speedMbps,
    rxBps,
    txBps,
    poe: def.poe ? isOn(states, def.poe) : null,
    disabled: linkSt?.attributes?.disabled === true,
    comment: linkSt?.attributes?.comment || null,
    // Thiết bị đang cắm (routeros_ha: LLDP neighbor / DHCP lease có comment) — tên tự động.
    device: linkSt?.attributes?.device || null,
    deviceIp: linkSt?.attributes?.device_ip || null,
    entity: def.info || def.rx || def.link || def.tx || null,
    entities: [def.link, def.rx, def.tx, def.poe, speedEntity ? def.speed : null].filter(Boolean),
  };
}

const sumOrNull = (vals) => {
  const ok = vals.filter((v) => v !== null && v !== undefined);
  return ok.length ? ok.reduce((a, b) => a + b, 0) : null;
};

/**
 * Lưu lượng của 1 đường nối. down = chiều từ gốc (Internet) đi ra lá.
 * Ưu tiên: `down`/`up` khai báo tay → `from_port` trên node cha (tx = xuống) →
 * `to_port` trên node con (rx = xuống).
 */
export function edgeTraffic(edge, portsByNode, states) {
  const pick = (nodeId, names) => names.map((n) => portsByNode.get(nodeId)?.find((p) => p.name === n)).filter(Boolean);
  let down = null;
  let up = null;
  let speed = null;
  const entities = [...edge.down, ...edge.up];
  if (edge.down.length || edge.up.length) {
    down = sumOrNull(edge.down.map((id) => rateOf(states, id)));
    up = sumOrNull(edge.up.map((id) => rateOf(states, id)));
  }
  const parentPorts = pick(edge.from, edge.fromPorts);
  const childPorts = pick(edge.to, edge.toPorts);
  if (down === null && up === null) {
    if (parentPorts.length) {
      down = sumOrNull(parentPorts.map((p) => p.txBps));
      up = sumOrNull(parentPorts.map((p) => p.rxBps));
    } else if (childPorts.length) {
      down = sumOrNull(childPorts.map((p) => p.rxBps));
      up = sumOrNull(childPorts.map((p) => p.txBps));
    }
  }
  const speeds = [...parentPorts, ...childPorts].map((p) => p.speedMbps).filter(Boolean);
  if (edge.speed) speed = parseLinkSpeed(edge.speed);
  else if (speeds.length) speed = Math.max(...speeds);
  const linkedAll = [...parentPorts, ...childPorts].map((p) => p.linked);
  const linked = linkedAll.length ? linkedAll.some((v) => v !== false) : true;
  return { down, up, speedMbps: speed, linked, entities };
}

/** Cổng hiện trong cột thiết bị: có link hoặc có lưu lượng, không phải cổng nối switch khác. */
export function visiblePorts(node, ports, hiddenNames, opts = {}) {
  const idle = opts.idleBps ?? 20e3;
  return ports.filter((p) => {
    const meta = node.portNames[p.name];
    if (meta?.hide) return false;
    if (hiddenNames.has(p.name)) return false;
    if (opts.showAll) return true;
    if (meta?.show) return true;
    return p.linked === true || (p.rxBps ?? 0) > idle || (p.txBps ?? 0) > idle;
  });
}

// ═══════════════════════════════ Wi-Fi ═══════════════════════════════

export const QUALITY_COLORS = { good: "#22c55e", ok: "#f59e0b", poor: "#ef4444" };

/** Số vạch sóng 1..4 theo chỉ số signal của Aruba (SNR, dB): ≥40 → 4, ≥30 → 3, ≥20 → 2. */
export function signalBars(signal) {
  if (signal === null || signal === undefined || !Number.isFinite(Number(signal))) return 0;
  const v = Number(signal);
  return v >= 40 ? 4 : v >= 30 ? 3 : v >= 20 ? 2 : 1;
}

/** Màu theo nhãn chất lượng của Aruba; không có nhãn thì suy từ số vạch. */
export function qualityColor(quality, signal) {
  if (quality && QUALITY_COLORS[quality]) return QUALITY_COLORS[quality];
  const b = signalBars(signal);
  return b >= 3 ? QUALITY_COLORS.good : b === 2 ? QUALITY_COLORS.ok : b === 1 ? QUALITY_COLORS.poor : "#94a3b8";
}

/** AP dùng chung kênh trên cùng băng → {apName: [tên AP trùng kênh]} (kênh 2,4 GHz chồng nhau gây nhiễu). */
export function coChannel(aps) {
  const byKey = new Map();
  for (const [name, ap] of Object.entries(aps || {})) {
    for (const r of ap.radios || []) {
      const ch = String(r.channel ?? "").match(/^\d+/)?.[0];
      if (!ch || !r.band) continue;
      const key = `${r.band}:${ch}`;
      byKey.set(key, [...(byKey.get(key) || []), name]);
    }
  }
  const out = {};
  for (const [key, names] of byKey) {
    if (names.length < 2) continue;
    for (const n of names) {
      out[n] = out[n] || [];
      out[n].push({ band: key.split(":")[0], channel: key.split(":")[1], with: names.filter((x) => x !== n) });
    }
  }
  return out;
}

/** Lọc + nhóm + sắp xếp danh sách client. by: ap | ssid | band; sort: name | signal (yếu trước) | speed. */
export function groupClients(clients, { by = "ap", sort = "name", ssid = null, band = null } = {}) {
  const list = (clients || []).filter((c) => (!ssid || c.essid === ssid) && (!band || c.band === band));
  const cmp = {
    name: (a, b) => naturalCompare(a.name || "", b.name || ""),
    signal: (a, b) => (a.signal ?? -1) - (b.signal ?? -1) || naturalCompare(a.name || "", b.name || ""),
    speed: (a, b) => (b.speed_mbps ?? -1) - (a.speed_mbps ?? -1) || naturalCompare(a.name || "", b.name || ""),
  }[sort] || ((a, b) => naturalCompare(a.name || "", b.name || ""));
  const key = (c) => (by === "ssid" ? c.essid : by === "band" ? (c.band ? `${c.band} GHz` : null) : c.ap) || "?";
  const groups = new Map();
  for (const c of list) groups.set(key(c), [...(groups.get(key(c)) || []), c]);
  return [...groups.entries()]
    .sort((a, b) => naturalCompare(a[0], b[0]))
    .map(([name, items]) => ({ name, clients: items.sort(cmp) }));
}

// ═══════════════════════════════ Ai đang dùng nhiều ═══════════════════════════════

/** % thanh mức dùng theo log10: 10 kbps → 0, 1 Gbps → 100. */
export function usagePct(bps) {
  if (!bps || bps <= 1e4) return 0;
  return Math.min(100, (Math.log10(bps / 1e4) / 5) * 100);
}

/** Mức "nóng" của cổng theo tổng lưu lượng: 0 bình thường, 1 ≥ warm, 2 ≥ hot (Mbps). */
export function heatLevel(bps, { warmMbps = 10, hotMbps = 50 } = {}) {
  if (!bps) return 0;
  if (bps >= hotMbps * 1e6) return 2;
  if (bps >= warmMbps * 1e6) return 1;
  return 0;
}

/**
 * Xếp hạng thiết bị theo tổng lưu lượng ↓+↑ trên mọi cổng có thiết bị (bỏ cổng nối giữa các
 * node và cổng ẩn). ↓ = về phía thiết bị = tx của cổng switch.
 */
export function topTalkers(topo, portsByNode, { limit = 5, idleBps = 20e3 } = {}) {
  const rows = [];
  for (const [nodeId, ports] of portsByNode) {
    const node = topo.nodes.get(nodeId);
    const hidden = linkPortsOf(topo, nodeId);
    for (const p of ports) {
      const meta = node.portNames[p.name] || {};
      if (meta.hide || hidden.has(p.name) || p.linked === false) continue;
      const down = p.txBps ?? 0;
      const up = p.rxBps ?? 0;
      if (down + up <= idleBps) continue;
      rows.push({
        nodeId,
        nodeName: node.name,
        port: p,
        name: meta.name || p.device || p.comment || p.name,
        icon: meta.icon || null,
        down,
        up,
        total: down + up,
      });
    }
  }
  return rows.sort((a, b) => b.total - a.total).slice(0, limit);
}

// ═══════════════════════════════ Bố cục ═══════════════════════════════

export const LAYOUT = {
  pad: 14,
  nodeW: 184,
  nodeH: 74,
  portW: 214,
  portH: 40,
  colGap: 104,
  rowGap: 22,
  portGap: 8,
  chainGap: 44, // khoảng dọc giữa các node của chuỗi xếp chồng (đủ chỗ nhãn ↓/↑ bên cạnh)
  // vòng tròn / vòng cung
  ringPad: 34, // khe hở theo bán kính giữa 2 vòng
  arcPad: 10, // khe hở theo chiều cung giữa 2 ô cạnh nhau trên cùng một vòng
  rNodeW: 150,
  rNodeH: 64,
  rPortW: 164,
  rPortH: 38,
  // cây dọc (trên → dưới)
  dIndent: 28, // cột cổng thụt vào so với node
  dColGap: 26,
  dRowGap: 58, // node → hàng node con (đủ chỗ nhãn ↓/↑ cạnh đoạn thả xuống)
  // thẻ
  cardMinW: 270,
  cardMaxW: 380,
  cardPad: 8,
  cardGap: 12,
  // dọc (điện thoại)
  vIndent: 18,
  vNodeH: 70,
  vPortH: 42,
  vGap: 10,
};

/**
 * Cây hiển thị: node + (nếu đang mở) lá cổng. Lá cổng đứng TRƯỚC node con để cột thiết bị
 * nằm sát switch, node con (switch tiếp theo) ở dưới.
 */
export function buildTree(topo, expanded, portLeaves) {
  const make = (id, edge) => {
    const kids = [];
    if (expanded.has(id)) for (const p of portLeaves.get(id) || []) kids.push({ kind: "port", nodeId: id, port: p, key: `${id}:${p.name}`, children: [] });
    for (const e of topo.children.get(id) || []) kids.push(make(e.to, e));
    return { kind: "node", id, edge, key: id, children: kids };
  };
  return topo.roots.map((r) => make(r, null));
}

/**
 * Bố cục cây ngang (trái → phải). Trả { boxes, links, width, height }.
 * chain: "stack" → chuỗi đầu cây (node chỉ có đúng 1 node con, vd Internet → Modem → Router)
 * xếp dọc trong 1 cột thay vì mỗi node 1 cột — sơ đồ hẹp lại, đỡ phải co chữ.
 */
export function layoutHorizontal(trees, L = LAYOUT, { chain = "row" } = {}) {
  const size = (it) => (it.kind === "port" ? [L.portW, L.portH] : [L.nodeW, L.nodeH]);
  const gap = (a, b) => (a.kind === "port" && b.kind === "port" ? L.portGap : L.rowGap);
  const measure = (it) => {
    const [, h] = size(it);
    let sum = 0;
    it.children.forEach((c, i) => {
      sum += measure(c) + (i ? gap(it.children[i - 1], c) : 0);
    });
    it._ch = sum;
    it._h = Math.max(h, sum);
    return it._h;
  };
  const boxes = [];
  const links = [];
  let width = 0;
  const place = (it, x, top, parentBox) => {
    const [w, h] = size(it);
    const y = top + (it._h - h) / 2;
    const box = { kind: it.kind, key: it.key, id: it.id, nodeId: it.nodeId, port: it.port, edge: it.edge, x, y, w, h };
    boxes.push(box);
    width = Math.max(width, x + w);
    if (parentBox) {
      links.push({
        key: it.key,
        kind: it.kind,
        edge: it.edge,
        port: it.port,
        nodeId: it.nodeId,
        x1: parentBox.x + parentBox.w, y1: parentBox.y + parentBox.h / 2,
        x2: x, y2: y + h / 2,
      });
    }
    let cy = top + (it._h - it._ch) / 2;
    it.children.forEach((c, i) => {
      if (i) cy += gap(it.children[i - 1], c);
      place(c, x + w + L.colGap, cy, box);
      cy += c._h;
    });
  };
  let top = L.pad;
  trees.forEach((t, i) => {
    const lead = [t];
    if (chain === "stack") {
      let cur = t;
      while (cur.children.length === 1 && cur.children[0].kind === "node") {
        cur = cur.children[0];
        lead.push(cur);
      }
    }
    const head = lead[lead.length - 1];
    measure(head);
    if (i) top += L.rowGap * 2;
    const b0 = boxes.length;
    const l0 = links.length;
    place(head, L.pad, top, null);
    // Các node phía trên chuỗi: chồng lên trên node đầu khối, nối bằng đoạn thẳng đứng.
    let below = boxes[b0];
    for (let k = lead.length - 2; k >= 0; k--) {
      const it = lead[k];
      const child = lead[k + 1];
      const box = { kind: "node", key: it.key, id: it.id, edge: it.edge, x: below.x, y: below.y - L.chainGap - L.nodeH, w: L.nodeW, h: L.nodeH };
      boxes.push(box);
      links.push({
        key: child.key,
        kind: "node",
        edge: child.edge,
        dir: "v",
        x1: box.x + box.w / 2, y1: box.y + box.h,
        x2: below.x + below.w / 2, y2: below.y,
      });
      below = box;
    }
    const mine = boxes.slice(b0);
    const shift = top - Math.min(...mine.map((b) => b.y));
    if (shift > 0) {
      for (const b of mine) b.y += shift;
      for (const l of links.slice(l0)) {
        l.y1 += shift;
        l.y2 += shift;
      }
    }
    top = Math.max(...mine.map((b) => b.y + b.h));
  });
  for (const t of trees) cleanup(t);
  return { boxes, links, width: width + L.pad, height: top + L.pad, mode: "horizontal" };
}

/** Số lá của một nhánh (node không con cũng tính là 1 lá). Ghi vào it._leaves. */
function countLeaves(it) {
  it._leaves = it.children.length ? it.children.reduce((n, c) => n + countLeaves(c), 0) : 1;
  return it._leaves;
}

/**
 * Chia nan quạt [a0, a1] (radian) của `it` cho các con theo trọng số nhánh: it._wt nếu có, không
 * thì số lá (chuẩn của cây vòng: lá rải đều trên vòng ngoài, nhánh đông thiết bị được cung rộng).
 */
export function allocateAngles(it, a0, a1) {
  it._a0 = a0;
  it._a1 = a1;
  const weight = (c) => c._wt ?? c._leaves;
  const total = it.children.reduce((n, c) => n + weight(c), 0);
  let a = a0;
  for (const c of it.children) {
    const b = a + ((a1 - a0) * weight(c)) / total;
    allocateAngles(c, a, b);
    a = b;
  }
}

/**
 * Gốc cho kiểu vòng: node rẽ nhánh đầu tiên (thường là router) ra giữa, chuỗi phía trên nó
 * (Modem → Internet) thành một nhánh như mọi nhánh khác. Cạnh của chuỗi đó ghi vào `via` và vẽ
 * ngược chiều (từ phía Internet vào), để hạt ↓ vẫn chạy theo hướng dữ liệu thật.
 */
export function hubRoot(root) {
  const chain = [root];
  for (let cur = root; cur.children.length === 1 && cur.children[0].kind === "node"; ) {
    cur = cur.children[0];
    chain.push(cur);
  }
  if (chain.length < 2) return root;
  let up = null;
  for (let k = 0; k < chain.length - 1; k++) up = { ...chain[k], children: up ? [up] : [], via: chain[k + 1].edge };
  const head = chain[chain.length - 1];
  return { ...head, children: [up, ...head.children] };
}

/**
 * Bố cục vòng tròn (variant "radial": node trung tâm ở giữa, các tầng là vòng đồng tâm quanh nó)
 * hoặc vòng cung ("arc": trung tâm ở đáy, toả lên nửa trên 180°). Bán kính từng vòng tính riêng:
 * đủ xa vòng trong theo kích thước ô, và đủ dài để các ô trên vòng không đè nhau (ô ở đỉnh/đáy
 * vòng chiếm cả bề ngang, ô ở hai bên chỉ chiếm bề cao).
 */
export function layoutRadial(trees, { variant = "radial", hub = true } = {}, L = LAYOUT) {
  // Nhiều gốc → gộp dưới 1 gốc ảo để chia chung một vòng.
  const root = trees.length === 1 ? (hub ? hubRoot(trees[0]) : trees[0]) : { kind: "virtual", key: "__root", children: trees };
  const span = variant === "arc" ? Math.PI : 2 * Math.PI;
  countLeaves(root);
  const size = (it) => (it.kind === "virtual" ? [0, 0] : it.kind === "port" ? [L.rPortW, L.rPortH] : [L.rNodeW, L.rNodeH]);
  let byDepth;
  const walk = (it, d) => {
    it._d = d;
    it._a = (it._a0 + it._a1) / 2;
    (byDepth[d] ||= []).push(it);
    it.children.forEach((c) => walk(c, d + 1));
  };
  // Vòng tròn: nhánh đầu (phía Internet) căn giữa ở đỉnh. Vòng cung: quét từ trái (π) qua đỉnh sang phải.
  const allocate = () => {
    const first = root.children[0];
    const w = (it) => it._wt ?? it._leaves;
    const start = variant === "arc" ? Math.PI : -Math.PI / 2 - (first ? (span * w(first)) / w(root) / 2 : 0);
    allocateAngles(root, start, start + span);
    byDepth = [];
    walk(root, 0);
  };
  allocate();
  // Lượt 2: lá ở đỉnh/đáy vòng chiếm cả bề ngang ô, lá ở hai bên chỉ chiếm bề cao → cho mỗi lá góc
  // tỉ lệ với bề rộng thật của nó (chia cho tầng: vòng ngoài dài hơn nên cần ít góc hơn).
  const weigh = (it) =>
    (it._wt = it.children.length ? it.children.reduce((n, c) => n + weigh(c), 0) : (tang(it) + L.arcPad) / Math.max(1, it._d));
  for (let pass = 0; pass < 2; pass++) {
    weigh(root);
    allocate();
  }
  // Bề rộng ô đo theo phương tiếp tuyến (dọc cung) và theo phương bán kính, tại góc của ô.
  function tang(it) {
    const [w, h] = size(it);
    return Math.abs(w * Math.sin(it._a)) + Math.abs(h * Math.cos(it._a));
  }
  const radial = (it) => {
    const [w, h] = size(it);
    return Math.abs(w * Math.cos(it._a)) + Math.abs(h * Math.sin(it._a));
  };
  const radius = [0];
  let prevRad = Math.max(...size(root));
  for (let d = 1; d < byDepth.length; d++) {
    const items = byDepth[d];
    const rad = Math.max(...items.map(radial));
    const fitRing = radius[d - 1] + (prevRad + rad) / 2 + L.ringPad;
    const fitArc = Math.max(...items.map((it) => (tang(it) + L.arcPad) / Math.max(1e-6, it._a1 - it._a0)));
    radius[d] = Math.max(fitRing, fitArc);
    prevRad = rad;
  }

  const boxes = [];
  const links = [];
  const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  const place = (it, parent) => {
    const a = it._a;
    const r = radius[it._d];
    const [x, y] = polar(r, a);
    if (it.kind !== "virtual") {
      const [w, h] = size(it);
      boxes.push({ kind: it.kind, key: it.key, id: it.id, nodeId: it.nodeId, port: it.port, edge: it.edge, x: x - w / 2, y: y - h / 2, w, h });
      if (parent && parent.kind !== "virtual") {
        const pa = parent._a;
        const pr = radius[parent._d];
        const [px, py] = polar(pr, pa);
        // Nhãn đúng điểm giữa đường cong: Bézier bậc 3 tại t = ½ = (P0 + 3·P1 + 3·P2 + P3) / 8,
        // P1/P2 là 2 điểm điều khiển trên vòng giữa (xem linkPath).
        const rm = (pr + r) / 2;
        const mid = [[pr, pa, 1], [rm, pa, 3], [rm, a, 3], [r, a, 1]].reduce(
          ([sx, sy], [rr, aa, k]) => [sx + (k * rr * Math.cos(aa)) / 8, sy + (k * rr * Math.sin(aa)) / 8],
          [0, 0],
        );
        const [lx, ly] = mid;
        const link = { key: it.key, kind: it.kind, edge: it.via || it.edge, port: it.port, nodeId: it.nodeId, lx, ly, lcls: "c" };
        // Nhánh phía Internet: vẽ từ con về cha để chiều đường = chiều dữ liệu ↓.
        if (it.via) Object.assign(link, { polar: { r1: r, a1: a, r2: pr, a2: pa }, x1: x, y1: y, x2: px, y2: py });
        else Object.assign(link, { polar: { r1: pr, a1: pa, r2: r, a2: a }, x1: px, y1: py, x2: x, y2: y });
        links.push(link);
      }
    }
    it.children.forEach((c) => place(c, it));
  };
  place(root, null);

  // Dời gốc toạ độ: khung bao các ô bắt đầu ở (pad, pad).
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const dx = L.pad - minX;
  const dy = L.pad - minY;
  for (const b of boxes) {
    b.x += dx;
    b.y += dy;
  }
  for (const l of links) {
    l.x1 += dx;
    l.y1 += dy;
    l.x2 += dx;
    l.y2 += dy;
    l.lx += dx;
    l.ly += dy;
    l.polar.cx = dx;
    l.polar.cy = dy;
  }
  const width = Math.max(...boxes.map((b) => b.x + b.w)) + L.pad;
  const height = Math.max(...boxes.map((b) => b.y + b.h)) + L.pad;
  const clean = (it) => {
    for (const k of ["_a0", "_a1", "_a", "_d", "_leaves", "_wt"]) delete it[k];
    it.children.forEach(clean);
  };
  clean(root);
  return { boxes, links, width, height, mode: variant };
}

/** Bố cục dọc (điện thoại): danh sách thụt lề, đường nối chạy dọc mép trái. */
export function layoutVertical(trees, containerWidth, L = LAYOUT) {
  const boxes = [];
  const links = [];
  let y = L.pad;
  const walk = (it, depth, parentBox) => {
    const x = L.pad + depth * L.vIndent;
    const h = it.kind === "port" ? L.vPortH : L.vNodeH;
    const w = Math.max(120, containerWidth - x - L.pad);
    const box = { kind: it.kind, key: it.key, id: it.id, nodeId: it.nodeId, port: it.port, edge: it.edge, x, y, w, h };
    boxes.push(box);
    if (parentBox) {
      links.push({
        key: it.key,
        kind: it.kind,
        edge: it.edge,
        port: it.port,
        nodeId: it.nodeId,
        x1: parentBox.x + 9, y1: parentBox.y + parentBox.h,
        x2: x, y2: y + h / 2,
      });
    }
    y += h + L.vGap;
    for (const c of it.children) walk(c, depth + 1, box);
  };
  for (const t of trees) walk(t, 0, null);
  return { boxes, links, width: containerWidth, height: y - L.vGap + L.pad, mode: "vertical" };
}

/** Đường nối kiểu danh sách: từ đáy node xuống theo trục `sx`, rẽ phải vào giữa ô con. */
function listLink(it, parentBox, box, sx) {
  return {
    key: it.key, kind: it.kind, edge: it.edge, port: it.port, nodeId: it.nodeId, dir: "list",
    x1: sx, y1: parentBox.y + parentBox.h,
    x2: box.x, y2: box.y + box.h / 2,
  };
}

/**
 * Cây dọc (trên → dưới, kiểu sơ đồ tổ chức gọn): dưới mỗi node là cột cổng thiết bị của nó
 * (xếp chồng như danh sách), các node con xếp thành hàng bên phải cột đó. Lá (thiết bị) chồng
 * dọc nên sơ đồ không bị kéo dài ngang theo số thiết bị như cây dọc thông thường.
 */
export function layoutDown(trees, L = LAYOUT) {
  const isPort = (c) => c.kind === "port";
  const measure = (it) => {
    let w = it.children.some(isPort) ? L.dIndent + L.portW : 0;
    for (const c of it.children.filter((c) => !isPort(c))) w += (w ? L.dColGap : 0) + measure(c);
    it._w = Math.max(L.nodeW, w);
    return it._w;
  };
  const boxes = [];
  const links = [];
  let width = 0;
  let height = 0;
  const place = (it, x, y, parentBox) => {
    const box = { kind: "node", key: it.key, id: it.id, edge: it.edge, x, y, w: L.nodeW, h: L.nodeH };
    boxes.push(box);
    const ports = it.children.filter(isPort);
    const kids = it.children.filter((c) => !isPort(c));
    // Cổng: chồng dưới node, nối từ trục bên trái như danh sách.
    let py = y + L.nodeH + 20;
    for (const c of ports) {
      const pb = { kind: "port", key: c.key, nodeId: c.nodeId, port: c.port, x: x + L.dIndent, y: py, w: L.portW, h: L.portH };
      boxes.push(pb);
      links.push(listLink(c, box, pb, x + 14));
      py += L.portH + L.portGap;
    }
    width = Math.max(width, x + (ports.length ? L.dIndent + L.portW : L.nodeW));
    height = Math.max(height, ports.length ? py - L.portGap : y + L.nodeH);
    // Node con: một hàng bên phải cột cổng; đường đi ngang sát đáy node rồi thả xuống.
    let cx = x + (ports.length ? L.dIndent + L.portW + L.dColGap : 0);
    const cy = y + L.nodeH + L.dRowGap;
    const busY = y + L.nodeH + 8;
    for (const c of kids) {
      const sx = x + L.nodeW / 2;
      const tx = cx + L.nodeW / 2;
      const pts = tx === sx ? [[sx, y + L.nodeH], [tx, cy]] : [[sx, y + L.nodeH], [sx, busY], [tx, busY], [tx, cy]];
      links.push({
        key: c.key, kind: "node", edge: c.edge, pts,
        x1: sx, y1: y + L.nodeH, x2: tx, y2: cy,
        lx: tx + 8, ly: (busY + cy) / 2 + 2, lcls: "v",
      });
      place(c, cx, cy, box);
      cx += c._w + L.dColGap;
    }
  };
  let x = L.pad;
  for (const t of trees) {
    measure(t);
    place(t, x, L.pad, null);
    x += t._w + L.dColGap * 2;
  }
  const clean = (it) => {
    delete it._w;
    it.children.forEach(clean);
  };
  trees.forEach(clean);
  return { boxes, links, width: width + L.pad, height: height + L.pad, mode: "down" };
}

/**
 * Thẻ: mỗi node một thẻ (đầu thẻ = node, dưới là các cổng có thiết bị), xếp lưới theo bề ngang
 * khung — thẻ vào cột đang thấp nhất (masonry), theo thứ tự cây. Đọc nhanh "switch nào đang có
 * gì", hợp cả điện thoại (1 cột) lẫn màn rộng.
 */
export function layoutCards(trees, containerWidth, L = LAYOUT) {
  const order = [];
  const walk = (it) => {
    if (it.kind !== "node") return;
    order.push(it);
    it.children.forEach(walk);
  };
  trees.forEach(walk);
  const avail = Math.max(L.cardMinW, containerWidth - 2 * L.pad);
  const cols = Math.max(1, Math.min(order.length, Math.floor((avail + L.cardGap) / (L.cardMinW + L.cardGap))));
  const cardW = Math.min(L.cardMaxW, (avail - (cols - 1) * L.cardGap) / cols);
  const colY = Array(cols).fill(L.pad);
  const boxes = [];
  const links = [];
  const frames = [];
  for (const it of order) {
    const col = colY.indexOf(Math.min(...colY));
    const fx = L.pad + col * (cardW + L.cardGap);
    const fy = colY[col];
    const box = { kind: "node", key: it.key, id: it.id, edge: it.edge, x: fx + L.cardPad, y: fy + L.cardPad, w: cardW - 2 * L.cardPad, h: L.nodeH };
    boxes.push(box);
    let y = box.y + box.h + 10;
    const ports = it.children.filter((c) => c.kind === "port");
    for (const c of ports) {
      const pb = { kind: "port", key: c.key, nodeId: c.nodeId, port: c.port, x: box.x + L.dIndent, y, w: box.w - L.dIndent, h: L.portH };
      boxes.push(pb);
      links.push(listLink(c, box, pb, box.x + 14));
      y += L.portH + L.portGap;
    }
    const fh = (ports.length ? y - L.portGap : box.y + box.h) + L.cardPad - fy;
    frames.push({ key: it.key, x: fx, y: fy, w: cardW, h: fh });
    colY[col] = fy + fh + L.cardGap;
  }
  const width = L.pad * 2 + cols * cardW + (cols - 1) * L.cardGap;
  return { boxes, links, frames, width, height: Math.max(...colY) - L.cardGap + L.pad, mode: "cards" };
}

function cleanup(it) {
  delete it._h;
  delete it._ch;
  it.children.forEach(cleanup);
}

/** Đường cong (ngang) hoặc gấp khúc bo góc (dọc) giữa 2 điểm. */
export function linkPath(l, mode) {
  const r = (n) => Math.round(n * 10) / 10;
  if (l.dir === "v") return `M${r(l.x1)} ${r(l.y1)}V${r(l.y2)}`;
  if (l.polar) {
    // Kiểu d3.linkRadial: 2 điểm điều khiển nằm trên vòng giữa, ở góc của cha và của con.
    const { r1, a1, r2, a2, cx, cy } = l.polar;
    const rm = (r1 + r2) / 2;
    const pt = (rr, a) => `${r(cx + rr * Math.cos(a))} ${r(cy + rr * Math.sin(a))}`;
    return `M${pt(r1, a1)}C${pt(rm, a1)} ${pt(rm, a2)} ${pt(r2, a2)}`;
  }
  if (l.pts) {
    // Đường gấp khúc vuông góc, bo góc bằng cung Q (bán kính ≤ 8, không quá nửa đoạn ngắn).
    const P = l.pts;
    let d = `M${r(P[0][0])} ${r(P[0][1])}`;
    for (let i = 1; i < P.length - 1; i++) {
      const [ax, ay] = P[i - 1];
      const [bx, by] = P[i];
      const [cx, cy] = P[i + 1];
      const lin = Math.hypot(bx - ax, by - ay);
      const lout = Math.hypot(cx - bx, cy - by);
      const rad = Math.min(8, lin / 2, lout / 2);
      const p1 = [bx - ((bx - ax) / lin) * rad, by - ((by - ay) / lin) * rad];
      const p2 = [bx + ((cx - bx) / lout) * rad, by + ((cy - by) / lout) * rad];
      d += `L${r(p1[0])} ${r(p1[1])}Q${r(bx)} ${r(by)} ${r(p2[0])} ${r(p2[1])}`;
    }
    const z = P[P.length - 1];
    return `${d}L${r(z[0])} ${r(z[1])}`;
  }
  if (mode === "vertical" || l.dir === "list") {
    const rad = Math.min(8, Math.abs(l.y2 - l.y1), Math.abs(l.x2 - l.x1));
    return `M${r(l.x1)} ${r(l.y1)}V${r(l.y2 - rad)}Q${r(l.x1)} ${r(l.y2)} ${r(l.x1 + rad)} ${r(l.y2)}H${r(l.x2)}`;
  }
  const mx = (l.x1 + l.x2) / 2;
  return `M${r(l.x1)} ${r(l.y1)}C${r(mx)} ${r(l.y1)} ${r(mx)} ${r(l.y2)} ${r(l.x2)} ${r(l.y2)}`;
}

/** Chọn bố cục + tỉ lệ co cho vừa bề ngang khung. */
export function fitLayout(trees, width, opts = {}) {
  const breakpoint = opts.breakpoint ?? 600;
  const minScale = opts.minScale ?? 0.55;
  const maxScale = opts.maxScale ?? 1;
  const mode = opts.layout ?? "auto";
  if (mode === "radial" || mode === "arc" || mode === "down" || mode === "cards") {
    const g =
      mode === "down" ? layoutDown(trees) : mode === "cards" ? layoutCards(trees, width) : layoutRadial(trees, { variant: mode });
    const scale = Math.min(maxScale, width / g.width);
    return { ...g, scale, offsetX: Math.max(0, (width - g.width * scale) / 2) };
  }
  if (mode !== "vertical") {
    const h = layoutHorizontal(trees, LAYOUT, { chain: opts.chain ?? "row" });
    const scale = Math.min(maxScale, width / h.width);
    if (mode === "horizontal" || (width >= breakpoint && scale >= minScale)) {
      return { ...h, scale, offsetX: Math.max(0, (width - h.width * scale) / 2) };
    }
  }
  return { ...layoutVertical(trees, width), scale: 1, offsetX: 0 };
}

/** Các kiểu xem trên nút chuyển: [layout, icon]. */
export const VIEWS = [
  ["auto", "mdi:auto-fix"],
  ["horizontal", "mdi:sitemap-outline"],
  ["down", "mdi:file-tree-outline"],
  ["radial", "mdi:hub-outline"],
  ["arc", "mdi:chart-arc"],
  ["cards", "mdi:view-dashboard-outline"],
  ["vertical", "mdi:format-list-bulleted-square"],
];

/** Bố cục không có chỗ cho nhãn trên đường nối: lưu lượng ↓/↑ ghi ngay trong ô node. */
const INLINE_TRAFFIC = new Set(["vertical", "cards"]);

// ═══════════════════════════════ Chữ ═══════════════════════════════

const STRINGS = {
  vi: {
    ports_up: (n, m) => `${n}/${m} cổng có link`,
    no_device: "không thấy thiết bị",
    no_ports: "chưa có cổng",
    tap_open: "chạm để mở",
    down_dev: "↓ về phía thiết bị",
    up_dev: "↑ từ thiết bị",
    no_link: "Không có link",
    poe: "PoE",
    moving: "đường chạy = có lưu lượng",
    top: "Đang dùng mạng nhiều nhất",
    view_auto: "Tự động",
    view_horizontal: "Sơ đồ ngang",
    view_down: "Cây dọc",
    view_radial: "Tâm – viền",
    view_arc: "Vòng cung",
    view_cards: "Thẻ",
    view_vertical: "Danh sách",
    top_none: "Không có thiết bị nào đang dùng đáng kể",
    disabled: "cổng tắt",
    traffic: "sáng viền = có lưu lượng",
    clients: (n) => `${n} thiết bị`,
    all: "Tất cả",
    busy: "bận",
    same_channel: (ch, who) => `trùng kênh ${ch} với ${who}`,
    weak: (n) => `${n} máy sóng yếu`,
    no_entity: "không thấy entity",
  },
  en: {
    ports_up: (n, m) => `${n}/${m} ports up`,
    no_device: "device not found",
    no_ports: "no ports",
    tap_open: "tap to expand",
    down_dev: "↓ towards device",
    up_dev: "↑ from device",
    no_link: "No link",
    poe: "PoE",
    moving: "moving line = traffic",
    top: "Top talkers",
    view_auto: "Auto",
    view_horizontal: "Tree",
    view_down: "Top-down",
    view_radial: "Hub",
    view_arc: "Arc",
    view_cards: "Cards",
    view_vertical: "List",
    top_none: "No device is using noticeable bandwidth",
    disabled: "port disabled",
    traffic: "glowing edge = traffic",
    clients: (n) => `${n} clients`,
    all: "All",
    busy: "busy",
    same_channel: (ch, who) => `same channel ${ch} as ${who}`,
    weak: (n) => `${n} weak signal`,
    no_entity: "entity not found",
  },
};

export function strings(lang) {
  return String(lang || "").toLowerCase().startsWith("vi") ? STRINGS.vi : STRINGS.en;
}

// ═══════════════════════════════ Phần tử Lovelace ═══════════════════════════════

async function loadLit() {
  const fromHa = () => {
    const el = customElements.get("ha-panel-lovelace") || customElements.get("hui-view") || customElements.get("ha-card");
    if (!el) return null;
    let base = Object.getPrototypeOf(el);
    while (base && base !== HTMLElement && !(base.prototype && base.prototype.html && base.prototype.css)) {
      base = Object.getPrototypeOf(base);
    }
    return base && base.prototype?.html ? { LitElement: base, html: base.prototype.html, css: base.prototype.css } : null;
  };
  let lit = fromHa();
  if (!lit) {
    await Promise.race([customElements.whenDefined("ha-card"), new Promise((r) => setTimeout(r, 3000))]);
    lit = fromHa();
  }
  if (!lit) {
    // Frontend HA không còn gắn html/css lên LitElement → nạp Lit (bản ghim) từ CDN.
    const m = await import("https://cdn.jsdelivr.net/npm/lit@3.2.1/+esm");
    lit = { LitElement: m.LitElement, html: m.html, css: m.css };
  }
  return lit;
}

async function defineCard() {
  const { LitElement, html, css } = await loadLit();
  const SVG_NS = "http://www.w3.org/2000/svg";

  class LanTopoCard extends LitElement {
    static get properties() {
      return { hass: { attribute: false }, _config: { state: true }, _width: { state: true }, _expanded: { state: true } };
    }

    static getStubConfig() {
      return {
        title: "LAN",
        nodes: [
          { id: "internet", type: "internet", name: "Internet" },
          { id: "router", type: "router", name: "Router" },
        ],
        edges: [{ from: "internet", to: "router" }],
      };
    }

    setConfig(config) {
      const topo = normalizeConfig(config);
      this._topo = topo;
      try {
        const saved = localStorage.getItem(`lan-topo-card:view:${config.title || "default"}`);
        this._view = VIEWS.some(([m]) => m === saved && m !== "auto") ? saved : null;
      } catch (_e) {
        this._view = null;
      }
      const motion = ["auto", "off"].includes(config.motion) ? config.motion : "on";
      this.setAttribute("motion", motion);
      this._config = config;
      this._multi = config.expand === "multi" || config.expanded === "all";
      this._expanded = initialExpanded(topo, config.expanded, this._multi);
      this._discovered = null;
    }

    getCardSize() {
      return Math.max(3, Math.ceil((this._lastHeight || 300) / 50));
    }

    getGridOptions() {
      return { columns: "full", min_columns: 6 };
    }

    connectedCallback() {
      super.connectedCallback();
      this._ro = new ResizeObserver(() => this._measure());
      this._ro.observe(this);
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this._ro?.disconnect();
    }

    _measure() {
      const vp = this.renderRoot?.querySelector(".viewport");
      const w = Math.floor(vp?.clientWidth || this.clientWidth || 0);
      if (w && Math.abs(w - (this._width || 0)) >= 2) this._width = w;
    }

    shouldUpdate(changed) {
      if (changed.size > 1 || !changed.has("hass")) return true;
      const old = changed.get("hass");
      if (!old || !this._tracked) return true;
      if (old.entities !== this.hass.entities || old.devices !== this.hass.devices) return true;
      for (const id of this._tracked) if (old.states[id] !== this.hass.states[id]) return true;
      return false;
    }

    /** Danh sách entity cổng của mỗi node — dò lại khi registry đổi hoặc mỗi phút. */
    _discover() {
      const h = this.hass;
      const now = Date.now();
      const d = this._discovered;
      if (d && d.entities === h.entities && d.devices === h.devices && now - d.at < (d.empty ? 5000 : 60000)) return d.map;
      const map = new Map();
      const errors = new Map();
      let empty = false;
      for (const node of this._topo.nodes.values()) {
        if (!node.ports) continue;
        try {
          const defs = discoverPorts({ entities: h.entities, devices: h.devices, states: h.states }, node);
          if (!defs.length) {
            empty = true;
            errors.set(node.id, "no_device");
          }
          map.set(node.id, defs);
        } catch (err) {
          errors.set(node.id, err.message);
          map.set(node.id, []);
        }
      }
      this._discovered = { entities: h.entities, devices: h.devices, at: now, map, errors, empty };
      return map;
    }

    _infoText(value) {
      if (value === undefined || value === null) return "";
      const s = String(value);
      if (ENTITY_RE.test(s) && this.hass.states[s]) {
        this._tracked.add(s);
        const st = this.hass.states[s];
        const unit = st.attributes?.unit_of_measurement;
        return unit ? `${st.state} ${unit}` : st.state;
      }
      return s;
    }

    _toggle(node) {
      const next = new Set(this._multi ? this._expanded : []);
      if (this._expanded.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      this._expanded = next;
    }

    _moreInfo(entityId) {
      if (!entityId) return;
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
    }

    render() {
      if (!this._config || !this.hass) return html``;
      const cfg = this._config;
      const T = strings(cfg.language || this.hass.locale?.language || this.hass.language);
      const locale = this.hass.locale?.language || "en";
      const states = this.hass.states;
      const idleBps = (cfg.idle_kbps ?? 20) * 1e3;
      this._idleBpsTop = idleBps;
      this._heatOpts = { warmMbps: cfg.warm_mbps ?? 10, hotMbps: cfg.hot_mbps ?? 50 };
      this._tracked = new Set();

      // Cổng từng node
      const defsByNode = this._discover();
      const portsByNode = new Map();
      for (const [id, defs] of defsByNode) {
        const ports = defs.map((d) => readPort(states, d));
        ports.forEach((p) => p.entities.forEach((e) => this._tracked.add(e)));
        portsByNode.set(id, ports);
      }
      const leaves = new Map();
      for (const [id, ports] of portsByNode) {
        const node = this._topo.nodes.get(id);
        leaves.set(id, visiblePorts(node, ports, linkPortsOf(this._topo, id), { showAll: node.show_all_ports || cfg.show_all_ports, idleBps }));
      }
      const traffic = new Map();
      for (const e of this._topo.edges) {
        const t = edgeTraffic(e, portsByNode, states);
        t.entities.forEach((id) => this._tracked.add(id));
        traffic.set(e.key, t);
      }

      const trees = buildTree(this._topo, this._expanded, leaves);
      const width = this._width || 0;
      const lay = width
        ? fitLayout(trees, width, {
            layout: this._view || cfg.layout,
            chain: cfg.chain ?? "stack",
            breakpoint: cfg.breakpoint,
            minScale: cfg.min_scale,
            maxScale: cfg.max_scale,
          })
        : null;
      this._lay = lay;
      this._traffic = traffic;
      this._idleBps = idleBps;
      const height = lay ? lay.height * lay.scale : 0;
      this._lastHeight = height;

      return html`
        <ha-card>
          ${cfg.title || cfg.subtitle || cfg.view_switch !== false
            ? html`<div class="head">
                ${cfg.title ? html`<div class="title">${cfg.title}</div>` : ""}
                ${cfg.subtitle ? html`<div class="sub">${cfg.subtitle}</div>` : ""}
                ${cfg.view_switch === false ? "" : this._renderViewSwitch(T)}
              </div>`
            : ""}
          <div class="viewport ${lay?.mode || ""}" style="height:${height}px">
            ${lay
              ? html`<div class="stage" style="width:${lay.width}px;height:${lay.height}px;transform:translate(${lay.offsetX}px,0) scale(${lay.scale})">
                  ${(lay.frames || []).map((f) => html`<div class="frame" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px"></div>`)}
                  <svg class="edges" width=${lay.width} height=${lay.height} viewBox="0 0 ${lay.width} ${lay.height}"></svg>
                  ${lay.boxes.map((b) => (b.kind === "node" ? this._renderNode(b, lay, portsByNode, traffic, T, locale) : this._renderPort(b, lay, T, locale)))}
                  ${INLINE_TRAFFIC.has(lay.mode) ? "" : lay.links.filter((l) => l.kind === "node").map((l) => this._renderEdgeLabel(l, traffic, locale))}
                </div>`
              : ""}
          </div>
          ${cfg.top === 0 || cfg.top === false ? "" : this._renderTop(portsByNode, T, locale)}
          ${cfg.legend === false ? "" : this._renderLegend(T)}
        </ha-card>
      `;
    }

    _renderNode(b, lay, portsByNode, traffic, T, locale) {
      const node = this._topo.nodes.get(b.id);
      const ports = portsByNode.get(b.id);
      const err = this._discovered?.errors?.get(b.id);
      const expandable = !!node.ports;
      const expanded = this._expanded.has(b.id);
      const up = ports ? ports.filter((p) => p.linked).length : 0;
      const t = b.edge ? traffic.get(b.edge.key) : null;
      const status = [];
      if (ports) status.push(err ? (err === "no_device" ? T.no_device : err) : T.ports_up(up, ports.length));
      if (INLINE_TRAFFIC.has(lay.mode) && t && b.edge.label !== false && (t.down !== null || t.up !== null)) {
        status.push(`↓${formatRate(t.down, locale)} ↑${formatRate(t.up, locale)}`);
      }
      const count = Number(node.count) > 1 ? Number(node.count) : 0;
      const info = this._infoText(node.info);
      const onClick = () => (expandable ? this._toggle(node) : this._moreInfo(node.entity));
      return html`<div
        class="node ${node.type} ${expandable || node.entity ? "clickable" : ""} ${expanded ? "expanded" : ""} ${count ? "stack" : ""} ${err ? "warn" : ""}"
        style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--c:${node.color}"
        title=${expandable ? T.tap_open : ""}
        @click=${onClick}
      >
        <div class="row1">
          <ha-icon .icon=${node.icon}></ha-icon>
          <span class="name">${node.name}</span>
          ${count ? html`<span class="badge">×${count}</span>` : ""}
          ${expandable ? html`<ha-icon class="chev" .icon=${expanded ? "mdi:chevron-left" : "mdi:chevron-right"}></ha-icon>` : ""}
        </div>
        ${info ? html`<div class="line">${info}</div>` : ""}
        ${status.length ? html`<div class="line st">${status.join(" · ")}</div>` : ""}
      </div>`;
    }

    _renderPort(b, lay, T, locale) {
      const p = b.port;
      const node = this._topo.nodes.get(b.nodeId);
      const meta = node.portNames[p.name] || {};
      const color = speedColor(p.speedMbps, p.linked !== false);
      // Tên: YAML port_names → thiết bị integration tìm được → comment của cổng → tên cổng.
      const label = meta.name || p.device || p.comment || p.name;
      const ip = meta.ip || (meta.name ? null : p.deviceIp);
      // Tốc độ link là chip riêng cạnh tên (không bị cắt "…" như dòng phụ).
      const chip = p.linked ? speedLabel(p.speedMbps) : T.no_link;
      const sub = [label !== p.name ? p.name : null, ip].filter(Boolean).join(" · ");
      const total = (p.txBps ?? 0) + (p.rxBps ?? 0);
      const heat = heatLevel(total, this._heatOpts);
      return html`<div
        class="port ${p.linked ? "" : "down"} ${p.entity ? "clickable" : ""} heat${heat}"
        style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--c:${color};--u:${usagePct(total).toFixed(1)}%"
        @click=${() => this._moreInfo(p.entity)}
      >
        <div class="pmain">
          ${meta.icon ? html`<ha-icon .icon=${meta.icon}></ha-icon>` : ""}
          <span class="pname">${label}</span>
          ${chip ? html`<span class="speed">${chip}</span>` : ""}
          ${poeOn(p, meta) ? html`<ha-icon class="poe" icon="mdi:flash"></ha-icon>` : ""}
        </div>
        <div class="prate">↓${formatRate(p.txBps, locale)}</div>
        <div class="psub">${sub}</div>
        <div class="prate up">↑${formatRate(p.rxBps, locale)}</div>
      </div>`;
    }

    _renderTop(portsByNode, T, locale) {
      const limit = Number.isFinite(Number(this._config.top)) ? Number(this._config.top) : 5;
      const rows = topTalkers(this._topo, portsByNode, { limit, idleBps: this._idleBpsTop });
      return html`<div class="top">
        <div class="thead"><ha-icon icon="mdi:podium"></ha-icon>${T.top}</div>
        ${rows.length
          ? rows.map((r, i) => {
              // Bảng xếp hạng: thanh tỉ lệ thẳng so với máy đứng đầu (log làm 369 vs 25 Mbps trông gần bằng nhau).
              const pct = Math.max(2, (r.total / rows[0].total) * 100);
              const downPart = r.total ? (r.down / r.total) * pct : 0;
              const heat = heatLevel(r.total, this._heatOpts);
              return html`<div class="trow heat${heat} ${r.port.entity ? "clickable" : ""}" @click=${() => this._moreInfo(r.port.entity)}>
                <span class="rank">${i + 1}</span>
                <div class="tname">
                  <span class="n">${r.icon ? html`<ha-icon .icon=${r.icon}></ha-icon>` : ""}${r.name}</span>
                  <span class="w">${r.nodeName} · ${r.port.name}</span>
                </div>
                <div class="tbar"><i class="d" style="width:${downPart.toFixed(1)}%"></i><i class="u" style="width:${(pct - downPart).toFixed(1)}%"></i></div>
                <div class="tval"><span class="d">↓${formatRate(r.down, locale)}</span><span class="u">↑${formatRate(r.up, locale)}</span></div>
              </div>`;
            })
          : html`<div class="tnone">${T.top_none}</div>`}
      </div>`;
    }

    _viewKey() {
      return `lan-topo-card:view:${this._config.title || "default"}`;
    }

    _setView(mode) {
      this._view = mode === "auto" ? null : mode;
      try {
        if (this._view) localStorage.setItem(this._viewKey(), this._view);
        else localStorage.removeItem(this._viewKey());
      } catch (_e) {
        /* chế độ riêng tư / chặn lưu trữ: chỉ nhớ trong phiên */
      }
      this.requestUpdate();
    }

    _renderViewSwitch(T) {
      const cur = this._view || "auto";
      const btn = (mode, icon, label) =>
        html`<button class="vbtn ${cur === mode ? "on" : ""}" title=${label} @click=${() => this._setView(mode)}>
          <ha-icon .icon=${icon}></ha-icon><span>${label}</span>
        </button>`;
      return html`<div class="vswitch">
        ${VIEWS.map(([mode, icon]) => btn(mode, icon, T[`view_${mode}`]))}
      </div>`;
    }

    _renderEdgeLabel(l, traffic, locale) {
      if (l.edge?.label === false) return "";
      const t = traffic.get(l.edge.key);
      if (!t || (t.down === null && t.up === null)) return "";
      if (l.lx !== undefined) {
        // Bố cục tự chọn chỗ đặt nhãn (vòng: giữa đường cong; cây dọc: cạnh đoạn thả xuống).
        return html`<div class="elabel ${l.lcls || "c"}" style="left:${l.lx}px;top:${l.ly}px">
          <span class="d">↓ ${formatRate(t.down, locale)}</span><span class="u">↑ ${formatRate(t.up, locale)}</span>
        </div>`;
      }
      if (l.dir === "v") {
        // Đoạn đứng của chuỗi xếp chồng: nhãn đặt bên phải đường, giữa đoạn.
        return html`<div class="elabel v" style="left:${l.x1 + 9}px;top:${(l.y1 + l.y2) / 2}px">
          <span class="d">↓ ${formatRate(t.down, locale)}</span><span class="u">↑ ${formatRate(t.up, locale)}</span>
        </div>`;
      }
      // Sát node con, nơi đường cong đã nằm ngang — giữa đường thì đè lên chùm đường của cột cổng.
      const x = l.x2 - Math.min(52, (l.x2 - l.x1) / 2);
      const y = l.y2 - 5;
      return html`<div class="elabel" style="left:${x}px;top:${y}px">
        <span class="d">↓ ${formatRate(t.down, locale)}</span><span class="u">↑ ${formatRate(t.up, locale)}</span>
      </div>`;
    }

    _renderLegend(T) {
      const lang = T === STRINGS.vi ? "vi" : "en";
      return html`<div class="legend">
        ${SPEED_TIERS.map((t) => html`<span><i style="--c:${t.color}"></i>${t[lang]}</span>`)}
        <span><i style="--c:${NO_LINK_COLOR}"></i>${T.no_link}</span>
        <span class="sep">${T.down_dev}</span><span class="up">${T.up_dev}</span>
        <span><ha-icon icon="mdi:flash"></ha-icon>${T.poe}</span>
      </div>`;
    }

    firstUpdated() {
      this._measure();
    }

    updated() {
      if (!this._width) this._measure();
      this._syncEdges();
    }

    /**
     * Vẽ đường nối bằng SVG thật, giữ phần tử cũ theo key và chỉ đổi thuộc tính khi khác —
     * tạo lại path mỗi lần cập nhật sẽ khởi động lại animation (đường giật).
     */
    _syncEdges() {
      const svg = this.renderRoot.querySelector("svg.edges");
      const lay = this._lay;
      if (!svg || !lay) return;
      const want = new Map();
      for (const l of lay.links) {
        const d = linkPath(l, lay.mode);
        let down;
        let up;
        let color;
        let w;
        let hot = "";
        if (l.kind === "node") {
          const t = this._traffic.get(l.edge.key) || {};
          down = t.down;
          up = t.up;
          color = speedColor(t.speedMbps, t.linked !== false);
          w = t.speedMbps >= 10000 ? 3.6 : t.speedMbps >= 1000 ? 2.8 : 2.2;
          if (t.speedMbps) {
            const util = Math.max(down || 0, up || 0) / (t.speedMbps * 1e6);
            hot = util >= 0.7 ? "hot" : util >= 0.4 ? "warm" : "";
          }
        } else {
          down = l.port.txBps;
          up = l.port.rxBps;
          color = speedColor(l.port.speedMbps, l.port.linked !== false);
          w = 1.6;
        }
        // Ống mờ = dung lượng link; 2 sợi ↓/↑ dày theo lưu lượng thật (log), tách 2 bên ống.
        const cap = l.kind === "node" ? 5.6 : 4;
        const wd = flowWidth(down, { max: cap });
        const wu = flowWidth(up, { max: cap });
        const base = Math.max(w, wd + wu + 1);
        const off = (wd + wu) / 4 + 0.6;
        const upright = lay.mode === "vertical" || l.dir === "v" || l.dir === "list";
        const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1) || 1;
        const nx = -(l.y2 - l.y1) / len; // pháp tuyến của đoạn cha → con
        const ny = (l.x2 - l.x1) / len;
        const r2 = (n) => Math.round(n * 10) / 10;
        const tr = (sign) =>
          l.polar
            ? `translate(${r2(sign * off * nx)} ${r2(sign * off * ny)})`
            : l.pts
              ? `translate(${r2(sign * off * 0.7)} ${r2(sign * off * 0.7)})` // gấp khúc ↓ → : lệch chéo = lệch đều cả 2 phương
              : upright
              ? `translate(${sign * off} 0)`
              : `translate(0 ${sign * off})`;
        const r1 = (n) => Math.round(n * 10) / 10;
        want.set(`${l.key}|b`, { d, cls: `base ${hot}`, style: `--c:${color};--w:${r1(base)}px` });
        want.set(`${l.key}|d`, { d, cls: `flow down lv${flowLevel(down, this._idleBps)}`, style: `--c:${color};--fw:${r1(wd)}px`, tr: tr(-1) });
        want.set(`${l.key}|u`, { d, cls: `flow up lv${flowLevel(up, this._idleBps)}`, style: `--c:${color};--fw:${r1(wu)}px`, tr: tr(1) });
      }
      for (const el of [...svg.children]) {
        if (!want.has(el.dataset.k)) el.remove();
      }
      const existing = new Map([...svg.children].map((el) => [el.dataset.k, el]));
      for (const [k, a] of want) {
        let el = existing.get(k);
        if (!el) {
          el = document.createElementNS(SVG_NS, "path");
          el.dataset.k = k;
          svg.appendChild(el);
        }
        if (el.getAttribute("d") !== a.d) el.setAttribute("d", a.d);
        if (el.getAttribute("class") !== a.cls) el.setAttribute("class", a.cls);
        if (el.getAttribute("style") !== a.style) el.setAttribute("style", a.style);
        if ((el.getAttribute("transform") || "") !== (a.tr || "")) {
          if (a.tr) el.setAttribute("transform", a.tr);
          else el.removeAttribute("transform");
        }
      }
    }

    static get styles() {
      return css`
        :host {
          display: block;
          --ltc-bg: radial-gradient(120% 140% at 0% 0%, #142443 0%, #0a1122 55%, #060a14 100%);
          --ltc-fg: #e6edf7;
          --ltc-dim: #8ea3c2;
          --ltc-panel: rgba(14, 24, 46, 0.86);
          --ltc-border: rgba(120, 160, 255, 0.18);
          --ltc-up: #e879f9;
        }
        ha-card {
          background: var(--ltc-bg);
          color: var(--ltc-fg);
          border-radius: var(--ha-card-border-radius, 18px);
          border: 1px solid var(--ltc-border);
          box-shadow: inset 0 0 28px rgba(56, 189, 248, 0.07), 0 0 18px rgba(56, 189, 248, 0.06);
          overflow: hidden;
        }
        .head {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 4px 12px;
          padding: 14px 16px 2px;
        }
        .title {
          font-size: 1.1rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
        }
        .sub {
          color: var(--ltc-dim);
          font-size: 0.82rem;
        }
        .viewport {
          position: relative;
          overflow: hidden;
          width: 100%;
        }
        .stage {
          position: absolute;
          top: 0;
          left: 0;
          transform-origin: 0 0;
        }
        svg.edges {
          position: absolute;
          top: 0;
          left: 0;
          overflow: visible;
          pointer-events: none;
        }
        path {
          fill: none;
          stroke-linecap: round;
        }
        path.base {
          stroke: var(--c);
          stroke-opacity: 0.18;
          stroke-width: var(--w);
          transition: stroke-width 0.6s;
        }
        path.base.warm {
          stroke-opacity: 0.55;
          filter: drop-shadow(0 0 4px #f59e0b);
        }
        path.base.hot {
          stroke-opacity: 0.7;
          filter: drop-shadow(0 0 6px #ef4444);
        }
        path.flow {
          stroke-width: var(--fw);
          stroke-dasharray: 2 16;
          transition: stroke-width 0.6s;
          opacity: 0;
        }
        path.flow.down {
          stroke: var(--c);
        }
        path.flow.up {
          stroke: var(--ltc-up);
        }
        path.flow.lv1,
        path.flow.lv2,
        path.flow.lv3,
        path.flow.lv4,
        path.flow.lv5 {
          opacity: 0.95;
          animation: ltc-flow linear infinite;
        }
        path.flow.up.lv1,
        path.flow.up.lv2,
        path.flow.up.lv3,
        path.flow.up.lv4,
        path.flow.up.lv5 {
          animation-direction: reverse;
        }
        path.flow.lv1 { animation-duration: 2.6s; }
        path.flow.lv2 { animation-duration: 1.7s; }
        path.flow.lv3 { animation-duration: 1.1s; }
        path.flow.lv4 { animation-duration: 0.7s; }
        path.flow.lv5 { animation-duration: 0.42s; }
        @keyframes ltc-flow {
          to {
            stroke-dashoffset: -18;
          }
        }
        /* Hạt chạy là thông tin (có lưu lượng / nhanh chậm) → mặc định luôn chạy, kể cả khi hệ điều
           hành bật "giảm chuyển động". motion: auto = tôn trọng thiết lập đó, motion: off = tắt hẳn. */
        :host([motion="off"]) path.flow {
          animation: none !important;
        }
        @media (prefers-reduced-motion: reduce) {
          :host([motion="auto"]) path.flow {
            animation: none !important;
          }
        }
        .node,
        .port {
          position: absolute;
          box-sizing: border-box;
          background: var(--ltc-panel);
          overflow: hidden;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
        }
        .node {
          border-radius: 14px;
          border: 1px solid color-mix(in srgb, var(--c) 60%, transparent);
          box-shadow: 0 0 14px color-mix(in srgb, var(--c) 30%, transparent),
            inset 0 0 14px color-mix(in srgb, var(--c) 12%, transparent);
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 2px;
          transition: box-shadow 0.2s, border-color 0.2s;
        }
        .node.stack {
          overflow: visible;
          box-shadow: 5px -5px 0 -1px color-mix(in srgb, var(--c) 35%, #0a1122),
            10px -10px 0 -2px color-mix(in srgb, var(--c) 20%, #0a1122),
            0 0 14px color-mix(in srgb, var(--c) 30%, transparent);
        }
        .node.expanded {
          border-color: var(--c);
          box-shadow: 0 0 22px color-mix(in srgb, var(--c) 55%, transparent),
            inset 0 0 16px color-mix(in srgb, var(--c) 18%, transparent);
        }
        .node.warn .st {
          color: #fbbf24;
        }
        .clickable {
          cursor: pointer;
        }
        .node.clickable:hover,
        .port.clickable:hover {
          filter: brightness(1.15);
        }
        .row1 {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          font-size: 0.92rem;
          white-space: nowrap;
          min-width: 0;
        }
        ha-icon {
          --mdc-icon-size: 18px;
          color: var(--c);
          filter: drop-shadow(0 0 4px var(--c));
          flex: none;
        }
        .name,
        .pname {
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }
        .badge {
          font-size: 0.72rem;
          padding: 0 6px;
          border-radius: 8px;
          background: color-mix(in srgb, var(--c) 22%, transparent);
          color: var(--c);
        }
        .chev {
          margin-left: auto;
          --mdc-icon-size: 16px;
          opacity: 0.8;
        }
        .line {
          font-size: 0.76rem;
          color: var(--ltc-dim);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .port {
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
          border-left: 4px solid var(--c);
          box-shadow: 0 0 10px color-mix(in srgb, var(--c) 22%, transparent);
          padding: 3px 8px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-content: center;
          column-gap: 6px;
          font-size: 0.78rem;
        }
        .port.down {
          opacity: 0.7;
        }
        /* thanh mức dùng ở đáy ô cổng (log: 10 kbps → 0, 1 Gbps → 100%) */
        .port::after {
          content: "";
          position: absolute;
          left: 0;
          bottom: 0;
          height: 3px;
          width: var(--u, 0%);
          background: linear-gradient(90deg, #22d3ee, #a78bfa, #f472b6);
          box-shadow: 0 0 6px #a78bfa;
          border-radius: 0 2px 2px 0;
          transition: width 0.6s;
        }
        .port.heat1 {
          border-top-color: #fbbf24;
          border-right-color: #fbbf24;
          border-bottom-color: #fbbf24;
          box-shadow: 0 0 14px rgba(251, 191, 36, 0.55);
        }
        .port.heat1 .prate,
        .port.heat2 .prate {
          font-weight: 700;
          font-size: 0.76rem;
        }
        .port.heat2 {
          border-top-color: #fb7185;
          border-right-color: #fb7185;
          border-bottom-color: #fb7185;
          animation: ltc-hot 1.6s ease-in-out infinite;
        }
        @keyframes ltc-hot {
          50% {
            box-shadow: 0 0 22px rgba(251, 113, 133, 0.85);
          }
        }
        .top {
          margin: 4px 14px 2px;
          padding: 8px 10px;
          border-radius: 14px;
          background: rgba(14, 24, 46, 0.7);
          border: 1px solid var(--ltc-border);
        }
        .thead {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.82rem;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .thead ha-icon {
          --c: #fbbf24;
          --mdc-icon-size: 16px;
        }
        .trow {
          display: grid;
          grid-template-columns: 22px minmax(120px, 1.2fr) minmax(60px, 2fr) auto;
          align-items: center;
          gap: 10px;
          padding: 4px 4px;
          border-radius: 8px;
        }
        .trow.clickable {
          cursor: pointer;
        }
        .trow:hover {
          background: rgba(255, 255, 255, 0.04);
        }
        .rank {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: 0.72rem;
          font-weight: 700;
          background: rgba(255, 255, 255, 0.08);
        }
        .trow.heat1 .rank {
          background: #fbbf24;
          color: #1a1205;
        }
        .trow.heat2 .rank {
          background: #fb7185;
          color: #1a0509;
          box-shadow: 0 0 8px #fb7185;
        }
        .tname {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .tname .n {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 0.8rem;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tname .n ha-icon {
          --mdc-icon-size: 14px;
          --c: #94a3b8;
        }
        .tname .w {
          font-size: 0.68rem;
          color: var(--ltc-dim);
        }
        .tbar {
          height: 8px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.07);
          overflow: hidden;
          display: flex;
        }
        .tbar i {
          display: block;
          height: 100%;
          transition: width 0.6s;
        }
        .tbar i.d {
          background: #38bdf8;
          box-shadow: 0 0 6px #38bdf8;
        }
        .tbar i.u {
          background: var(--ltc-up);
          box-shadow: 0 0 6px var(--ltc-up);
        }
        .tval {
          display: flex;
          justify-content: flex-end;
          min-width: 13.5em; /* cột số cố định → các thanh thẳng hàng, so độ dài chính xác */
          gap: 8px;
          font-size: 0.74rem;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .tval .d {
          color: #7dd3fc;
        }
        .tval .u {
          color: var(--ltc-up);
        }
        .tnone {
          font-size: 0.76rem;
          color: var(--ltc-dim);
        }
        /* Khổ hẹp: hàng 1 = hạng | tên | số, hàng 2 = thanh trải dưới tên + số (đặt ô tường minh,
           để grid tự xếp thì cột số rơi xuống ô 22 px bên trái và tràn mép). */
        @media (max-width: 600px) {
          .trow {
            grid-template-columns: 22px minmax(0, 1fr) auto;
            row-gap: 4px;
          }
          .rank {
            grid-column: 1;
            grid-row: 1 / 3;
          }
          .tname {
            grid-column: 2;
            grid-row: 1;
          }
          .tval {
            grid-column: 3;
            grid-row: 1;
            min-width: 0;
            flex-direction: column;
            align-items: flex-end;
            gap: 0;
          }
          .tbar {
            grid-column: 2 / 4;
            grid-row: 2;
          }
        }
        .port ha-icon {
          --mdc-icon-size: 14px;
        }
        .port .speed {
          flex: none;
          font-size: 0.62rem;
          font-weight: 600;
          line-height: 1;
          padding: 2px 4px;
          border-radius: 5px;
          color: var(--c);
          background: color-mix(in srgb, var(--c) 18%, transparent);
          border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
        }
        .port .poe {
          color: #fbbf24;
          --c: #fbbf24;
        }
        .pmain {
          display: flex;
          align-items: center;
          gap: 4px;
          font-weight: 600;
          white-space: nowrap;
          min-width: 0;
        }
        .psub {
          color: var(--ltc-dim);
          font-size: 0.7rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .prate {
          font-size: 0.7rem;
          text-align: right;
          white-space: nowrap;
          color: var(--c);
          font-variant-numeric: tabular-nums;
        }
        .prate.up,
        .elabel .u,
        .legend .up {
          color: var(--ltc-up);
        }
        .elabel {
          position: absolute;
          transform: translate(-50%, -100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          font-size: 0.68rem;
          line-height: 1.25;
          padding: 2px 6px;
          border-radius: 8px;
          background: rgba(6, 10, 20, 0.82);
          border: 1px solid var(--ltc-border);
          white-space: nowrap;
          pointer-events: none;
          font-variant-numeric: tabular-nums;
        }
        .elabel .d {
          color: #7dd3fc;
        }
        .elabel.v {
          transform: translate(0, -50%);
          align-items: flex-start;
        }
        .elabel.c {
          transform: translate(-50%, -50%);
        }
        .frame {
          position: absolute;
          box-sizing: border-box;
          border-radius: 16px;
          border: 1px solid var(--ltc-border);
          background: rgba(10, 18, 36, 0.45);
        }
        .vswitch {
          margin-left: auto;
          display: inline-flex;
          gap: 2px;
          padding: 2px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--ltc-border);
        }
        .vbtn {
          font: inherit;
          font-size: 0.72rem;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: var(--ltc-dim);
          cursor: pointer;
        }
        .vbtn ha-icon {
          --mdc-icon-size: 15px;
          --c: currentColor;
          filter: none;
        }
        .vbtn.on {
          background: rgba(34, 211, 238, 0.16);
          color: #67e8f9;
          box-shadow: 0 0 8px rgba(34, 211, 238, 0.35);
        }
        /* 7 kiểu xem: chỉ nút đang chọn hiện chữ (tên đầy đủ ở tooltip), điện thoại chỉ icon. */
        .vbtn:not(.on) span {
          display: none;
        }
        @media (max-width: 600px) {
          .vbtn span {
            display: none;
          }
        }
        .legend {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px 12px;
          padding: 6px 16px 14px;
          font-size: 0.74rem;
          color: var(--ltc-dim);
        }
        .legend i {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 3px;
          background: var(--c);
          box-shadow: 0 0 6px var(--c);
          margin-right: 5px;
          vertical-align: -1px;
        }
        .legend .sep {
          color: #7dd3fc;
        }
        .legend ha-icon {
          --mdc-icon-size: 14px;
          --c: #fbbf24;
          vertical-align: -2px;
        }
      `;
    }
  }

  /**
   * lan-ports-card — lưới cổng gọn: mỗi switch một hàng ô nhỏ, màu theo tốc độ link.
   * Cùng adapter với lan-topo-card (routeros / netgear_plus / khai báo tay). Chỉ đọc.
   */
  class LanPortsCard extends LitElement {
    static get properties() {
      return { hass: { attribute: false }, _config: { state: true } };
    }

    static getStubConfig() {
      return { title: "Ports", devices: [{ name: "Router", ports: { adapter: "routeros", device: "Router" } }] };
    }

    setConfig(config) {
      if (!config || !Array.isArray(config.devices) || !config.devices.length) {
        throw new Error("lan-ports-card: cần khai báo `devices`");
      }
      this._devices = config.devices.map((d, i) => {
        if (!d || !d.ports) throw new Error(`lan-ports-card: device ${i + 1} cần \`ports\``);
        return { ...d, name: d.name ?? `#${i + 1}`, portNames: normalizePortNames(d.port_names) };
      });
      this._config = config;
      this._discovered = null;
    }

    getCardSize() {
      return 1 + this._devices.length;
    }

    getGridOptions() {
      return { columns: "full", min_columns: 6 };
    }

    shouldUpdate(changed) {
      if (changed.size > 1 || !changed.has("hass")) return true;
      const old = changed.get("hass");
      if (!old || !this._tracked) return true;
      if (old.entities !== this.hass.entities || old.devices !== this.hass.devices) return true;
      for (const id of this._tracked) if (old.states[id] !== this.hass.states[id]) return true;
      return false;
    }

    _discover() {
      const h = this.hass;
      const now = Date.now();
      const d = this._discovered;
      if (d && d.entities === h.entities && d.devices === h.devices && now - d.at < (d.empty ? 5000 : 60000)) return d.list;
      let empty = false;
      const list = this._devices.map((dev) => {
        try {
          const defs = discoverPorts({ entities: h.entities, devices: h.devices, states: h.states }, dev);
          if (!defs.length) empty = true;
          return { defs, error: defs.length ? null : "no_device" };
        } catch (err) {
          return { defs: [], error: err.message };
        }
      });
      this._discovered = { entities: h.entities, devices: h.devices, at: now, list, empty };
      return list;
    }

    _moreInfo(entityId) {
      if (!entityId) return;
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
    }

    render() {
      if (!this._config || !this.hass) return html``;
      const cfg = this._config;
      const T = strings(cfg.language || this.hass.locale?.language || this.hass.language);
      const lang = T === STRINGS.vi ? "vi" : "en";
      const locale = this.hass.locale?.language || "en";
      const idle = (cfg.idle_kbps ?? 20) * 1e3;
      this._tracked = new Set();
      const found = this._discover();
      return html`<ha-card>
        ${cfg.title ? html`<div class="head"><div class="title">${cfg.title}</div></div>` : ""}
        <div class="rows">
          ${this._devices.map((dev, i) => {
            const { defs, error } = found[i];
            const ports = defs.map((d) => readPort(this.hass.states, d));
            ports.forEach((p) => p.entities.forEach((e) => this._tracked.add(e)));
            const up = ports.filter((p) => p.linked).length;
            return html`<div class="dev">
              <div class="dhead">
                <span class="dname">${dev.name}</span>
                <span class="dsub">${error ? (error === "no_device" ? T.no_device : error) : T.ports_up(up, ports.length)}</span>
              </div>
              <div class="ports">${ports.map((p) => this._renderPort(dev, p, T, locale, idle))}</div>
            </div>`;
          })}
        </div>
        ${cfg.legend === false
          ? ""
          : html`<div class="legend">
              ${SPEED_TIERS.map((t) => html`<span><i style="--c:${t.color}"></i>${t[lang]}</span>`)}
              <span><i class="off" style="--c:${NO_LINK_COLOR}"></i>${T.no_link}</span>
              <span><i class="dis"></i>${T.disabled}</span>
              <span class="hint">${T.traffic}</span>
              <span><ha-icon icon="mdi:flash"></ha-icon>${T.poe}</span>
            </div>`}
      </ha-card>`;
    }

    _renderPort(dev, p, T, locale, idle) {
      const meta = dev.portNames[p.name] || {};
      if (meta.hide) return "";
      const color = speedColor(p.speedMbps, p.linked !== false);
      const busy = (p.rxBps ?? 0) > idle || (p.txBps ?? 0) > idle;
      const who = meta.name || p.device || p.comment;
      const tip = [
        `${dev.name} · ${p.name}${who ? ` — ${who}` : ""}`,
        meta.ip || p.deviceIp,
        p.disabled ? T.disabled : p.linked ? speedLabel(p.speedMbps) || "" : T.no_link,
        p.linked ? `↓${formatRate(p.txBps, locale)} ↑${formatRate(p.rxBps, locale)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const cls = p.disabled ? "dis" : p.linked ? (busy ? "on busy" : "on") : "off";
      return html`<div class="pt ${cls}" style="--c:${color}" title=${tip} @click=${() => this._moreInfo(p.entity)}>
        ${portLabel(p.name)}${poeOn(p, meta) ? html`<ha-icon icon="mdi:flash"></ha-icon>` : ""}
      </div>`;
    }

    static get styles() {
      return css`
        :host {
          display: block;
          --ltc-bg: radial-gradient(120% 140% at 0% 0%, #142443 0%, #0a1122 55%, #060a14 100%);
          --ltc-fg: #e6edf7;
          --ltc-dim: #8ea3c2;
          --ltc-border: rgba(120, 160, 255, 0.18);
        }
        ha-card {
          background: var(--ltc-bg);
          color: var(--ltc-fg);
          border-radius: var(--ha-card-border-radius, 18px);
          border: 1px solid var(--ltc-border);
          box-shadow: inset 0 0 28px rgba(56, 189, 248, 0.07);
          overflow: hidden;
          padding-bottom: 4px;
        }
        .head {
          padding: 12px 16px 0;
        }
        .title {
          font-size: 1.05rem;
          font-weight: 600;
          text-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
        }
        .rows {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 10px 16px 6px;
        }
        .dhead {
          display: flex;
          align-items: baseline;
          gap: 10px;
          margin-bottom: 5px;
        }
        .dname {
          font-weight: 600;
          font-size: 0.86rem;
        }
        .dsub {
          color: var(--ltc-dim);
          font-size: 0.74rem;
        }
        .ports {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }
        .pt {
          position: relative;
          box-sizing: border-box;
          min-width: 30px;
          height: 26px;
          padding: 0 5px;
          border-radius: 7px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1px;
          font-size: 0.72rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          cursor: pointer;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
          transition: box-shadow 0.2s, filter 0.2s;
        }
        .pt.on {
          background: color-mix(in srgb, var(--c) 78%, #0a1122);
          color: #06101f;
          box-shadow: 0 0 6px color-mix(in srgb, var(--c) 45%, transparent);
        }
        .pt.on.busy {
          box-shadow: 0 0 0 1px #fff8, 0 0 11px var(--c);
        }
        .pt.off {
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.55);
          color: #fca5a5;
        }
        .pt.dis {
          background: rgba(148, 163, 184, 0.06);
          border: 1px dashed rgba(148, 163, 184, 0.45);
          color: #64748b;
        }
        .pt:hover {
          filter: brightness(1.2);
        }
        .pt ha-icon {
          --mdc-icon-size: 11px;
          color: #fde047;
        }
        .pt.on ha-icon {
          color: #713f12;
        }
        .legend {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px 12px;
          padding: 4px 16px 10px;
          font-size: 0.72rem;
          color: var(--ltc-dim);
        }
        .legend i {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 3px;
          background: var(--c);
          box-shadow: 0 0 6px var(--c);
          margin-right: 5px;
          vertical-align: -1px;
        }
        .legend i.off {
          background: transparent;
          border: 1px solid var(--c);
          box-shadow: none;
          box-sizing: border-box;
        }
        .legend i.dis {
          background: transparent;
          border: 1px dashed #94a3b8;
          box-shadow: none;
          box-sizing: border-box;
        }
        .legend ha-icon {
          --mdc-icon-size: 13px;
          color: #fde047;
          vertical-align: -2px;
        }
      `;
    }
  }

  /**
   * lan-wifi-card — thiết bị Wi-Fi theo AP (integration aruba_instant_ha): sóng, băng tần, SSID,
   * tốc độ, tải kênh từng radio, cảnh báo AP trùng kênh. Chỉ đọc.
   */
  class LanWifiCard extends LitElement {
    static get properties() {
      return {
        hass: { attribute: false },
        _config: { state: true },
        _ssid: { state: true },
        _band: { state: true },
        _narrow: { state: true },
        _toggled: { state: true },
      };
    }

    static getStubConfig() {
      return { entity: "sensor.aruba_instant_clients" };
    }

    connectedCallback() {
      super.connectedCallback();
      // Khung hẹp (điện thoại) → thu gọn từng nhóm, chạm tiêu đề để mở.
      this._ro = new ResizeObserver(() => {
        const narrow = this.clientWidth > 0 && this.clientWidth < (this._config?.breakpoint ?? 600);
        if (narrow !== this._narrow) this._narrow = narrow;
      });
      this._ro.observe(this);
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this._ro?.disconnect();
    }

    _isOpen(name) {
      const mode = this._config.collapse ?? "auto";
      const base = mode === true ? false : mode === false ? true : !this._narrow;
      return this._toggled?.has(name) ? !base : base;
    }

    _toggle(name) {
      const next = new Set(this._toggled || []);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      this._toggled = next;
    }

    setConfig(config) {
      if (!config || !config.entity) throw new Error("lan-wifi-card: cần `entity` (sensor tổng thiết bị Wi-Fi)");
      this._config = config;
      this._ssid = config.ssid ?? null;
      this._band = config.band ?? null;
      this._toggled = new Set();
    }

    getCardSize() {
      return 6;
    }

    getGridOptions() {
      return { columns: "full", min_columns: 6 };
    }

    shouldUpdate(changed) {
      if (changed.size > 1 || !changed.has("hass")) return true;
      const old = changed.get("hass");
      return !old || old.states[this._config.entity] !== this.hass.states[this._config.entity];
    }

    _chip(label, active, onClick, color) {
      return html`<button class="chip ${active ? "on" : ""}" style=${color ? `--c:${color}` : ""} @click=${onClick}>${label}</button>`;
    }

    render() {
      if (!this._config || !this.hass) return html``;
      const cfg = this._config;
      const T = strings(cfg.language || this.hass.locale?.language || this.hass.language);
      const st = this.hass.states[cfg.entity];
      if (!st) return html`<ha-card><div class="empty">${T.no_entity}: ${cfg.entity}</div></ha-card>`;
      const clients = st.attributes.clients || [];
      const aps = st.attributes.aps || {};
      const ssids = st.attributes.ssids || {};
      const bands = [...new Set(clients.map((c) => c.band).filter(Boolean))].sort();
      const by = cfg.group_by || "ap";
      const groups = groupClients(clients, { by, sort: cfg.sort || "name", ssid: this._ssid, band: this._band });
      const overlap = coChannel(aps);
      const shown = groups.reduce((n, g) => n + g.clients.length, 0);
      return html`<ha-card>
        <div class="head">
          <div class="title">${cfg.title ?? "Wi-Fi"}</div>
          <div class="sub">${T.clients(shown)}${shown !== clients.length ? ` / ${clients.length}` : ""}</div>
        </div>
        <div class="filters">
          ${this._chip(T.all, !this._ssid && !this._band, () => ((this._ssid = null), (this._band = null)))}
          ${Object.entries(ssids).map(([name, n]) => this._chip(`${name} · ${n}`, this._ssid === name, () => (this._ssid = this._ssid === name ? null : name)))}
          ${bands.map((b) => this._chip(`${b} GHz`, this._band === b, () => (this._band = this._band === b ? null : b), b === "5" ? "#a78bfa" : "#38bdf8"))}
        </div>
        <div class="groups">
          ${groups.map((g) => this._renderGroup(g, by === "ap" ? aps[g.name] : null, overlap[g.name], T))}
        </div>
      </ha-card>`;
    }

    _renderGroup(group, ap, overlap, T) {
      const open = this._isOpen(group.name);
      const weak = group.clients.filter((c) => c.quality === "poor" || (c.quality !== "good" && signalBars(c.signal) <= 1)).length;
      return html`<div class="grp ${open ? "" : "closed"}">
        <div class="ghead" @click=${() => this._toggle(group.name)}>
          <ha-icon class="chev" icon=${open ? "mdi:chevron-down" : "mdi:chevron-right"}></ha-icon>
          <ha-icon icon=${ap ? "mdi:access-point" : "mdi:wifi"}></ha-icon>
          <span class="gname">${group.name}</span>
          <span class="gsub">${T.clients(group.clients.length)}${ap?.ip ? ` · ${ap.ip}` : ""}</span>
          ${ap ? (ap.radios || []).map((r) => this._radio(r, T)) : ""}
          ${(overlap || []).map((o) => html`<span class="warn"><ha-icon icon="mdi:alert"></ha-icon>${o.band} GHz · ${T.same_channel(o.channel, o.with.join(", "))}</span>`)}
          ${weak ? html`<span class="weak">${T.weak(weak)}</span>` : ""}
        </div>
        ${open ? html`<div class="clients">${group.clients.map((c) => this._client(c))}</div>` : ""}
      </div>`;
    }

    _radio(r, T) {
      const util = Number(r.utilization) || 0;
      const col = util >= 60 ? "#ef4444" : util >= 35 ? "#f59e0b" : "#22c55e";
      return html`<span class="radio" title=${`${r.band} GHz · ch ${r.channel} · ${r.power_dbm ?? "?"} dBm · noise ${r.noise_dbm ?? "?"} dBm`}>
        <b>${r.band}G</b> ch${r.channel}
        <span class="bar"><i style="width:${Math.min(100, util)}%;background:${col}"></i></span>${util}% ${T.busy}
      </span>`;
    }

    _client(c) {
      const color = qualityColor(c.quality, c.signal);
      const bars = signalBars(c.signal);
      const tip = [c.name, c.hostname && c.hostname !== c.name ? `host: ${c.hostname}` : null, c.mac, c.os && c.os !== "NOFP" ? c.os : null, c.phy ? `PHY ${c.phy} · ch ${c.channel}` : null, c.ap]
        .filter(Boolean)
        .join("\n");
      return html`<div class="cl" style="--c:${color}" title=${tip}>
        <span class="sig">${[1, 2, 3, 4].map((i) => html`<i class=${i <= bars ? "on" : ""} style="height:${3 + i * 3}px"></i>`)}</span>
        <div class="cmain">
          <div class="cname">${c.name}</div>
          <div class="csub">${[c.ip, c.essid].filter(Boolean).join(" · ")}</div>
        </div>
        <div class="cright">
          ${c.band ? html`<span class="band b${String(c.band).replace(".", "")}">${c.band}</span>` : ""}
          <span class="spd">${c.speed_mbps ?? "—"}<small>M</small></span>
          <span class="snr">${c.signal ?? "—"}<small>dB</small></span>
        </div>
      </div>`;
    }

    static get styles() {
      return css`
        :host {
          display: block;
          --ltc-bg: radial-gradient(120% 140% at 0% 0%, #142443 0%, #0a1122 55%, #060a14 100%);
          --ltc-fg: #e6edf7;
          --ltc-dim: #8ea3c2;
          --ltc-panel: rgba(14, 24, 46, 0.86);
          --ltc-border: rgba(120, 160, 255, 0.18);
        }
        ha-card {
          background: var(--ltc-bg);
          color: var(--ltc-fg);
          border-radius: var(--ha-card-border-radius, 18px);
          border: 1px solid var(--ltc-border);
          box-shadow: inset 0 0 28px rgba(56, 189, 248, 0.07);
          overflow: hidden;
          padding-bottom: 8px;
        }
        .empty {
          padding: 16px;
          color: #fbbf24;
        }
        .head {
          display: flex;
          align-items: baseline;
          gap: 10px;
          padding: 12px 16px 4px;
        }
        .title {
          font-size: 1.05rem;
          font-weight: 600;
          text-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
        }
        .sub {
          color: var(--ltc-dim);
          font-size: 0.8rem;
        }
        .filters {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 4px 16px 6px;
        }
        .chip {
          --c: #22d3ee;
          font: inherit;
          font-size: 0.74rem;
          color: var(--ltc-fg);
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--ltc-border);
          border-radius: 999px;
          padding: 3px 10px;
          cursor: pointer;
        }
        .chip.on {
          border-color: var(--c);
          color: var(--c);
          background: color-mix(in srgb, var(--c) 14%, transparent);
          box-shadow: 0 0 8px color-mix(in srgb, var(--c) 40%, transparent);
        }
        .groups {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 4px 12px 4px;
        }
        .grp {
          background: var(--ltc-panel);
          border: 1px solid color-mix(in srgb, #60a5fa 45%, transparent);
          border-radius: 14px;
          box-shadow: 0 0 12px rgba(96, 165, 250, 0.18);
          padding: 8px 10px 10px;
        }
        .ghead {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px 10px;
          margin-bottom: 8px;
          cursor: pointer;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .grp.closed .ghead {
          margin-bottom: 0;
        }
        .ghead ha-icon.chev {
          --mdc-icon-size: 16px;
          color: var(--ltc-dim);
          filter: none;
          margin-right: -6px;
        }
        .weak {
          font-size: 0.72rem;
          color: #f87171;
        }
        .ghead ha-icon {
          --mdc-icon-size: 18px;
          color: #60a5fa;
          filter: drop-shadow(0 0 4px #60a5fa);
        }
        .gname {
          font-weight: 600;
        }
        .gsub {
          color: var(--ltc-dim);
          font-size: 0.76rem;
        }
        .radio {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 0.72rem;
          color: var(--ltc-dim);
          padding: 1px 8px;
          border: 1px solid var(--ltc-border);
          border-radius: 8px;
        }
        .radio b {
          color: var(--ltc-fg);
        }
        .bar {
          display: inline-block;
          width: 40px;
          height: 5px;
          border-radius: 3px;
          background: rgba(255, 255, 255, 0.1);
          overflow: hidden;
        }
        .bar i {
          display: block;
          height: 100%;
        }
        .warn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 0.72rem;
          color: #fbbf24;
        }
        .warn ha-icon {
          --mdc-icon-size: 14px;
          color: #fbbf24;
          filter: none;
        }
        .clients {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
          gap: 6px;
        }
        .cl {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          padding: 5px 8px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
          border-left: 3px solid var(--c);
        }
        .sig {
          display: inline-flex;
          align-items: flex-end;
          gap: 2px;
          height: 15px;
          flex: none;
        }
        .sig i {
          width: 3px;
          border-radius: 1px;
          background: rgba(255, 255, 255, 0.15);
        }
        .sig i.on {
          background: var(--c);
          box-shadow: 0 0 4px var(--c);
        }
        .cmain {
          flex: 1;
          min-width: 0;
        }
        .cname {
          font-size: 0.8rem;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .csub {
          font-size: 0.68rem;
          color: var(--ltc-dim);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cright {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: none;
          font-size: 0.7rem;
          font-variant-numeric: tabular-nums;
        }
        .cright small {
          color: var(--ltc-dim);
          margin-left: 1px;
        }
        .band {
          font-size: 0.62rem;
          font-weight: 700;
          padding: 1px 4px;
          border-radius: 5px;
          border: 1px solid currentColor;
        }
        .band.b24 {
          color: #38bdf8;
        }
        .band.b5 {
          color: #a78bfa;
        }
        .snr {
          color: var(--c);
        }
      `;
    }
  }

  if (!customElements.get("lan-wifi-card")) customElements.define("lan-wifi-card", LanWifiCard);
  if (!customElements.get("lan-ports-card")) customElements.define("lan-ports-card", LanPortsCard);
  if (!customElements.get("lan-topo-card")) customElements.define("lan-topo-card", LanTopoCard);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === "lan-topo-card")) {
    window.customCards.push({
      type: "lan-topo-card",
      name: "LAN Topo Card",
      description: "Sơ đồ mạng LAN: Internet → router → switch → cổng, đường chạy theo băng thông",
      documentationURL: "https://github.com/ngoviet/lan-topo-card",
    });
  }
  if (!window.customCards.some((c) => c.type === "lan-wifi-card")) {
    window.customCards.push({
      type: "lan-wifi-card",
      name: "LAN Wi-Fi Card",
      description: "Thiết bị Wi-Fi theo AP (Aruba Instant): sóng, băng tần, SSID, tải kênh",
      documentationURL: "https://github.com/ngoviet/lan-topo-card",
    });
  }
  if (!window.customCards.some((c) => c.type === "lan-ports-card")) {
    window.customCards.push({
      type: "lan-ports-card",
      name: "LAN Ports Card",
      description: "Lưới cổng switch gọn: mỗi switch một hàng, màu theo tốc độ link",
      documentationURL: "https://github.com/ngoviet/lan-topo-card",
    });
  }
  console.info(`%c LAN-TOPO-CARD %c v${VERSION} `, "color:#0a1122;background:#22d3ee;font-weight:700", "color:#22d3ee;background:#0a1122");
}

if (typeof window !== "undefined" && window.customElements) defineCard();
