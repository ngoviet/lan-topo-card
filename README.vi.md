# LAN Topo Card

<!-- readme-axi type=card -->

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)
[![Test](https://github.com/ngoviet/lan-topo-card/actions/workflows/test.yml/badge.svg)](https://github.com/ngoviet/lan-topo-card/actions/workflows/test.yml)

[English](README.md) · **Tiếng Việt**

Card Lovelace cho Home Assistant vẽ mạng LAN thành một cây sống:
**Internet → modem → router → switch → thiết bị trên từng cổng**. Đường nối chạy theo lưu lượng thật và đứng yên khi rảnh.

> 🇻🇳 Dự án do một người Việt tự xây dựng và duy trì — nếu nó giúp ích cho bạn, hãy
> [ủng hộ dự án](#ủng-hộ-dự-án).

## Mục lục

- [Tính năng](#tính-năng)
- [Cài đặt](#cài-đặt)
- [Cách dùng](#cách-dùng)
- [Tuỳ chọn](#tuỳ-chọn)
- [LAN Ports Card](#lan-ports-card)
- [LAN Wi-Fi Card](#lan-wi-fi-card)
- [Màu](#màu)
- [Phát triển](#phát-triển)

## Tính năng

- **Topo khai báo bằng YAML** (`nodes` + `edges`), không gắn cứng khuôn mạng nào.
- **Adapter cổng** đọc cổng switch từ integration có sẵn:
  - `routeros`: [routeros_ha](https://github.com/ngoviet/routeros_ha) (MikroTik qua REST), hoặc bất kỳ integration nào
    có thuộc tính `port` trên entity (`binary_sensor` = link, `sensor` có `direction: rx|tx` = lưu lượng);
  - `netgear_plus`: switch Netgear ProSAFE Plus qua [ha-netgear-plus](https://github.com/ckarrie/ha-netgear-plus);
  - khai báo tay: danh sách cổng với sensor trạng thái/lưu lượng bất kỳ.
- **Đơn vị bất kỳ**: bit/s, kbit/s, Mbit/s, Gbit/s, B/s, kB/s, MB/s, KiB/s…
- **Bấm vào switch** để mở cột thiết bị: chỉ hiện cổng có link hoặc có lưu lượng, ẩn cổng nối sang switch khác.
  Màu cổng theo tốc độ link, có chú thích ngay trong card.
- **Luôn vừa khung**: tự co theo bề ngang card khi tải và khi đổi cỡ; trên điện thoại (< 600 px) chuyển sang bố cục dọc.
- **7 kiểu xem**, chọn bằng nút trên tiêu đề (mỗi trình duyệt nhớ riêng):

  | Kiểu | `layout` | Hợp với |
  |---|---|---|
  | Tự động | `auto` | Sơ đồ ngang khi card rộng, danh sách trên điện thoại |
  | Sơ đồ ngang | `horizontal` | Cây trái → phải, cột thiết bị cạnh từng switch |
  | Cây dọc | `down` | Kiểu sơ đồ tổ chức: switch xếp hàng, thiết bị của mỗi switch chồng dưới nó (gọn bề ngang) |
  | Tâm – viền | `radial` | Node rẽ nhánh đầu tiên (thường là router) ở giữa, switch và thiết bị trên các vòng quanh nó; nhánh Internet ở đỉnh |
  | Vòng cung | `arc` | Như Tâm – viền nhưng xoè nửa vòng phía trên router |
  | Thẻ | `cards` | Mỗi thiết bị một thẻ kèm các cổng, xếp lưới (masonry) vừa mọi bề ngang, cả điện thoại |
  | Danh sách | `vertical` | Danh sách thụt lề |
- Chỉ đọc: card không bật/tắt gì (công tắc PoE chỉ hiện thành ⚡).
- Không có bước build: một file ES module, Lit lấy từ frontend Home Assistant.

## Cài đặt

### HACS (khuyên dùng)

1. HACS → ⋮ → **Custom repositories** → `https://github.com/ngoviet/lan-topo-card`, loại **Dashboard**.
2. Cài **LAN Topo Card**. HACS tự thêm resource `/hacsfiles/lan-topo-card/lan-topo-card.js`.
3. Tải lại trình duyệt.

### Cài tay

Chép `dist/lan-topo-card.js` vào `/config/www/`, rồi thêm resource `/local/lan-topo-card.js` (loại JavaScript module).

## Cách dùng

Thêm card vào dashboard ở chế độ YAML. Ví dụ đầy đủ:

```yaml
type: custom:lan-topo-card
title: Mạng nhà
nodes:
  - { id: internet, type: internet, name: Internet, info: sensor.wan_ip_public }
  - { id: modem, type: modem, name: Modem nhà mạng, count: 2 }
  - id: router
    type: router
    name: Router
    info: 192.168.88.1
    ports: { adapter: routeros, device: hEX }        # tên device trong HA
  - id: core
    type: switch
    name: Switch lõi
    ports: { adapter: routeros, device: CRS326 }
    port_names:
      ether9: { name: Home Assistant, ip: 192.168.88.10, icon: mdi:home-assistant }
      ether11: "Máy bàn | 192.168.88.21"               # "tên | ip"
      ether24: false                                   # không bao giờ hiện cổng này
  - id: office
    type: switch
    name: Phòng làm việc
    ports: { adapter: netgear_plus, prefix: gs108pe }  # tiền tố entity
    port_names:
      1: { name: Wi-Fi, icon: mdi:access-point }
edges:
  - from: internet
    to: modem
    down: [sensor.router_ether1_rx, sensor.router_ether2_rx]   # sensor khai báo tay, cộng dồn
    up: [sensor.router_ether1_tx, sensor.router_ether2_tx]
  - { from: modem, to: router, to_port: [ether1, ether2] }
  - { from: router, to: core, from_port: sfp-sfpplus1, to_port: sfp-sfpplus1 }
  - { from: core, to: office, from_port: ether3, to_port: 8 }
```

## Tuỳ chọn

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `title`, `subtitle` | — | Tiêu đề |
| `nodes` | **bắt buộc** | Thiết bị, xem bên dưới |
| `edges` | `[]` | Đường nối giữa các node. Topo phải là cây (mỗi node một node cha) |
| `expanded` | `[]` | Id node mở sẵn khi tải, hoặc `all` (mọi node có cổng; tự bật `expand: multi`) |
| `expand` | `single` | `single`: mở switch này thì đóng switch khác; `multi`: mở nhiều cái cùng lúc |
| `layout` | `auto` | `auto`, `horizontal`, `down`, `radial`, `arc`, `cards`, `vertical` (mặc định cho nút chuyển view) |
| `chain` | `stack` | `stack`: chuỗi node đầu cây chỉ có 1 con (vd Internet → modem → router) xếp dọc trong 1 cột cho gọn bề ngang; `row`: mỗi node 1 cột |
| `view_switch` | `true` | Nút trên tiêu đề để chọn kiểu xem (chỉ nút đang chọn hiện tên, rê chuột để xem tên nút khác); mỗi trình duyệt nhớ lựa chọn riêng |
| `breakpoint` | `600` | Card hẹp hơn mức này (px) thì `auto` dùng bố cục dọc |
| `min_scale` | `0.55` | `auto` chuyển sang dọc khi cây phải co nhỏ hơn tỉ lệ này |
| `max_scale` | `1` | Không phóng to cây quá tỉ lệ này |
| `idle_kbps` | `20` | Lưu lượng dưới mức này thì đường đứng yên |
| `show_all_ports` | `false` | Hiện cả cổng không có link/lưu lượng |
| `legend` | `true` | Hiện chú thích màu |
| `top` | `5` | Bảng "Đang dùng mạng nhiều nhất" dưới sơ đồ: thiết bị xếp theo tổng ↓+↑ (thanh tỉ lệ so với máy đứng đầu); `0` hoặc `false` để ẩn |
| `warm_mbps`, `hot_mbps` | `10`, `50` | Ô cổng sáng cam khi tổng ↓+↑ vượt `warm_mbps`, nhấp nháy đỏ khi vượt `hot_mbps`; mọi ô cổng có thanh mức dùng ở đáy |
| `motion` | `on` | `on`: hạt luôn chạy (hạt là thông tin lưu lượng); `auto`: dừng khi hệ điều hành bật giảm chuyển động (Windows tắt *Animation effects*); `off`: không bao giờ chạy |
| `language` | theo HA | `vi` hoặc `en` |

### Node

| Khoá | Ý nghĩa |
|---|---|
| `id` | Id duy nhất, dùng trong `edges` |
| `type` | `internet`, `modem`, `router`, `switch`, `ap`, `server`, `device` (quyết định icon + màu) |
| `name`, `icon`, `color` | Đổi cách hiển thị |
| `info` | Dòng thứ 2: chữ tự do hoặc entity id (hiện state) |
| `count` | Vẽ thành chồng nhiều lớp kèm huy hiệu `×N` (vd nhiều modem) |
| `entity` | Bấm node không có cổng thì mở entity này |
| `ports` | Adapter cổng, xem bên dưới. Node có cổng thì bấm để mở được |
| `port_names` | Tên từng cổng: `"tên \| ip"`, `{ name, ip, icon, show, poe }` (`poe: false` ẩn ⚡), hoặc `false` để ẩn. Không ghi tên thì card dùng thuộc tính `device` / `device_ip` của entity link (routeros_ha: LLDP neighbor hoặc comment DHCP lease), rồi tới comment của cổng |
| `show_all_ports` | Như tuỳ chọn của card nhưng chỉ cho node này |

### Adapter cổng

**`routeros`**: `{ adapter: routeros, device: <tên hoặc id device>, platform: routeros_ha }`.
Dùng device registry + entity registry; entity có thuộc tính `port` thành cổng. Nếu có nhiều device trùng tên, card
chọn device có entity của `platform`. Đặt `platform: null` để nhận entity của mọi integration.

**`netgear_plus`**: `{ adapter: netgear_plus, prefix: gs108pe }` đọc `binary_sensor.<prefix>_port_N_status`,
`sensor.<prefix>_port_N_link_speed`, `_receiving`, `_sending` và `switch.<prefix>_port_N` (PoE, chỉ đọc).

**Khai báo tay**:

```yaml
ports:
  - { name: "1", link: binary_sensor.ap_link, rx: sensor.ap_rx, tx: sensor.ap_tx, speed: 1G }
  - { name: "2", rx: sensor.cam_rx, tx: sensor.cam_tx, speed: sensor.cam_link_speed, poe: switch.cam_poe }
```

`rx` = lưu lượng switch **nhận vào** ở cổng đó, `tx` = lưu lượng switch **gửi ra**. `speed` là sensor hoặc giá trị
cố định (`1G`, `100M`, `2500`).

### Edge

| Khoá | Ý nghĩa |
|---|---|
| `from`, `to` | Id node cha và node con |
| `from_port` | Cổng trên node cha dùng cho đường này: tx là chiều *xuống*, rx là chiều *lên* |
| `to_port` | Cổng trên node con (uplink): rx là chiều *xuống*, tx là chiều *lên* |
| `down`, `up` | Sensor khai báo tay (cộng dồn), được ưu tiên hơn cổng |
| `speed` | Tốc độ link để tô màu khi cổng không báo |
| `label` | `false` để ẩn nhãn lưu lượng |

*Xuống* luôn là chiều đi ra xa Internet. Cổng ghi ở `from_port`/`to_port` được ẩn khỏi cột thiết bị.

## LAN Ports Card

Cùng file còn đăng ký **`custom:lan-ports-card`**: lưới cổng switch gọn, mỗi thiết bị một hàng, dùng chung adapter
cổng. Ô tô màu theo tốc độ link; viền đỏ = không có link, viền nét đứt = cổng tắt, viền sáng = đang có lưu lượng,
⚡ = PoE. Rê chuột (hoặc giữ) để xem thiết bị, IP, tốc độ, lưu lượng; chạm để mở entity của cổng.

```yaml
type: custom:lan-ports-card
title: Cổng switch
devices:
  - { name: CCR2004 · router, ports: { adapter: routeros, device: CCR2004 } }
  - { name: CRS326 · 24 cổng, ports: { adapter: routeros, device: CRS326 } }
  - name: GS108PE
    ports: { adapter: netgear_plus, prefix: gs108pe }
    port_names: { 2: { name: Camera 1 } }
```

| Khoá | Ý nghĩa |
|---|---|
| `devices` | **Bắt buộc.** Mỗi thiết bị có `name`, `ports` (adapter, như node) và `port_names` tuỳ chọn (`false` = ẩn cổng) |
| `title`, `legend`, `idle_kbps`, `language` | Như LAN Topo Card |

## LAN Wi-Fi Card

**`custom:lan-wifi-card`** liệt kê thiết bị Wi-Fi theo từng AP từ integration
[aruba_instant_ha](https://github.com/ngoviet/aruba_instant_ha): vạch sóng tô màu theo chất lượng, băng tần
(2,4 / 5 GHz), SSID, IP, tốc độ PHY, SNR. Mỗi AP hiện các radio (kênh + % thời gian kênh bận) và cảnh báo khi hai AP
trùng kênh. Chip phía trên để lọc theo SSID hoặc băng tần. Chỉ đọc.

```yaml
type: custom:lan-wifi-card
entity: sensor.aruba_instant_clients
title: Wi-Fi
group_by: ap      # ap | ssid | band
sort: name        # name | signal (yếu trước) | speed
```

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `entity` | **bắt buộc** | Sensor có thuộc tính `clients` là danh sách `{name, ip, mac, essid, ap, band, channel, signal, quality, speed_mbps}`; tuỳ chọn `aps` (`{tên: {ip, radios: [{band, channel, utilization}]}}`) và `ssids` |
| `group_by` | `ap` | Nhóm theo `ap`, `ssid` hoặc `band` |
| `sort` | `name` | `name`, `signal` (sóng yếu trước) hoặc `speed` |
| `ssid`, `band` | — | Bộ lọc ban đầu |
| `collapse` | `auto` | `auto`: card hẹp hơn `breakpoint` (600 px, điện thoại) thì các nhóm thu gọn sẵn; `true` / `false`: luôn thu gọn / luôn mở. Chạm tiêu đề nhóm để mở/đóng |
| `title`, `language` | `Wi-Fi`, theo HA | |

## Màu

| 10 Gbps | 2,5 Gbps | 1 Gbps | 100 Mbps | 10 Mbps | không có link |
|---|---|---|---|---|---|
| `#3b82f6` | `#14b8a6` | `#22c55e` | `#f59e0b` | `#9ca3af` | `#ef4444` |

## Phát triển

```bash
node --test
```

Phần logic (đổi đơn vị, adapter, bố cục) được export từ `dist/lan-topo-card.js` và test bằng test runner có sẵn của
Node; custom element chỉ được định nghĩa khi chạy trong trình duyệt.

<!-- support:start -->
## Ủng hộ dự án

<p align="center">
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/banner.svg" width="720" alt="Built and maintained by one person in Việt Nam">
</p>

<p align="center">
  <a href="https://buymeacoffee.com/ngoviet"><img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/btn-coffee.svg" height="56" alt="Buy me a coffee"></a>
  &nbsp;
  <a href="https://github.com/sponsors/ngoviet"><img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/btn-sponsors.svg" height="56" alt="GitHub Sponsors"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/vietqr-card.svg" width="300" alt="VietQR — MB Bank — NGO DUC VIET — 911051212">
  &nbsp;
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/crypto-card.svg" width="300" alt="Crypto — BNB Smart Chain (BEP20) — 0xcbf0402b232cb24b4d998f09a4884f87b5f74750">
</p>

<p align="center"><b>Ví tiền mã hoá, chỉ gửi qua mạng BNB Smart Chain (BEP20):</b><br><code>0xcbf0402b232cb24b4d998f09a4884f87b5f74750</code></p>

<p align="center"><sub>🇻🇳 VietQR: quét bằng app ngân hàng bất kỳ, nội dung <code>Ung ho lan-topo-card</code>. Cảm ơn bạn đã giúp dự án tiếp tục phát triển!</sub></p>
<!-- support:end -->

## Giấy phép

[MIT](LICENSE) © Ngô Đức Việt.
