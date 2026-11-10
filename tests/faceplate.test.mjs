import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeConfig,
  buildTree,
  layoutHorizontal,
  layoutDown,
  routeWires,
  fitLayout,
  layoutVertical,
  layoutCards,
  detailMode,
  linkPath,
  faceplateSpec,
  portPanel,
  panelLayout,
  planWires,
  portState,
  wireTraffic,
  deviceOfNode,
  portPeer,
  portRows,
  branchNodes,
  readPort,
  faceBox,
  deviceIp,
  deviceStats,
  uptimeParts,
  portsBehind,
  FACE_METRICS,
  LAYOUT,
  stepCell,
} from "../dist/lan-topo-card.js";

const port = (name, extra = {}) => ({ name, linked: false, speedMbps: null, rxBps: null, txBps: null, poe: null, disabled: false, ...extra });
const ethers = (n, extra) => Array.from({ length: n }, (_, i) => port(`ether${i + 1}`, extra));

test("faceplateSpec: khớp tiền tố model, YAML ghi đè, faceplate: false tắt", () => {
  const ports = { adapter: "routeros" };
  assert.equal(faceplateSpec({ ports }, { model: "CRS326-24G-2S+RM" }).sfp, "right");
  assert.equal(faceplateSpec({ ports }, { model: "CRS310-8G+2S+IN" }).sfp, "left");
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
// Khung ô như trình duyệt vẽ: .pface định vị trong padding box của .node (viền 1 px); bán kính = path.plug.
const NODE_BORDER = 1;
const PLUG_R = 2.25;
const cellRect = (box, name) => {
  const c = box.face.cells.find((cell) => cell.port.name === name);
  const left = box.x + NODE_BORDER + box.face.x + c.x;
  const top = box.y + NODE_BORDER + box.face.y + c.y;
  return { left, top, right: left + c.w, bottom: top + c.h };
};

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

for (const [name, make] of [
  ["ngang", () => routeWires(layoutHorizontal(tree(), LAYOUT, { chain: "stack" }))],
  ["cây dọc", () => routeWires(layoutDown(tree()))],
]) {
  test(`routeWires (${name}): phần dây ngoài thẻ dày hết cỡ vẫn không đè dây bên cạnh, không lấn vào thẻ`, () => {
    const lay = make();
    const wires = lay.links.filter((l) => l.wire);
    const segs = wires.flatMap((l) =>
      l.wire.outer.slice(1).map((q, i) => ({ key: l.key, room: l.wire.room, p: l.wire.outer[i], q })),
    );
    for (const s of segs) {
      const [[ax, ay], [bx, by]] = [s.p, s.q];
      // Nửa bề rộng dây dày nhất không chạm vào thẻ nào (trừ điểm đầu/cuối nằm đúng mép thẻ).
      const half = s.room / 2;
      for (const b of nodeBoxes(lay)) {
        const hit = Math.min(ax, bx) - half < b.x + b.w && Math.max(ax, bx) + half > b.x && Math.min(ay, by) < b.y + b.h - 0.5 && Math.max(ay, by) > b.y + 0.5;
        const horiz = ay === by;
        assert.ok(!hit || !horiz || ay < b.y || ay > b.y + b.h, `${s.key}: đoạn ngang lấn vào thẻ ${b.id}`);
      }
      for (const o of segs) {
        if (o.key === s.key) continue;
        const sameAxis = (ay === by && o.p[1] === o.q[1]) || (ax === bx && o.p[0] === o.q[0]);
        if (!sameAxis) continue;
        const horiz = ay === by;
        const [lo1, hi1] = horiz ? [Math.min(ax, bx), Math.max(ax, bx)] : [Math.min(ay, by), Math.max(ay, by)];
        const [lo2, hi2] = horiz ? [Math.min(o.p[0], o.q[0]), Math.max(o.p[0], o.q[0])] : [Math.min(o.p[1], o.q[1]), Math.max(o.p[1], o.q[1])];
        // Bỏ phần bo góc 8 px ở hai đầu đoạn: chồng lên nhau thật sự mới tính.
        if (Math.min(hi1, hi2) - Math.max(lo1, lo2) <= 16) continue;
        const gap = horiz ? Math.abs(ay - o.p[1]) : Math.abs(ax - o.p[0]);
        assert.ok(gap >= Math.min(s.room, o.room) - 1e-9, `${s.key} và ${o.key} chỉ cách ${gap}px`);
      }
    }
  });
}

test("routeWires: dây vào cổng hàng trên chạy theo khe, không đè ô hàng dưới", () => {
  const lay = routeWires(layoutHorizontal(tree(), LAYOUT, { chain: "stack" }));
  const ccr = lay.boxes.find((b) => b.id === "ccr");
  const e2 = lay.links.find((l) => l.wire?.to === "ether2");
  const [x] = e2.pts[e2.pts.length - 1];
  const cx = cellRect(ccr, "ether1").left;
  assert.ok(x < cx && x > cx - FACE_METRICS.full.gap - 0.5);
});

test("routeWires: chấm cắm cổng hàng trên chạm ô đích, không chạm ô kế bên (cả đầu ra lẫn đầu vào)", () => {
  const topo = normalizeConfig({
    nodes: [
      { id: "r", name: "R", type: "router", ports: { adapter: "routeros" } },
      { id: "s", name: "S", type: "switch", ports: { adapter: "routeros" } },
    ],
    edges: [{ from: "r", to: "s", from_port: "ether4", to_port: "ether6" }],
  });
  const panels = new Map(["r", "s"].map((id) => [id, { panel: portPanel(ethers(8), { rows: 2, top: "even" }), ports: ethers(8) }]));
  const lay = routeWires(layoutHorizontal(buildTree(topo, new Set(), new Map(), panels), LAYOUT, { chain: "stack" }));
  const wire = lay.links.find((l) => l.wire);
  const [from, to] = wire.plugs;
  const box = (id) => lay.boxes.find((b) => b.id === id);
  for (const [[x, y], id, target, neighbor] of [[from, "r", "ether4", "ether2"], [to, "s", "ether6", "ether4"]]) {
    const t = cellRect(box(id), target);
    const n = cellRect(box(id), neighbor);
    assert.ok(x - PLUG_R < t.right && x + PLUG_R > t.left && y - PLUG_R < t.bottom && y + PLUG_R > t.top, `${target}: chấm phải chạm ô đích`);
    assert.ok(x - PLUG_R >= n.right, `${target}: chấm không được chạm ${neighbor}`);
  }
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

const noOverlap = (lay, tag) => {
  const bs = nodeBoxes(lay);
  bs.forEach((a, i) => {
    assert.ok(a.x + a.w + LAYOUT.pad <= lay.width, `${tag}: ${a.id} vượt bề rộng`);
    bs.slice(i + 1).forEach((b) => {
      const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!hit, `${tag}: ${a.id} đè ${b.id}`);
    });
  });
};
const chainOf = (ids, kids = []) =>
  normalizeConfig({
    nodes: [...ids, ...kids].map((id) => ({ id })),
    edges: [
      ...ids.slice(1).map((to, i) => ({ from: ids[i], to })),
      ...kids.map((to) => ({ from: ids[ids.length - 1], to })),
    ],
  });
const strip = (n) => ({ panel: portPanel(ethers(n), { rows: 1, block: 0 }), head: 68 });

for (const [name, topo, panels] of [
  ["thẻ giữa chuỗi", chainOf(["inet", "r", "ap"]), new Map([["r", strip(16)]])],
  ["thẻ giữa chuỗi, nhiều con", chainOf(["inet", "r", "s"], ["a", "b", "c", "d"]), new Map([["r", strip(24)]])],
  ["thẻ đầu chuỗi", chainOf(["r", "ap"], ["a", "b"]), new Map([["r", strip(24)]])],
]) {
  test(`chain stack, cạnh không có dây (${name}): thẻ không bị cắt, không đè nhau`, () => {
    noOverlap(layoutHorizontal(buildTree(topo, new Set(), new Map(), panels), LAYOUT, { chain: "stack" }), name);
    noOverlap(layoutHorizontal(buildTree(topo, new Set(), new Map(), panels, { wires: "node" }), LAYOUT, { chain: "stack" }), `${name}, wires node`);
  });
}

test("chain stack: mẫu đơn giản vẫn xếp chồng cả chuỗi", () => {
  const lay = layoutHorizontal(buildTree(chainOf(["inet", "r", "ap"]), new Set(), new Map()), LAYOUT, { chain: "stack" });
  assert.equal(new Set(nodeBoxes(lay).map((b) => b.x)).size, 1);
  assert.equal(lay.width, LAYOUT.pad * 2 + LAYOUT.nodeW);
});

const unknownSwitch = (n, sfps = 1) => ({
  panel: portPanel([...ethers(n), ...Array.from({ length: sfps }, (_, i) => port(`sfp${i + 1}`))], {}),
  head: 68,
});
for (const [n, sfps] of [[24, 1], [48, 1], [4, 16]]) {
  for (const [name, layout] of [["vertical", layoutVertical], ["cards", layoutCards]]) {
    test(`Model lạ ${n} cổng + ${sfps} SFP, khung 360 (${name}): đủ ô, ô nào cũng nằm trong thẻ`, () => {
      const topo = normalizeConfig({ nodes: [{ id: "s", ports: [] }] });
      const box = layout(buildTree(topo, new Set(), new Map(), new Map([["s", unknownSwitch(n, sfps)]])), 360).boxes[0];
      assert.equal(box.face.cells.length, n + sfps);
      for (const c of box.face.cells) assert.ok(box.face.x + c.x + c.w <= box.w - FACE_METRICS.touch.pad + 1e-9, c.port.name);
      assert.equal(new Set(box.face.cells.map((c) => `${c.x},${c.y}`)).size, n + sfps);
    });
  }
}

test("panelLayout: chia cụm giữ nguyên từng cột; cụm vừa khung không bị chia", () => {
  const panel = portPanel(ethers(24), { rows: 2, top: "even" });
  const f = panelLayout(panel, FACE_METRICS.touch, 200);
  const cell = (name) => f.cells.find((c) => c.port.name === name);
  for (let i = 1; i < 24; i += 2) assert.equal(cell(`ether${i}`).x, cell(`ether${i + 1}`).x);
  assert.equal(panelLayout(panel, FACE_METRICS.full, 1000).h, panelLayout(panel).h);
});

test("normalizeConfig: faceplate.rows/block sai báo lỗi thay vì treo khi vẽ", () => {
  const cfg = (faceplate) => ({ nodes: [{ id: "s", ports: {}, faceplate }] });
  for (const rows of [0, -1, 1.5, "2"]) assert.throws(() => normalizeConfig(cfg({ rows })), /rows phải/);
  for (const block of [-1, 1.5, "4"]) assert.throws(() => normalizeConfig(cfg({ block })), /block phải/);
  for (const ok of [{ rows: 2, block: 4 }, { block: 0 }, false, undefined]) assert.ok(normalizeConfig(cfg(ok)));
});

test("detailMode: chọn trên thẻ thắng YAML; view_switch: false thì chỉ YAML quyết định", () => {
  assert.equal(detailMode({}, null), "full");
  assert.equal(detailMode({ detail: "simple" }, null), "simple");
  assert.equal(detailMode({ detail: "simple" }, "full"), "full");
  assert.equal(detailMode({ detail: "simple" }, "rác"), "simple");
  assert.equal(detailMode({ detail: "simple", view_switch: false }, "full"), "simple");
  assert.equal(detailMode({ view_switch: false }, "simple"), "full");
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

// Router 8 cổng, 3 thiết bị cuối ở ether2, ether5, ether8 + 1 switch con.
const leafTree = () => {
  const topo = normalizeConfig({
    nodes: [{ id: "r", ports: [] }, { id: "s", ports: [] }],
    edges: [{ from: "r", to: "s", from_port: "sfp-sfpplus1", to_port: "sfp-sfpplus1" }],
  });
  const ports = [...ethers(8), port("sfp-sfpplus1")];
  const panels = new Map([["r", panelOf(ports)], ["s", panelOf([...ethers(8), port("sfp-sfpplus1")])]]);
  const leaves = new Map([["r", [port("ether2"), port("ether5"), port("ether8")]]]);
  return { topo, panels, leaves, trees: buildTree(topo, new Set(["r"]), leaves, panels) };
};
const cross = (a, b) => {
  const seg = (P) => P.slice(1).map((pt, i) => [P[i], pt]);
  for (const [p, q] of seg(a))
    for (const [r, s] of seg(b)) {
      const [h, v] = p[1] === q[1] ? [[p, q], [r, s]] : [[r, s], [p, q]];
      if (h[0][1] !== h[1][1] || v[0][0] !== v[1][0]) continue;
      const x = v[0][0];
      const y = h[0][1];
      if (Math.min(h[0][0], h[1][0]) < x && x < Math.max(h[0][0], h[1][0]) && Math.min(v[0][1], v[1][1]) < y && y < Math.max(v[0][1], v[1][1])) return true;
    }
  return false;
};

for (const [name, run] of [
  ["ngang", (t) => routeWires(layoutHorizontal(t, LAYOUT, { chain: "stack" }))],
  ["cây dọc", (t) => routeWires(layoutDown(t))],
]) {
  test(`Dây thiết bị cuối (${name}): ra từ đúng ô, tới đúng lá, không cắt nhau`, () => {
    const lay = run(leafTree().trees);
    const leaves = lay.links.filter((l) => l.kind === "port");
    assert.equal(leaves.length, 3);
    const r = lay.boxes.find((b) => b.id === "r");
    for (const l of leaves) {
      assert.ok(l.wire?.leaf);
      const box = lay.boxes.find((b) => b.key === l.key);
      const cell = r.face.cells.find((c) => c.port.name === l.port.name);
      const [px, py] = l.plugs[0];
      const left = r.x + LAYOUT.nodeBorder + r.face.x + cell.x;
      assert.ok(px >= left - 1 && px <= left + cell.w, `${l.key}: chấm cắm không ở ô ${cell.port.name}`);
      assert.ok(py <= r.y + r.h);
      assert.deepEqual(l.pts[l.pts.length - 1], [box.x, box.y + box.h / 2]);
      assert.equal(lay.wireOf.get(`r/${l.port.name}`), l.key);
    }
    leaves.forEach((a, i) => leaves.slice(i + 1).forEach((b) => assert.ok(!cross(a.pts, b.pts), `${a.key} cắt ${b.key}`)));
  });
}

test("Lá cổng: wires: node và mẫu đơn giản giữ đường nối cũ, giữ thứ tự cũ", () => {
  const { topo, panels, leaves } = leafTree();
  for (const t of [buildTree(topo, new Set(["r"]), leaves, panels, { wires: "node" }), buildTree(topo, new Set(["r"]), leaves)]) {
    const lay = routeWires(layoutHorizontal(t, LAYOUT, { chain: "stack" }));
    const list = lay.links.filter((l) => l.kind === "port");
    assert.ok(list.every((l) => !l.wire && !l.pts));
    assert.deepEqual(list.map((l) => l.port.name), ["ether2", "ether5", "ether8"]);
  }
});

test("deviceOfNode: theo tên, không thấy thì suy từ entity của cổng", () => {
  const devices = { a: { id: "a", name: "CCR2004" }, b: { id: "b", name: "GS108PEv3 192.168.10.3" } };
  const entities = { "binary_sensor.gs_1": { device_id: "b" } };
  assert.equal(deviceOfNode({ name: "CCR2004", ports: {} }, [], devices, entities).id, "a");
  assert.equal(deviceOfNode({ name: "GS108PE", ports: { adapter: "netgear_plus" } }, [{ link: "binary_sensor.gs_1" }], devices, entities).id, "b");
  assert.equal(deviceOfNode({ name: "Lạ", ports: {} }, [], devices, entities), undefined);
});

test("deviceIp: lấy IP từ configuration_url, tên miền thì không", () => {
  assert.equal(deviceIp({ configuration_url: "http://192.168.10.3/" }), "192.168.10.3");
  assert.equal(deviceIp({ configuration_url: "https://router.local" }), null);
  assert.equal(deviceIp(undefined), null);
});

test("deviceStats: nhận theo tên entity, không theo entity id; YAML ghi đè; stats: false tắt", () => {
  const device = { id: "a" };
  const entities = Object.fromEntries(
    ["sensor.mikrotik_cpu_load", "sensor.mikrotik_memory_usage", "sensor.mikrotik_uptime", "sensor.board", "sensor.cpu_t", "sensor.khac"].map((id) => [id, { entity_id: id, device_id: id === "sensor.khac" ? "z" : "a" }]),
  );
  const states = {
    "sensor.mikrotik_cpu_load": { attributes: { friendly_name: "CCR2004 CPU load" } },
    "sensor.mikrotik_memory_usage": { attributes: { friendly_name: "CCR2004 Memory usage" } },
    "sensor.mikrotik_uptime": { attributes: { friendly_name: "CCR2004 Uptime" } },
    "sensor.board": { attributes: { friendly_name: "CCR2004 Board temperature1" } },
    "sensor.cpu_t": { attributes: { friendly_name: "CCR2004 CPU temperature" } },
    "sensor.khac": { attributes: { friendly_name: "Khác CPU load" } },
  };
  assert.deepEqual(deviceStats({}, device, entities, states), {
    cpu: "sensor.mikrotik_cpu_load",
    ram: "sensor.mikrotik_memory_usage",
    uptime: "sensor.mikrotik_uptime",
    temp: "sensor.cpu_t",
  });
  assert.equal(deviceStats({ stats: { cpu: "sensor.tay" } }, device, entities, states).cpu, "sensor.tay");
  assert.deepEqual(deviceStats({ stats: false }, device, entities, states), {});
  assert.deepEqual(deviceStats({}, undefined, entities, states), {});
});

test("uptimeParts: mốc khởi động hoặc số giây; giá trị lạ → null", () => {
  const now = Date.parse("2026-11-04T09:00:00Z");
  assert.deepEqual(uptimeParts("2026-10-24T09:00:00+00:00", now), { days: 11 });
  assert.deepEqual(uptimeParts("7200", now), { hours: 2 });
  assert.deepEqual(uptimeParts("200000", now), { days: 2 });
  assert.equal(uptimeParts("unavailable", now), null);
  assert.equal(uptimeParts("", now), null);
  assert.equal(uptimeParts("2030-01-01T00:00:00Z", now), null);
});

test("portsBehind: cộng cả nhánh, bỏ cổng nối node và cổng ẩn", () => {
  const topo = normalizeConfig({
    nodes: [{ id: "r", ports: [], port_names: { ether3: false } }, { id: "s", ports: [] }, { id: "t", ports: [] }],
    edges: [
      { from: "r", to: "s", from_port: "ether1", to_port: "ether1" },
      { from: "s", to: "t", from_port: "ether2", to_port: "ether1" },
    ],
  });
  const on = (n) => port(n, { linked: true });
  const byNode = new Map([
    ["r", [on("ether1"), on("ether2"), on("ether3"), port("ether4")]],
    ["s", [on("ether1"), on("ether2"), on("ether3")]],
    ["t", [on("ether1"), on("ether2"), on("ether3")]],
  ]);
  assert.equal(portsBehind(topo, byNode, "t"), 2);
  assert.equal(portsBehind(topo, byNode, "s"), 3);
  assert.equal(portsBehind(topo, byNode, "r"), 4);
});

test("faceBox: minW nới thẻ để không cắt chữ, nhưng không vượt khung cố định, và bỏ qua ở dải chấm", () => {
  const it = { ...panelOf([port("ether1")]), minW: 250 };
  assert.equal(faceBox(it, 180, 74).w, 250);
  assert.equal(faceBox(it, 200, 74, FACE_METRICS.touch, 74, 200).w, 200);
  assert.equal(faceBox(it, 170, 60, FACE_METRICS.led, 60, 170).w, 170);
});

test("faceBox: dòng lưu lượng chỉ thêm chiều cao ở kiểu danh sách", () => {
  const it = { ...panelOf([port("ether1")]), rateH: 17 };
  const flat = { ...it, rateH: 0 };
  assert.equal(faceBox(it, 300, 74, FACE_METRICS.touch, 0, 300).h - faceBox(flat, 300, 74, FACE_METRICS.touch, 0, 300).h, 17);
  assert.equal(faceBox(it, 180, 74).h, faceBox(flat, 180, 74).h);
});

const chainTopo = () =>
  normalizeConfig({
    nodes: [{ id: "r", name: "R", ports: [] }, { id: "s", name: "S", ports: [] }, { id: "t", name: "T", ports: [] }, { id: "m", name: "M" }],
    edges: [
      { from: "m", to: "r", to_port: ["ether1", "ether2"] },
      { from: "r", to: "s", from_port: "sfp1", to_port: "sfp2" },
      { from: "s", to: "t", from_port: "ether3", to_port: "ether1" },
    ],
  });
const labels = { d_status: "st", d_up: "up", d_peer: "peer", d_device: "dev", d_ip: "ip", d_mac: "mac", d_traffic: "tr", d_downs: "downs", d_on: "on", poe: "PoE", disabled: "off", no_link: "none", slow_tip: () => "slow" };

test("portPeer: cả hai chiều, nhiều cổng ghép theo vị trí, đầu kia không khai cổng thì chỉ tên node", () => {
  const topo = chainTopo();
  assert.equal(portPeer(topo, "r", "sfp1"), "S S2");
  assert.equal(portPeer(topo, "s", "sfp2"), "R S1");
  assert.equal(portPeer(topo, "r", "ether2"), "M");
  assert.equal(portPeer(topo, "r", "ether9"), null);
});

test("portRows: bỏ mục trống, giữ số 0 lần mất link, cổng chưa link không có lưu lượng", () => {
  const up = port("ether8", { linked: true, speedMbps: 1000, device: "NAS", deviceIp: "10.0.0.2", deviceMac: "AA", linkDowns: 0, rxBps: 1000, txBps: 2000 });
  const rows = Object.fromEntries(portRows(up, {}, "S S2", labels, "en", "2.5G"));
  assert.ok(rows.st.endsWith(" · slow"));
  assert.equal(rows.downs, 0);
  assert.equal(rows.dev, "NAS");
  assert.equal(rows.peer, "S S2");
  assert.ok(rows.tr.startsWith("↓"));
  assert.deepEqual(portRows(port("ether1"), {}, null, labels, "en"), [["st", "none"]]);
  assert.deepEqual(portRows(port("ether1", { disabled: true }), {}, null, labels, "en"), [["st", "off"]]);
});

test("readPort: đọc link_downs và device_mac; thiếu thuộc tính thì null", () => {
  const states = { "binary_sensor.l": { state: "on", attributes: { link_downs: "67", device_mac: "AA:BB" } }, "binary_sensor.k": { state: "off", attributes: {} } };
  const a = readPort(states, { name: "ether1", link: "binary_sensor.l" });
  assert.equal(a.linkDowns, 67);
  assert.equal(a.deviceMac, "AA:BB");
  assert.equal(readPort(states, { name: "ether2", link: "binary_sensor.k" }).linkDowns, null);
});

test("branchNodes và buildTree: thu nhánh ẩn cả cây con, không tính dây của phần đã ẩn", () => {
  const topo = chainTopo();
  assert.deepEqual([...branchNodes(topo, "r")].sort(), ["s", "t"]);
  assert.equal(branchNodes(topo, "t").size, 0);
  const panels = new Map([
    ["r", panelOf([port("sfp1")])],
    ["s", panelOf([port("sfp2"), port("ether3")])],
    ["t", panelOf([port("ether1")])],
  ]);
  const find = (it, id) => (it.id === id ? it : it.children.map((c) => find(c, id)).find(Boolean));
  const open = buildTree(topo, new Set(), new Map(), panels)[0];
  assert.ok(find(open, "t"));
  assert.equal(find(open, "r").fan, 1);
  const shut = buildTree(topo, new Set(), new Map(), panels, { collapsed: new Set(["r"]) })[0];
  assert.equal(find(shut, "s"), undefined);
  assert.equal(find(shut, "r").children.length, 0);
  assert.equal(find(shut, "r").fan, undefined);
  assert.doesNotThrow(() => fitLayout([shut], 1200, { layout: "horizontal" }));
});

test("stepCell: mũi tên đi theo vị trí ô trên dải (cổng chẵn ở hàng trên), hết ô thì -1", () => {
  const ports = [...ethers(24), port("sfp-sfpplus1"), port("sfp-sfpplus2")];
  const face = panelLayout(portPanel(ports, faceplateSpec({ ports: {} }, { model: "CRS326-24G-2S+RM" })), FACE_METRICS.full);
  const names = face.cells.map((c) => c.port.name);
  const at = (name) => names.indexOf(name);
  const go = (name, key) => names[stepCell(face.cells, at(name), key)];
  assert.equal(go("ether2", "ArrowRight"), "ether4");
  assert.equal(go("ether1", "ArrowRight"), "ether3");
  assert.equal(go("ether2", "ArrowDown"), "ether1");
  assert.equal(go("ether1", "ArrowUp"), "ether2");
  assert.equal(go("ether8", "ArrowRight"), "ether10", "qua khe giữa hai cụm");
  assert.equal(go("ether23", "ArrowRight"), "sfp-sfpplus1", "SFP nằm ở hàng dưới bên phải");
  assert.equal(stepCell(face.cells, at("ether2"), "ArrowLeft"), -1);
  assert.equal(stepCell(face.cells, at("ether1"), "ArrowDown"), -1);
  assert.equal(stepCell(face.cells, at("ether1"), "Tab"), -1);
});
