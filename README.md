# LAN Topo Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)
[![Test](https://github.com/ngoviet/lan-topo-card/actions/workflows/test.yml/badge.svg)](https://github.com/ngoviet/lan-topo-card/actions/workflows/test.yml)

*Tiếng Việt: [README.vi.md](README.vi.md)*

A Home Assistant Lovelace card that draws your LAN as a live tree:
**Internet → modem(s) → router → switches → devices on each port**, with links that animate with real traffic
and stand still when idle.

- **Topology in YAML** (`nodes` + `edges`): no built-in assumptions about the shape of the network.
- **Port adapters** read the ports of a switch from existing integrations:
  - `routeros`: [routeros_ha](https://github.com/ngoviet/routeros_ha) (MikroTik over REST), or any integration whose
    entities carry a `port` attribute (`binary_sensor` = link, `sensor` with `direction: rx|tx` = traffic);
  - `netgear_plus`: Netgear ProSAFE Plus switches via [ha-netgear-plus](https://github.com/ckarrie/ha-netgear-plus);
  - manual: a list of ports with any status/traffic sensors.
- **Any data-rate unit**: bit/s, kbit/s, Mbit/s, Gbit/s, B/s, kB/s, MB/s, KiB/s…
- **Tap a switch** to open its device column: only ports with a link or traffic, without the ports that connect to
  other switches. Ports are colored by link speed, with a built-in legend.
- **Always fits its frame**: scales down to the card width on load and on resize, and switches to a vertical layout
  on phones (< 600 px).
- Read-only: the card never toggles anything (PoE switches are only shown as ⚡).
- No build step: one ES module, Lit taken from the Home Assistant frontend.

## Install

### HACS (recommended)

1. HACS → ⋮ → **Custom repositories** → `https://github.com/ngoviet/lan-topo-card`, category **Dashboard**.
2. Install **LAN Topo Card**. HACS adds the resource `/hacsfiles/lan-topo-card/lan-topo-card.js` for you.
3. Reload the browser.

### Manual

Copy `dist/lan-topo-card.js` to `/config/www/` and add the resource `/local/lan-topo-card.js` (type: JavaScript module).

## Example

```yaml
type: custom:lan-topo-card
title: Home network
nodes:
  - { id: internet, type: internet, name: Internet, info: sensor.wan_ip_public }
  - { id: modem, type: modem, name: ISP modem, count: 2 }
  - id: router
    type: router
    name: Router
    info: 192.168.88.1
    ports: { adapter: routeros, device: hEX }        # device name in HA
  - id: core
    type: switch
    name: Core switch
    ports: { adapter: routeros, device: CRS326 }
    port_names:
      ether9: { name: Home Assistant, ip: 192.168.88.10, icon: mdi:home-assistant }
      ether11: "Desktop | 192.168.88.21"               # "name | ip"
      ether24: false                                   # never show this port
  - id: office
    type: switch
    name: Office
    ports: { adapter: netgear_plus, prefix: gs108pe }  # entity prefix
    port_names:
      1: { name: Access point, icon: mdi:access-point }
edges:
  - from: internet
    to: modem
    down: [sensor.router_ether1_rx, sensor.router_ether2_rx]   # explicit sensors, summed
    up: [sensor.router_ether1_tx, sensor.router_ether2_tx]
  - { from: modem, to: router, to_port: [ether1, ether2] }
  - { from: router, to: core, from_port: sfp-sfpplus1, to_port: sfp-sfpplus1 }
  - { from: core, to: office, from_port: ether3, to_port: 8 }
```

## Options

| Key | Default | Description |
|---|---|---|
| `title`, `subtitle` | — | Header text |
| `nodes` | **required** | Devices, see below |
| `edges` | `[]` | Links between nodes. The topology must be a tree (one parent per node) |
| `expanded` | `[]` | Node ids opened on load, or `all` (every node with ports; implies `expand: multi`) |
| `expand` | `single` | `single`: opening a switch closes the others; `multi`: keep several open |
| `layout` | `auto` | `auto`, `horizontal`, `vertical` |
| `breakpoint` | `600` | Below this card width (px), `auto` uses the vertical layout |
| `min_scale` | `0.55` | `auto` switches to vertical when the tree would need to shrink below this |
| `max_scale` | `1` | Never scale the tree up beyond this |
| `idle_kbps` | `20` | Below this traffic a link stands still |
| `show_all_ports` | `false` | Also list ports without link/traffic |
| `legend` | `true` | Show the color legend |
| `top` | `5` | "Top talkers" table under the diagram: devices ranked by ↓+↑ traffic (bars in log scale); `0` hides it |
| `warm_mbps`, `hot_mbps` | `10`, `50` | Port boxes glow amber above `warm_mbps` and pulse red above `hot_mbps` (total ↓+↑); every port box also has a usage bar at the bottom |
| `motion` | `on` | `on`: flow dots always move (they carry information); `auto`: stop when the OS asks for reduced motion (Windows *Animation effects* off); `off`: never move |
| `language` | HA language | `vi` or `en` |

### Node

| Key | Description |
|---|---|
| `id` | Unique id used by `edges` |
| `type` | `internet`, `modem`, `router`, `switch`, `ap`, `server`, `device` (icon and color) |
| `name`, `icon`, `color` | Override display |
| `info` | Second line: free text or an entity id (shows its state) |
| `count` | Draws a stacked group with a `×N` badge (e.g. several modems) |
| `entity` | Tapping a node without ports opens this entity |
| `ports` | Port adapter, see below. Nodes with ports can be opened |
| `port_names` | Per-port label: `"name \| ip"`, `{ name, ip, icon, show, poe }` (`poe: false` hides ⚡) or `false` to hide. Without a name the card uses the `device` / `device_ip` attributes of the link entity (routeros_ha: LLDP neighbor or DHCP lease comment), then the port comment |
| `show_all_ports` | Per-node version of the card option |

### Port adapters

**`routeros`**: `{ adapter: routeros, device: <device name or id>, platform: routeros_ha }`.
Uses the device and entity registry; entities with a `port` attribute become ports. With several devices of the same
name, the one that has entities of `platform` wins. Set `platform: null` to accept any integration.

**`netgear_plus`**: `{ adapter: netgear_plus, prefix: gs108pe }` reads `binary_sensor.<prefix>_port_N_status`,
`sensor.<prefix>_port_N_link_speed`, `_receiving`, `_sending` and `switch.<prefix>_port_N` (PoE, read only).

**Manual**:

```yaml
ports:
  - { name: "1", link: binary_sensor.ap_link, rx: sensor.ap_rx, tx: sensor.ap_tx, speed: 1G }
  - { name: "2", rx: sensor.cam_rx, tx: sensor.cam_tx, speed: sensor.cam_link_speed, poe: switch.cam_poe }
```

`rx` = traffic the switch **receives** on that port, `tx` = traffic it **sends**. `speed` is a sensor or a literal
(`1G`, `100M`, `2500`).

### Edge

| Key | Description |
|---|---|
| `from`, `to` | Parent and child node ids |
| `from_port` | Port(s) on the parent used for this link: its tx is *down*, rx is *up* |
| `to_port` | Port(s) on the child (uplink): its rx is *down*, tx is *up* |
| `down`, `up` | Explicit sensors (summed), override the ports |
| `speed` | Link speed for the color when no port reports one |
| `label` | `false` hides the traffic label |

*Down* always means away from the Internet. Ports named in `from_port`/`to_port` are hidden from the device column.

## LAN Ports Card

The same file also registers **`custom:lan-ports-card`**: a compact grid of switch ports, one row per device,
using the same port adapters. Squares are colored by link speed; a red outline means no link, a dashed one a
disabled port, a glowing edge means traffic, ⚡ is PoE. Hover (or long-press) shows the device, IP, speed and
traffic; tapping opens the port entity.

```yaml
type: custom:lan-ports-card
title: Switch ports
devices:
  - { name: CCR2004 · router, ports: { adapter: routeros, device: CCR2004 } }
  - { name: CRS326 · 24 ports, ports: { adapter: routeros, device: CRS326 } }
  - name: GS108PE
    ports: { adapter: netgear_plus, prefix: gs108pe }
    port_names: { 2: { name: Camera 1 } }
```

| Key | Description |
|---|---|
| `devices` | **Required.** Each has `name`, `ports` (adapter, as for nodes) and optional `port_names` (`false` hides a port) |
| `title`, `legend`, `idle_kbps`, `language` | As in LAN Topo Card |

## LAN Wi-Fi Card

**`custom:lan-wifi-card`** lists Wi-Fi clients per access point from the
[aruba_instant_ha](https://github.com/ngoviet/aruba_instant_ha) integration: signal bars colored by quality,
band (2.4 / 5 GHz), SSID, IP, PHY speed, SNR. Each AP shows its radios (channel + channel busy %) and warns when
two APs share a channel. Chips on top filter by SSID or band. Read-only.

```yaml
type: custom:lan-wifi-card
entity: sensor.aruba_instant_clients
title: Wi-Fi
group_by: ap      # ap | ssid | band
sort: name        # name | signal (weakest first) | speed
```

| Key | Default | Description |
|---|---|---|
| `entity` | **required** | Sensor whose `clients` attribute is a list of `{name, ip, mac, essid, ap, band, channel, signal, quality, speed_mbps}`; optional `aps` (`{name: {ip, radios: [{band, channel, utilization}]}}`) and `ssids` |
| `group_by` | `ap` | Group clients by `ap`, `ssid` or `band` |
| `sort` | `name` | `name`, `signal` (weakest first) or `speed` |
| `ssid`, `band` | — | Initial filter |
| `collapse` | `auto` | `auto`: groups start collapsed when the card is narrower than `breakpoint` (600 px, phones); `true` / `false`: always collapsed / open. Tap a group header to toggle |
| `title`, `language` | `Wi-Fi`, HA language | |

## Colors

| 10 Gbps | 2.5 Gbps | 1 Gbps | 100 Mbps | 10 Mbps | no link |
|---|---|---|---|---|---|
| `#3b82f6` | `#14b8a6` | `#22c55e` | `#f59e0b` | `#9ca3af` | `#ef4444` |

## Development

```bash
node --test
```

The logic (units, adapters, layout) is exported from `dist/lan-topo-card.js` and tested with Node's built-in test
runner; the custom element is only defined in a browser.

## License

MIT © ngoviet
