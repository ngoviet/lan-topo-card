import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeConfig,
  normalizePortNames,
  initialExpanded,
  buildTree,
  layoutHorizontal,
  layoutVertical,
  fitLayout,
  linkPath,
  LAYOUT,
} from "../dist/lan-topo-card.js";

// Topo thật của nhà: Internet → 5 modem → CCR2004 → CRS310 (→ GS108PE) / CRS326
const home = {
  nodes: [
    { id: "internet", type: "internet", name: "Internet" },
    { id: "modems", type: "modem", name: "Modem Viettel", count: 5 },
    { id: "ccr", type: "router", name: "CCR2004" },
    { id: "crs310", type: "switch", name: "CRS310" },
    { id: "crs326", type: "switch", name: "CRS326" },
    { id: "gs", type: "switch", name: "GS108PE" },
  ],
  edges: [
    { from: "internet", to: "modems" },
    { from: "modems", to: "ccr", to_port: ["ether1", "ether2", "ether3", "ether4", "ether5"] },
    { from: "ccr", to: "crs310", from_port: "sfp-sfpplus1" },
    { from: "ccr", to: "crs326", from_port: "sfp-sfpplus2" },
    { from: "crs310", to: "gs", from_port: "ether3", to_port: 8 },
  ],
};

const port = (name) => ({ name, linked: true, speedMbps: 1000, rxBps: 0, txBps: 0 });

test("normalizeConfig: mặc định icon/màu theo loại, cạnh có danh sách cổng", () => {
  const t = normalizeConfig(home);
  assert.deepEqual(t.roots, ["internet"]);
  assert.equal(t.nodes.get("ccr").icon, "mdi:router");
  assert.equal(t.nodes.get("unknown"), undefined);
  assert.deepEqual(t.edges[1].toPorts, ["ether1", "ether2", "ether3", "ether4", "ether5"]);
  assert.deepEqual(t.edges[4].toPorts, ["8"]); // số trong YAML → chuỗi
  assert.deepEqual(t.children.get("ccr").map((e) => e.to), ["crs310", "crs326"]);
});

test("normalizeConfig: báo lỗi rõ khi topo sai", () => {
  assert.throws(() => normalizeConfig({}), /nodes/);
  assert.throws(() => normalizeConfig({ nodes: [{ id: "a" }, { id: "a" }] }), /trùng/);
  assert.throws(() => normalizeConfig({ nodes: [{ id: "a" }], edges: [{ from: "a", to: "b" }] }), /không có node to/);
  assert.throws(
    () => normalizeConfig({ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [{ from: "a", to: "c" }, { from: "b", to: "c" }] }),
    /2 node cha/,
  );
  assert.throws(
    () => normalizeConfig({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] }),
    /vòng/,
  );
});

test("normalizePortNames: chuỗi 'tên | ip', object, false = ẩn", () => {
  assert.deepEqual(normalizePortNames({ ether7: "PC7 | 192.168.10.77", ether9: { name: "HA", icon: "mdi:home-assistant" }, ether2: false, 1: "AP" }), {
    ether7: { name: "PC7", ip: "192.168.10.77" },
    ether9: { name: "HA", icon: "mdi:home-assistant" },
    ether2: { hide: true },
    1: { name: "AP", ip: undefined },
  });
});

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test("layoutHorizontal: mỗi tầng một cột, không ô nào chồng nhau", () => {
  const topo = normalizeConfig(home);
  const ports = new Map([["crs326", ["ether9", "ether11", "ether12", "ether13", "ether14", "ether18", "ether19"].map(port)]]);
  const lay = layoutHorizontal(buildTree(topo, new Set(["crs326"]), ports));
  const by = Object.fromEntries(lay.boxes.filter((b) => b.kind === "node").map((b) => [b.id, b]));
  const col = (n) => LAYOUT.pad + n * (LAYOUT.nodeW + LAYOUT.colGap);
  assert.equal(by.internet.x, col(0));
  assert.equal(by.modems.x, col(1));
  assert.equal(by.ccr.x, col(2));
  assert.equal(by.crs310.x, col(3));
  assert.equal(by.gs.x, col(4));
  const leaves = lay.boxes.filter((b) => b.kind === "port");
  assert.equal(leaves.length, 7);
  assert.ok(leaves.every((b) => b.x === col(4) && b.nodeId === "crs326"));
  for (let i = 0; i < lay.boxes.length; i++) {
    for (let j = i + 1; j < lay.boxes.length; j++) {
      assert.ok(!overlaps(lay.boxes[i], lay.boxes[j]), `${lay.boxes[i].key} chồng ${lay.boxes[j].key}`);
    }
  }
  // node cha nằm giữa khối con
  const kids = lay.boxes.filter((b) => b.nodeId === "crs326");
  const mid = (kids[0].y + kids.at(-1).y + kids.at(-1).h) / 2;
  assert.ok(Math.abs(by.crs326.y + by.crs326.h / 2 - mid) < 0.01);
  // mỗi ô (trừ gốc) có đúng 1 đường nối tới cha
  assert.equal(lay.links.length, lay.boxes.length - 1);
  assert.ok(lay.width >= col(4) + LAYOUT.portW);
  assert.ok(lay.boxes.every((b) => b.y + b.h <= lay.height && b.x + b.w <= lay.width));
});

test("buildTree: lá cổng đứng trước node con", () => {
  const topo = normalizeConfig(home);
  const [root] = buildTree(topo, new Set(["crs310"]), new Map([["crs310", [port("ether4"), port("ether5")]]]));
  const crs310 = root.children[0].children[0].children[0];
  assert.equal(crs310.id, "crs310");
  assert.deepEqual(crs310.children.map((c) => c.key), ["crs310:ether4", "crs310:ether5", "gs"]);
});

test("fitLayout: co vừa bề ngang khung, không bao giờ tràn", () => {
  const topo = normalizeConfig(home);
  const trees = buildTree(topo, new Set(["crs310"]), new Map([["crs310", [port("ether4"), port("ether5")]]]));
  for (const w of [1900, 1480, 1200, 1000, 800]) {
    const lay = fitLayout(trees, w);
    assert.equal(lay.mode, "horizontal", `w=${w}`);
    assert.ok(lay.width * lay.scale <= w + 0.01, `w=${w}: ${lay.width * lay.scale}`);
    assert.ok(lay.scale <= 1);
  }
  // khung rộng thì không phóng to quá 1, căn giữa
  const wide = fitLayout(trees, 3000);
  assert.equal(wide.scale, 1);
  assert.ok(wide.offsetX > 0);
});

test("fitLayout: điện thoại (< 600 px) hoặc co quá nhỏ → bố cục dọc", () => {
  const topo = normalizeConfig(home);
  const trees = buildTree(topo, new Set(), new Map());
  const phone = fitLayout(trees, 390);
  assert.equal(phone.mode, "vertical");
  assert.equal(phone.scale, 1);
  assert.ok(phone.boxes.every((b) => b.x + b.w <= 390));
  const narrow = fitLayout(trees, 700, { minScale: 0.9 });
  assert.equal(narrow.mode, "vertical");
  assert.equal(fitLayout(trees, 390, { layout: "horizontal" }).mode, "horizontal");
  assert.equal(fitLayout(trees, 1900, { layout: "vertical" }).mode, "vertical");
});

test("layoutVertical: thụt lề theo tầng, xếp dọc không chồng", () => {
  const topo = normalizeConfig(home);
  const trees = buildTree(topo, new Set(["gs"]), new Map([["gs", [port("1"), port("2")]]]));
  const lay = layoutVertical(trees, 390);
  const keys = lay.boxes.map((b) => b.key);
  assert.deepEqual(keys, ["internet", "modems", "ccr", "crs310", "gs", "gs:1", "gs:2", "crs326"]);
  const gs = lay.boxes.find((b) => b.key === "gs");
  assert.equal(gs.x, LAYOUT.pad + 4 * LAYOUT.vIndent);
  assert.equal(lay.boxes.find((b) => b.key === "gs:1").x, gs.x + LAYOUT.vIndent);
  for (let i = 1; i < lay.boxes.length; i++) assert.ok(lay.boxes[i].y >= lay.boxes[i - 1].y + lay.boxes[i - 1].h);
});

test("linkPath: cong ngang, gấp khúc dọc", () => {
  assert.equal(linkPath({ x1: 0, y1: 10, x2: 100, y2: 50 }, "horizontal"), "M0 10C50 10 50 50 100 50");
  assert.match(linkPath({ x1: 10, y1: 0, x2: 40, y2: 80 }, "vertical"), /^M10 0V72Q10 80 18 80H40$/);
});

test("initialExpanded: all = mọi node có cổng; single chỉ giữ node đầu", () => {
  const topo = normalizeConfig({
    nodes: [{ id: "a" }, { id: "b", ports: [] }, { id: "c", ports: [] }],
    edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }],
  });
  assert.deepEqual([...initialExpanded(topo, "all", true)], ["b", "c"]);
  assert.deepEqual([...initialExpanded(topo, ["c", "b", "x"], false)], ["c"]);
  assert.deepEqual([...initialExpanded(topo, ["c", "b"], true)], ["c", "b"]);
  assert.deepEqual([...initialExpanded(topo, undefined, false)], []);
});

test("chain: stack — Internet → Modem → CCR xếp dọc 1 cột, sơ đồ hẹp lại, không chồng ô", () => {
  const topo = normalizeConfig(home);
  const trees = buildTree(topo, new Set(["crs326"]), new Map([["crs326", ["ether9", "ether11"].map(port)]]));
  const row = layoutHorizontal(trees);
  const stack = layoutHorizontal(trees, LAYOUT, { chain: "stack" });
  const by = Object.fromEntries(stack.boxes.filter((b) => b.kind === "node").map((b) => [b.id, b]));
  assert.equal(by.internet.x, LAYOUT.pad);
  assert.equal(by.modems.x, LAYOUT.pad);
  assert.equal(by.ccr.x, LAYOUT.pad);
  assert.ok(by.internet.y < by.modems.y && by.modems.y < by.ccr.y); // trên → dưới theo chiều dữ liệu
  assert.equal(by.crs310.x, LAYOUT.pad + LAYOUT.nodeW + LAYOUT.colGap); // nhánh rẽ ngay cột kế
  assert.equal(stack.width, row.width - 2 * (LAYOUT.nodeW + LAYOUT.colGap));
  assert.ok(stack.boxes.every((b) => b.y >= LAYOUT.pad - 0.01 && b.y + b.h <= stack.height));
  for (let i = 0; i < stack.boxes.length; i++)
    for (let j = i + 1; j < stack.boxes.length; j++) assert.ok(!overlaps(stack.boxes[i], stack.boxes[j]));
  const v = stack.links.filter((l) => l.dir === "v");
  assert.deepEqual(v.map((l) => l.key).sort(), ["ccr", "modems"]);
  assert.equal(linkPath(v[0], "horizontal").startsWith("M"), true);
  assert.match(linkPath(v[0], "horizontal"), /^M[\d.]+ [\d.]+V[\d.]+$/);
});

test("chain: stack dừng ở node rẽ nhánh hoặc node đang mở cột cổng", () => {
  const topo = normalizeConfig(home);
  // CCR mở cột cổng → chỉ Internet + Modem chồng lên CCR? Không: CCR có con là lá cổng + 2 switch → chuỗi dừng ở CCR
  const trees = buildTree(topo, new Set(["ccr"]), new Map([["ccr", [port("ether9")]]]));
  const stack = layoutHorizontal(trees, LAYOUT, { chain: "stack" });
  const by = Object.fromEntries(stack.boxes.filter((b) => b.kind === "node").map((b) => [b.id, b]));
  assert.equal(by.ccr.x, LAYOUT.pad);
  const flat = normalizeConfig({ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }] });
  const t2 = layoutHorizontal(buildTree(flat, new Set(), new Map()), LAYOUT, { chain: "stack" });
  assert.ok(t2.links.every((l) => l.dir !== "v")); // gốc rẽ nhánh ngay → không có chuỗi
});

// ── Kiểu vòng (radial / arc) ──────────────────────────────────────────────
import { layoutRadial, allocateAngles, hubRoot, layoutDown, layoutCards, VIEWS } from "../dist/lan-topo-card.js";

function radialTrees() {
  const topo = normalizeConfig(home);
  return buildTree(topo, new Set(["crs326", "gs"]), new Map([
    ["crs326", ["ether9", "ether11", "ether12", "ether13"].map(port)],
    ["gs", ["1", "2", "3", "4"].map(port)],
  ]));
}

test("allocateAngles: con nằm trọn trong nan quạt cha, không chồng nhau, phủ kín", () => {
  const [root] = radialTrees();
  const count = (it) => (it._leaves = it.children.length ? it.children.reduce((n, c) => n + count(c), 0) : 1);
  count(root);
  allocateAngles(root, 0, 2 * Math.PI);
  const check = (it) => {
    if (!it.children.length) return;
    const eps = 1e-9;
    let prev = it._a0;
    for (const c of it.children) {
      assert.ok(c._a0 >= it._a0 - eps && c._a1 <= it._a1 + eps, `${c.key} ra ngoài nan quạt ${it.key}`);
      assert.ok(c._a1 > c._a0, `${c.key} có nan quạt rỗng`);
      assert.ok(c._a0 >= prev - eps, `${c.key} chồng lên anh em`);
      prev = c._a1;
      check(c);
    }
  };
  check(root);
});

const noOverlap = (boxes) => {
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlaps(boxes[i], boxes[j]), `${boxes[i].key} đè ${boxes[j].key}`);
};

test("hubRoot: router (node rẽ nhánh đầu tiên) làm tâm, chuỗi Modem → Internet thành nhánh, cạnh ghi ở via", () => {
  const [root] = radialTrees();
  const hub = hubRoot(root);
  assert.equal(hub.id, "ccr");
  assert.equal(hub.children[0].id, "modems");
  assert.equal(hub.children[0].via.key, root.children[0].children[0].edge.key); // cạnh modem → ccr
  assert.equal(hub.children[0].children[0].id, "internet");
  assert.equal(hub.children[0].children[0].via.key, root.children[0].edge.key); // cạnh internet → modem
  const flat = normalizeConfig({ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }] });
  const [t] = buildTree(flat, new Set(), new Map());
  assert.equal(hubRoot(t), t); // gốc rẽ nhánh ngay → giữ nguyên
});

test("layoutRadial: router ở tâm, tầng càng sâu càng xa tâm, không ô nào đè nhau", () => {
  for (const variant of ["radial", "arc"]) {
    const lay = layoutRadial(radialTrees(), { variant });
    assert.equal(lay.mode, variant);
    const c = (b) => [b.x + b.w / 2, b.y + b.h / 2];
    const by = Object.fromEntries(lay.boxes.filter((b) => b.kind === "node").map((b) => [b.id, b]));
    const [ox, oy] = c(by.ccr);
    const dist = (b) => Math.hypot(c(b)[0] - ox, c(b)[1] - oy);
    assert.ok(Math.abs(dist(by.modems) - dist(by.crs310)) < 0.01); // cùng vòng 1
    assert.ok(dist(by.modems) < dist(by.internet) && dist(by.crs310) < dist(by.gs));
    noOverlap(lay.boxes);
    assert.ok(Math.min(...lay.boxes.map((b) => b.x)) >= LAYOUT.pad - 0.01);
    assert.ok(Math.min(...lay.boxes.map((b) => b.y)) >= LAYOUT.pad - 0.01);
    assert.ok(lay.boxes.every((b) => b.x + b.w <= lay.width + 0.01 && b.y + b.h <= lay.height + 0.01));
    assert.equal(lay.links.length, lay.boxes.length - 1);
    assert.match(linkPath(lay.links[0], variant), /^M[-\d.]+ [-\d.]+C/);
    // Nhánh phía Internet vẽ ngược: đường bắt đầu ở Internet, kết thúc ở modem.
    const li = lay.links.find((l) => l.key === "internet");
    assert.equal(li.edge.to, "modems");
    assert.deepEqual([li.x1, li.y1].map(Math.round), c(by.internet).map(Math.round));
    if (variant === "arc") assert.ok(lay.boxes.every((b) => b.y + b.h / 2 <= oy + 0.01), "vòng cung: mọi node ở nửa trên tâm");
  }
});

test("layoutDown: node trên, cột cổng chồng dưới, node con xếp hàng bên phải, không đè", () => {
  const lay = layoutDown(radialTrees());
  assert.equal(lay.mode, "down");
  const by = Object.fromEntries(lay.boxes.filter((b) => b.kind === "node").map((b) => [b.id, b]));
  assert.ok(by.internet.y < by.modems.y && by.modems.y < by.ccr.y && by.ccr.y < by.crs310.y);
  assert.equal(by.internet.x, by.ccr.x); // chuỗi không cổng: thẳng một cột
  assert.equal(by.crs310.y, by.crs326.y); // anh em cùng hàng
  const p326 = lay.boxes.filter((b) => b.kind === "port" && b.nodeId === "crs326");
  assert.ok(p326.every((b) => b.x === by.crs326.x + LAYOUT.dIndent && b.y > by.crs326.y));
  const pgs = lay.boxes.filter((b) => b.kind === "port" && b.nodeId === "gs");
  assert.ok(pgs.every((b) => b.x === by.gs.x + LAYOUT.dIndent));
  noOverlap(lay.boxes);
  assert.ok(lay.boxes.every((b) => b.x + b.w <= lay.width + 0.01 && b.y + b.h <= lay.height + 0.01));
  const toCrs326 = lay.links.find((l) => l.key === "crs326");
  assert.match(linkPath(toCrs326, "down"), /^M[\d.]+ [\d.]+L.*Q.*L[\d.]+ [\d.]+$/);
  assert.match(linkPath(lay.links.find((l) => l.key === "modems"), "down"), /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+$/); // thẳng
});

test("layoutCards: mỗi node một thẻ, số cột theo bề ngang, cổng nằm trong thẻ của nó", () => {
  const wide = layoutCards(radialTrees(), 1200);
  assert.equal(wide.mode, "cards");
  assert.equal(wide.frames.length, 6);
  assert.ok(wide.width <= 1200 + 0.01);
  noOverlap(wide.frames);
  noOverlap(wide.boxes);
  for (const b of wide.boxes) {
    const f = wide.frames.find((f) => f.key === (b.kind === "port" ? b.nodeId : b.id));
    assert.ok(b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w + 0.01 && b.y + b.h <= f.y + f.h + 0.01, `${b.key} ra ngoài thẻ`);
  }
  const phone = layoutCards(radialTrees(), 360);
  assert.equal(new Set(phone.frames.map((f) => f.x)).size, 1); // 1 cột
  assert.ok(phone.width <= 360 + 0.01);
  assert.equal(linkPath(phone.links[0], "cards").includes("Q"), true);
});

test("fitLayout: chọn radial/arc theo yêu cầu, co vừa bề ngang", () => {
  const lay = fitLayout(radialTrees(), 1200, { layout: "radial" });
  assert.equal(lay.mode, "radial");
  assert.ok(lay.width * lay.scale <= 1200 + 0.01);
});

test("fitLayout: cây dọc / thẻ theo yêu cầu, mọi kiểu trên nút chuyển đều có bố cục", () => {
  for (const [mode] of VIEWS) {
    const lay = fitLayout(radialTrees(), 1000, { layout: mode });
    if (mode !== "auto") assert.equal(lay.mode, mode);
    assert.ok(lay.width * lay.scale <= 1000 + 0.01, mode);
  }
});
