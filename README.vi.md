# LAN Topo Card

*English: [README.md](README.md)*

Card Lovelace cho Home Assistant vẽ mạng LAN thành một cây sống:
**Internet → modem → router → switch → thiết bị trên từng cổng**. Đường nối chạy theo lưu lượng thật và đứng yên khi rảnh.

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
- Chỉ đọc: card không bật/tắt gì (công tắc PoE chỉ hiện thành ⚡).
- Không có bước build: một file ES module, Lit lấy từ frontend Home Assistant.

## Cài đặt

### HACS (khuyên dùng)

1. HACS → ⋮ → **Custom repositories** → `https://github.com/ngoviet/lan-topo-card`, loại **Dashboard**.
2. Cài **LAN Topo Card**. HACS tự thêm resource `/hacsfiles/lan-topo-card/lan-topo-card.js`.
3. Tải lại trình duyệt.

### Cài tay

Chép `dist/lan-topo-card.js` vào `/config/www/`, rồi thêm resource `/local/lan-topo-card.js` (loại JavaScript module).

## Ví dụ

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
| `expanded` | `[]` | Id node mở sẵn khi tải |
| `expand` | `single` | `single`: mở switch này thì đóng switch khác; `multi`: mở nhiều cái cùng lúc |
| `layout` | `auto` | `auto`, `horizontal`, `vertical` |
| `breakpoint` | `600` | Card hẹp hơn mức này (px) thì `auto` dùng bố cục dọc |
| `min_scale` | `0.55` | `auto` chuyển sang dọc khi cây phải co nhỏ hơn tỉ lệ này |
| `max_scale` | `1` | Không phóng to cây quá tỉ lệ này |
| `idle_kbps` | `20` | Lưu lượng dưới mức này thì đường đứng yên |
| `show_all_ports` | `false` | Hiện cả cổng không có link/lưu lượng |
| `legend` | `true` | Hiện chú thích màu |
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
| `port_names` | Tên từng cổng: `"tên \| ip"`, `{ name, ip, icon, show }`, hoặc `false` để ẩn |
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

## Giấy phép

MIT © ngoviet
