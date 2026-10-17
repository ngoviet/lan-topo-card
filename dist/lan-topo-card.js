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

export const VERSION = "0.1.2";

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

/** Bố cục cây ngang (trái → phải). Trả { boxes, links, width, height }. */
export function layoutHorizontal(trees, L = LAYOUT) {
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
    measure(t);
    if (i) top += L.rowGap * 2;
    place(t, L.pad, top, null);
    top += t._h;
  });
  for (const t of trees) cleanup(t);
  return { boxes, links, width: width + L.pad, height: top + L.pad, mode: "horizontal" };
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

function cleanup(it) {
  delete it._h;
  delete it._ch;
  it.children.forEach(cleanup);
}

/** Đường cong (ngang) hoặc gấp khúc bo góc (dọc) giữa 2 điểm. */
export function linkPath(l, mode) {
  const r = (n) => Math.round(n * 10) / 10;
  if (mode === "vertical") {
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
  if (mode !== "vertical") {
    const h = layoutHorizontal(trees);
    const scale = Math.min(maxScale, width / h.width);
    if (mode === "horizontal" || (width >= breakpoint && scale >= minScale)) {
      return { ...h, scale, offsetX: Math.max(0, (width - h.width * scale) / 2) };
    }
  }
  return { ...layoutVertical(trees, width), scale: 1, offsetX: 0 };
}

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
        ? fitLayout(trees, width, { layout: cfg.layout, breakpoint: cfg.breakpoint, minScale: cfg.min_scale, maxScale: cfg.max_scale })
        : null;
      this._lay = lay;
      this._traffic = traffic;
      this._idleBps = idleBps;
      const height = lay ? lay.height * lay.scale : 0;
      this._lastHeight = height;

      return html`
        <ha-card>
          ${cfg.title || cfg.subtitle
            ? html`<div class="head">
                ${cfg.title ? html`<div class="title">${cfg.title}</div>` : ""}
                ${cfg.subtitle ? html`<div class="sub">${cfg.subtitle}</div>` : ""}
              </div>`
            : ""}
          <div class="viewport ${lay?.mode || ""}" style="height:${height}px">
            ${lay
              ? html`<div class="stage" style="width:${lay.width}px;height:${lay.height}px;transform:translate(${lay.offsetX}px,0) scale(${lay.scale})">
                  <svg class="edges" width=${lay.width} height=${lay.height} viewBox="0 0 ${lay.width} ${lay.height}"></svg>
                  ${lay.boxes.map((b) => (b.kind === "node" ? this._renderNode(b, lay, portsByNode, traffic, T, locale) : this._renderPort(b, lay, T, locale)))}
                  ${lay.mode === "horizontal" ? lay.links.filter((l) => l.kind === "node").map((l) => this._renderEdgeLabel(l, traffic, locale)) : ""}
                </div>`
              : ""}
          </div>
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
      if (lay.mode === "vertical" && t && b.edge.label !== false && (t.down !== null || t.up !== null)) {
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
      return html`<div
        class="port ${p.linked ? "" : "down"} ${p.entity ? "clickable" : ""}"
        style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--c:${color}"
        @click=${() => this._moreInfo(p.entity)}
      >
        <div class="pmain">
          ${meta.icon ? html`<ha-icon .icon=${meta.icon}></ha-icon>` : ""}
          <span class="pname">${label}</span>
          ${chip ? html`<span class="speed">${chip}</span>` : ""}
          ${p.poe ? html`<ha-icon class="poe" icon="mdi:flash"></ha-icon>` : ""}
        </div>
        <div class="prate">↓${formatRate(p.txBps, locale)}</div>
        <div class="psub">${sub}</div>
        <div class="prate up">↑${formatRate(p.rxBps, locale)}</div>
      </div>`;
    }

    _renderEdgeLabel(l, traffic, locale) {
      if (l.edge?.label === false) return "";
      const t = traffic.get(l.edge.key);
      if (!t || (t.down === null && t.up === null)) return "";
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
        const off = lay.mode === "horizontal" ? Math.max(1.6, w * 0.7) : 0;
        const style = `--c:${color};--w:${w}px`;
        want.set(`${l.key}|b`, { d, cls: `base ${hot}`, style });
        want.set(`${l.key}|d`, { d, cls: `flow down lv${flowLevel(down, this._idleBps)}`, style, tr: off ? `translate(0 ${-off})` : "" });
        want.set(`${l.key}|u`, { d, cls: `flow up lv${flowLevel(up, this._idleBps)}`, style, tr: off ? `translate(0 ${off})` : "" });
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
          stroke-opacity: 0.3;
          stroke-width: var(--w);
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
          stroke-width: calc(var(--w) * 0.85);
          stroke-dasharray: 3 14;
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
            stroke-dashoffset: -17;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          path.flow {
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
  console.info(`%c LAN-TOPO-CARD %c v${VERSION} `, "color:#0a1122;background:#22d3ee;font-weight:700", "color:#22d3ee;background:#0a1122");
}

if (typeof window !== "undefined" && window.customElements) defineCard();
