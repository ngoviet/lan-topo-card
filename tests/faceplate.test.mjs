import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeConfig,
  buildTree,
  layoutHorizontal,
  layoutDown,
  routeWires,
  fitLayout,
  linkPath,
  faceplateSpec,
  portPanel,
  panelLayout,
  planWires,
  portState,
  wireTraffic,
  FACE_METRICS,
  LAYOUT,
} from "../dist/lan-topo-card.js";

const port = (name, extra = {}) => ({ name, linked: false, speedMbps: null, rxBps: null, txBps: null, poe: null, disabled: false, ...extra });
const ethers = (n, extra) => Array.from({ length: n }, (_, i) => port(`ether${i + 1}`, extra));

test("faceplateSpec: khớp tiền tố model, YAML ghi đè, faceplate: false tắt", () => {
  const ports = { adapter: "routeros" };
  assert.equal(faceplateSpec({ ports }, { model: "CRS326-24G-2S+RM" }).sfp, "right");
  assert.equal(faceplateSpec({ ports: { adapter: "netgear_plus", prefix: "gs108pe" } }, undefined).rows, 1);
  assert.equal(faceplateSpec({ ports, faceplate: { rows: 1 } }, { model: "CRS326-24G-2S+RM" }).rows, 1);
  assert.deepEqual(faceplateSpec({ ports }, { model: "Lạ" }), {});
  assert.equal(faceplateSpec({ ports, faceplate: false }, { model: "CRS326-24G-2S+RM" }), null);
  assert.equal(faceplateSpec({}, { model: "CRS326-24G-2S+RM" }), null);
});

test("portPanel: chẵn hàng trên, chia cụm, SFP riêng; số lẻ cuối vẫn ở hàng dưới", () => {
  const p = portPanel([...ethers(5), port("sfp-sfpplus1")], { rows: 2, top: "even", block: 2 });
  assert.equal(p.rows, 2);
  assert.equal(p.blocks.length, 2);
  assert.deepEqual(p.blocks[0].map((c) => c.map((x) => x.name)), [["ether2", "ether1"], ["ether4", "ether3"]]);
  assert.equal(p.blocks[1][0][0], null);
  assert.equal(p.blocks[1][0][1].name, "ether5");
  assert.equal(p.sfp[0].name, "sfp-sfpplus1");
});

test("portPanel: model lạ — ≤ 10 cổng một hàng, nhiều hơn hai hàng", () => {
  assert.equal(portPanel(ethers(10)).rows, 1);
  assert.equal(portPanel(ethers(11)).rows, 2);
});

test("panelLayout: khớp cỡ ô, SFP nằm hàng dưới, cụm xuống dòng khi hẹp", () => {
  const panel = portPanel([...ethers(16), port("sfp-sfpplus1"), port("sfp-sfpplus2")], { rows: 2, top: "even", block: 4, sfp: "left" });
  const f = panelLayout(panel);
  assert.equal(f.cells.length, 18);
  assert.equal(f.h, 32);
  assert.equal(f.w, 46 + 8 + 70 + 6 + 70);
  const s1 = f.cells.find((c) => c.port.name === "sfp-sfpplus1");
  assert.deepEqual([s1.x, s1.y], [0, 17]);
  assert.equal(f.cells.find((c) => c.port.name === "ether1").y, 17);
  assert.equal(f.cells.find((c) => c.port.name === "ether2").y, 0);
  const narrow = panelLayout(panel, FACE_METRICS.touch, 200);
  assert.ok(narrow.w <= 200);
  assert.ok(narrow.h > FACE_METRICS.touch.cellH * 2 + 2);
});

test("portState: trống ≠ lỗi; chỉ cổng phải có link mới đỏ", () => {
  assert.equal(portState(port("ether1")), "off");
  assert.equal(portState(port("ether1"), { linkPort: true }), "fault");
  assert.equal(portState(port("ether1"), { meta: { name: "PC" } }), "fault");
  assert.equal(portState(port("ether1"), { meta: { name: "PC", optional: true } }), "off");
  assert.equal(portState(port("ether1", { linked: null }), { linkPort: true }), "off");
  assert.equal(portState(port("ether1", { disabled: true }), { linkPort: true }), "dis");
});

test("portState: chậm hơn kỳ vọng, uplink, PoE", () => {
  const p = port("ether18", { linked: true, speedMbps: 10 });
  assert.equal(portState(p, { expect: 1000 }), "on slow");
  assert.equal(portState(p, { expect: 1000, meta: { expect_speed: false } }), "on");
  assert.equal(portState(p, { meta: { expect_speed: "10M" }, expect: 1000 }), "on");
  assert.equal(portState(port("8", { linked: true, poe: true }), { uplink: true }), "on uplink poe");
  assert.equal(portState(port("8", { linked: true, poe: true }), { meta: { poe: false } }), "on");
});

// Topo nhà: dải cổng cho router + 2 switch, modem không có dải.
const homeTopo = () =>
  normalizeConfig({
    nodes: [
      { id: "inet", type: "internet" },
      { id: "modem", type: "modem" },
      { id: "ccr", ports: [] },
      { id: "a", ports: [] },
      { id: "b", ports: [] },
    ],
    edges: [
      { from: "inet", to: "modem" },
      { from: "modem", to: "ccr", to_port: ["ether1", "ether2", "ether3"] },
      { from: "ccr", to: "a", from_port: "sfp-sfpplus1", to_port: "sfp-sfpplus1" },
      { from: "ccr", to: "b", from_port: "sfp-sfpplus2", to_port: "sfp-sfpplus1" },
    ],
  });
const panelOf = (ports) => ({ panel: portPanel(ports, { rows: 2, top: "even", block: 4 }), head: 68 });
const homePanels = () =>
  new Map([
    ["ccr", panelOf([...ethers(8), port("sfp-sfpplus1"), port("sfp-sfpplus2")])],
    ["a", panelOf([...ethers(8), port("sfp-sfpplus1")])],
    ["b", panelOf([...ethers(24), port("sfp-sfpplus1")])],
  ]);

test("planWires: mỗi cổng một dây; cổng không có ô bị bỏ; không có ô → []", () => {
  const topo = homeTopo();
  const [, wan, up] = topo.edges;
  const panels = homePanels();
  assert.deepEqual(planWires(wan, panels).map((w) => [w.from, w.to]), [[null, "ether1"], [null, "ether2"], [null, "ether3"]]);
  assert.deepEqual(planWires(up, panels), [{ from: "sfp-sfpplus1", to: "sfp-sfpplus1", i: 0 }]);
  assert.deepEqual(planWires(topo.edges[0], panels), []);
  assert.deepEqual(planWires(up, new Map()), []);
  assert.deepEqual(planWires({ ...up, fromPorts: ["ether99"], toPorts: ["ether98"] }, panels), []);
});

test("planWires: cổng ẩn một đầu không làm lệch cặp; một cổng cha nối nhiều cổng con vẫn đủ dây", () => {
  const panels = new Map([
    ["r", panelOf([port("sfp1")])],
    ["s", panelOf([port("sfp1"), port("sfp2")])],
  ]);
  const hidden = { from: "r", to: "s", fromPorts: ["sfp1", "sfp2"], toPorts: ["sfp1", "sfp2"] };
  assert.deepEqual(planWires(hidden, panels).map((w) => [w.from, w.to]), [["sfp1", "sfp1"], [null, "sfp2"]]);
  const topo = normalizeConfig({
    nodes: [{ id: "r", ports: [] }, { id: "s", ports: [] }],
    edges: [{ from: "r", to: "s", from_port: "sfp1", to_port: ["sfp1", "sfp2"] }],
  });
  const lay = fitLayout(buildTree(topo, new Set(), new Map(), panels), 1200, { layout: "horizontal" });
  const keys = lay.links.filter((l) => l.wire).map((l) => l.key);
  assert.equal(new Set(keys).size, 2);
});

const tree = (panels = homePanels(), opts) => buildTree(homeTopo(), new Set(), new Map(), panels, opts);
const nodeBoxes = (lay) => lay.boxes.filter((b) => b.kind === "node");

for (const [name, make] of [
  ["ngang", () => routeWires(layoutHorizontal(tree(), LAYOUT, { chain: "stack" }))],
  ["cây dọc", () => routeWires(layoutDown(tree()))],
]) {
  test(`routeWires (${name}): dây vuông góc, không xuyên thẻ, không vượt khung`, () => {
    const lay = make();
    const wires = lay.links.filter((l) => l.wire);
    assert.equal(wires.length, 5);
    for (const l of wires) {
      for (let i = 0; i + 1 < l.pts.length; i++) {
        const [ax, ay] = l.pts[i];
        const [bx, by] = l.pts[i + 1];
        assert.ok(ax === bx || ay === by, `${l.key}: đoạn ${i} phải vuông góc`);
        for (const b of nodeBoxes(lay)) {
          const touches = Math.min(ax, bx) < b.x + b.w && Math.max(ax, bx) > b.x && Math.min(ay, by) < b.y + b.h && Math.max(ay, by) > b.y;
          const own = (i === 0 && b.id === l.edge.from) || (i === l.pts.length - 2 && b.id === l.edge.to);
          assert.ok(!touches || own, `${l.key}: đoạn ${i} xuyên thẻ ${b.id}`);
        }
        assert.ok(Math.max(ax, bx) <= lay.width && Math.max(ay, by) <= lay.height && Math.min(ax, bx) >= 0, `${l.key} vượt khung`);
      }
      assert.ok(!linkPath(l, lay.mode).includes("NaN"));
    }
  });
}

test("routeWires: dây vào cổng hàng trên chạy theo khe, không đè ô hàng dưới", () => {
  const lay = routeWires(layoutHorizontal(tree(), LAYOUT, { chain: "stack" }));
  const ccr = lay.boxes.find((b) => b.id === "ccr");
  const e2 = lay.links.find((l) => l.wire?.to === "ether2");
  const [x] = e2.pts[e2.pts.length - 1];
  const cx = ccr.x + ccr.face.x + ccr.face.cells.find((c) => c.port.name === "ether1").x;
  assert.ok(x < cx && x > cx - FACE_METRICS.full.gap - 0.5);
});

test("routeWires: cổng càng phải làn càng sâu (dây vào cùng thẻ không cắt nhau)", () => {
  const lay = routeWires(layoutHorizontal(tree(), LAYOUT, { chain: "stack" }));
  const list = lay.links.filter((l) => l.edge.to === "ccr").sort((a, b) => a.x2 - b.x2);
  const laneOf = (l) => l.pts[l.pts.length - 2][1];
  for (let i = 1; i < list.length; i++) assert.ok(laneOf(list[i]) > laneOf(list[i - 1]));
  assert.equal(list.filter((l) => l.wire.label).length, 1);
});

test("Cạnh có dây vào cổng không xếp chồng; cạnh thường vẫn xếp chồng", () => {
  const lay = layoutHorizontal(tree(), LAYOUT, { chain: "stack" });
  const by = (id) => lay.boxes.find((b) => b.id === id);
  assert.equal(by("inet").x, by("modem").x);
  assert.ok(by("ccr").x > by("modem").x + by("modem").w);
});

test("wires: node → giữ đường nối thẻ–thẻ, thẻ vẫn có dải cổng", () => {
  const lay = routeWires(layoutHorizontal(tree(homePanels(), { wires: "node" }), LAYOUT, { chain: "stack" }));
  assert.equal(lay.wired, false);
  assert.ok(lay.boxes.find((b) => b.id === "ccr").face);
  assert.ok(lay.links.every((l) => !l.wire));
});

test("Không có panels (mẫu đơn giản): bố cục y hệt bản cũ", () => {
  const lay = fitLayout(tree(new Map()), 1200, { layout: "horizontal", chain: "stack" });
  assert.ok(nodeBoxes(lay).every((b) => b.w === LAYOUT.nodeW && b.h === LAYOUT.nodeH && !b.face));
  assert.equal(lay.wired, false);
  assert.equal(new Set(nodeBoxes(lay).filter((b) => ["inet", "modem", "ccr"].includes(b.id)).map((b) => b.x)).size, 1);
});

test("Mọi kiểu xem dựng được với dải cổng, thẻ không đè nhau", () => {
  for (const layout of ["horizontal", "down", "radial", "arc", "cards", "vertical"]) {
    const lay = fitLayout(tree(), 1200, { layout, chain: "stack" });
    const bs = nodeBoxes(lay);
    assert.ok(bs.find((b) => b.id === "ccr").face, layout);
    bs.forEach((a, i) =>
      bs.slice(i + 1).forEach((b) => {
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!hit, `${layout}: ${a.id} đè ${b.id}`);
      }),
    );
  }
});

test("wireTraffic: một dây dùng số cả cạnh; nhiều dây tách theo cổng", () => {
  const edge = { from: "m", to: "ccr", speed: undefined };
  const whole = { down: 9, up: 9, speedMbps: 1000, linked: true };
  const p1 = port("ether1", { linked: true, speedMbps: 1000, rxBps: 5, txBps: 2 });
  const byNode = new Map([["ccr", [p1]]]);
  assert.equal(wireTraffic(edge, { from: null, to: "ether1" }, 1, byNode, whole), whole);
  const t = wireTraffic(edge, { from: null, to: "ether1" }, 5, byNode, whole);
  assert.deepEqual([t.down, t.up, t.speedMbps, t.linked], [5, 2, 1000, true]);
  const q = wireTraffic({ ...edge, from: "ccr", to: "m" }, { from: "ether1", to: null }, 2, byNode, whole);
  assert.deepEqual([q.down, q.up], [2, 5]);
  assert.equal(wireTraffic(edge, { from: null, to: "ether9" }, 5, byNode, whole), whole);
});
