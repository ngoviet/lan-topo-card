import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toBps,
  parseLinkSpeed,
  speedColor,
  speedLabel,
  formatRate,
  flowLevel,
  naturalCompare,
  slugify,
  NO_LINK_COLOR,
  UNKNOWN_SPEED_COLOR,
} from "../dist/lan-topo-card.js";

test("toBps đổi mọi đơn vị tốc độ về bit/s", () => {
  assert.equal(toBps("1121915", "bit/s"), 1121915);
  assert.equal(toBps(2.5, "kbit/s"), 2500);
  assert.equal(toBps("36.9", "Mbit/s"), 36.9e6);
  assert.equal(toBps(1, "Gbit/s"), 1e9);
  assert.equal(toBps(10, "Mbps"), 10e6);
  // byte/s — phân biệt MB/s (megabyte) với Mb/s (megabit)
  assert.equal(toBps("0.6", "MB/s"), 4.8e6);
  assert.equal(toBps(1, "Mb/s"), 1e6);
  assert.equal(toBps(1, "B/s"), 8);
  assert.equal(toBps(1, "kB/s"), 8000);
  assert.equal(toBps(1, "KiB/s"), 8192);
  assert.equal(toBps(1, "MiB/s"), 8 * 1024 * 1024);
  // không có đơn vị → coi là bit/s
  assert.equal(toBps(5, undefined), 5);
});

test("toBps trả null với giá trị/đơn vị lạ", () => {
  assert.equal(toBps("unavailable", "bit/s"), null);
  assert.equal(toBps(5, "°C"), null);
  assert.equal(toBps(null, "bit/s"), null);
});

test("parseLinkSpeed hiểu chuỗi của RouterOS, SNMP và số Mbit/s", () => {
  assert.equal(parseLinkSpeed("1Gbps"), 1000);
  assert.equal(parseLinkSpeed("2.5Gbps"), 2500);
  assert.equal(parseLinkSpeed("10 Gbps"), 10000);
  assert.equal(parseLinkSpeed("100Mbps"), 100);
  assert.equal(parseLinkSpeed("10M"), 10);
  assert.equal(parseLinkSpeed("2,5G"), 2500);
  assert.equal(parseLinkSpeed(1000), 1000);
  assert.equal(parseLinkSpeed("1000"), 1000);
  assert.equal(parseLinkSpeed("Disconnected"), null);
  assert.equal(parseLinkSpeed(0), null);
  assert.equal(parseLinkSpeed(null), null);
});

test("speedColor theo bảng màu cổng", () => {
  assert.equal(speedColor(10000), "#3b82f6");
  assert.equal(speedColor(25000), "#3b82f6");
  assert.equal(speedColor(2500), "#14b8a6");
  assert.equal(speedColor(5000), "#14b8a6");
  assert.equal(speedColor(1000), "#22c55e");
  assert.equal(speedColor(100), "#f59e0b");
  assert.equal(speedColor(10), "#9ca3af");
  assert.equal(speedColor(1000, false), NO_LINK_COLOR);
  assert.equal(speedColor(null, true), UNKNOWN_SPEED_COLOR);
});

test("speedLabel", () => {
  assert.equal(speedLabel(10000), "10G");
  assert.equal(speedLabel(2500), "2.5G");
  assert.equal(speedLabel(1000), "1G");
  assert.equal(speedLabel(100), "100M");
  assert.equal(speedLabel(null), "");
});

test("formatRate chọn đơn vị và số lẻ theo độ lớn", () => {
  assert.equal(formatRate(12_345_678, "en"), "12.3 Mbps");
  assert.equal(formatRate(12_345_678, "vi"), "12,3 Mbps");
  assert.equal(formatRate(2_929_555, "en"), "2.93 Mbps");
  assert.equal(formatRate(450_000, "en"), "450 kbps");
  assert.equal(formatRate(1_500_000_000, "en"), "1.5 Gbps");
  assert.equal(formatRate(512, "en"), "512 bps");
  assert.equal(formatRate(0, "en"), "0 bps");
  assert.equal(formatRate(null), "—");
});

test("flowLevel: đứng yên khi rảnh, tăng theo bậc 10", () => {
  assert.equal(flowLevel(0), 0);
  assert.equal(flowLevel(null), 0);
  assert.equal(flowLevel(5_000), 0);
  assert.equal(flowLevel(500_000), 1);
  assert.equal(flowLevel(5e6), 2);
  assert.equal(flowLevel(50e6), 3);
  assert.equal(flowLevel(500e6), 4);
  assert.equal(flowLevel(5e9), 5);
  assert.equal(flowLevel(50_000, 100_000), 0); // ngưỡng rảnh tuỳ chỉnh
});

test("naturalCompare + slugify", () => {
  const ports = ["sfp-sfpplus1", "ether10", "ether2", "ether1"];
  assert.deepEqual(ports.sort(naturalCompare), ["ether1", "ether2", "ether10", "sfp-sfpplus1"]);
  assert.equal(slugify("CRS310"), "crs310");
  assert.equal(slugify("GS108PEv3 192.168.0.239"), "gs108pev3_192_168_0_239");
  assert.equal(slugify("Đèn Tầng 1"), "den_tang_1");
});

test("flowWidth: dày theo log10 lưu lượng, có chặn", async () => {
  const { flowWidth } = await import("../dist/lan-topo-card.js");
  assert.equal(flowWidth(0), 1.2);
  assert.equal(flowWidth(null), 1.2);
  assert.equal(flowWidth(1e5), 1.2);
  assert.ok(Math.abs(flowWidth(1e6) - 2.3) < 1e-9);
  assert.ok(Math.abs(flowWidth(1e8) - 4.5) < 1e-9);
  assert.equal(flowWidth(1e12), 7);
  assert.equal(flowWidth(1e9, { max: 4 }), 4);
  assert.ok(flowWidth(50e6) > flowWidth(5e6)); // gấp 10 lần lưu lượng → dày hơn
});

test("trafficWidth: log10 trải đều 100 kbps → min, 1 Gbps → max; tăng đều theo lưu lượng", async () => {
  const { trafficWidth } = await import("../dist/lan-topo-card.js");
  assert.equal(trafficWidth(0), 0.8);
  assert.equal(trafficWidth(null), 0.8);
  assert.equal(trafficWidth(1e5), 0.8);
  assert.ok(Math.abs(trafficWidth(1e7) - 2.9) < 1e-9);
  assert.equal(trafficWidth(1e9), 5);
  assert.equal(trafficWidth(1e10), 5);
  assert.equal(trafficWidth(1e9, 3), 3); // dây hẹp chỗ (cây dọc) vẫn chạm trần ở 1 Gbps
  assert.equal(trafficWidth(1e9, 0.5), 0.5); // trần thấp hơn sàn: không vượt trần
  // Số trong ảnh của người dùng: cam 6 Mbps < PC 28 Mbps < NAS 775 Mbps, mỗi bậc khác nhau rõ.
  assert.ok(trafficWidth(28e6) - trafficWidth(6e6) > 0.6);
  assert.ok(trafficWidth(775e6) - trafficWidth(28e6) > 1.2);
});

test("offsetPts: song song cách đều, góc vuông dời theo tổng 2 pháp tuyến", async () => {
  const { offsetPts } = await import("../dist/lan-topo-card.js");
  // Đi phải rồi xuống: bên trái theo chiều đi = phía trên ở đoạn ngang, phía phải (x lớn) ở đoạn dọc.
  assert.deepEqual(offsetPts([[0, 0], [10, 0], [10, 10]], 2), [[0, -2], [12, -2], [12, 10]]);
  assert.deepEqual(offsetPts([[0, 0], [10, 0], [10, 10]], -2), [[0, 2], [8, 2], [8, 10]]);
  const P = [[0, 0], [0, 5]];
  assert.equal(offsetPts(P, 0), P);
  assert.deepEqual(offsetPts([[1, 1]], 3), [[1, 1]]);
});

test("splitWire: đoạn trong thẻ cha/con tách riêng, phần ngoài bắt đầu và kết thúc ở mép dưới thẻ", async () => {
  const { splitWire } = await import("../dist/lan-topo-card.js");
  const P = { x: 0, y: 0, w: 100, h: 50 };
  const C = { x: 200, y: 0, w: 100, h: 50 };
  const pts = [[20, 40], [20, 70], [150, 70], [150, 80], [250, 80], [250, 45]];
  const { outer, inner } = splitWire(pts, P, C);
  assert.deepEqual(outer, [[20, 50], [20, 70], [150, 70], [150, 80], [250, 80], [250, 50]]);
  assert.deepEqual(inner, [[[20, 40], [20, 50]], [[250, 50], [250, 45]]]);
  // Dây tới thiết bị cuối: kết thúc ở mép trái ô thiết bị (ngoài thẻ cha) → chỉ cắt đầu ra.
  const leaf = splitWire([[20, 40], [20, 70], [150, 70], [150, 25], [200, 25]], P, C);
  assert.deepEqual(leaf.inner, [[[20, 40], [20, 50]]]);
  assert.deepEqual(leaf.outer[leaf.outer.length - 1], [200, 25]);
  // Thẻ cha không có dải cổng: dây ra từ đúng mép dưới → không có đoạn trong thẻ.
  assert.deepEqual(splitWire([[20, 50], [20, 70], [200, 70]], P, null).inner, []);
});

test("speedColor / speedLabel: tốc độ ≤ 0 hoặc NaN = chưa biết, không ném lỗi", () => {
  for (const v of [-1, NaN, 0]) {
    assert.equal(speedColor(v), UNKNOWN_SPEED_COLOR);
    assert.equal(speedLabel(v), "");
  }
});
