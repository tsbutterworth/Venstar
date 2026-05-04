# app-venstar

Normal Framework driver for **Venstar VYG-4900 ColorTouch** thermostats.

Polls multiple thermostats via the Venstar local REST API and registers all data points into the NF layer `hpl:venstar`.

---

## Points Registered Per Thermostat

| Point Key | Description | Units |
|-----------|-------------|-------|
| `spacetemp` | Current zone temperature | °F / °C |
| `heattemp` | Heating setpoint | °F / °C |
| `cooltemp` | Cooling setpoint | °F / °C |
| `mode` | Operating mode (0=off 1=heat 2=cool 3=auto) | — |
| `state` | System state (0=idle 1=heating 2=cooling 3=lockout 4=error) | — |
| `fan` | Fan setting (0=auto 1=on) | — |
| `fanstate` | Fan running (0=off 1=on) | — |
| `schedule` | Schedule active (0=off 1=on) | — |
| `schedulepart` | Schedule period (0=morning 1=day 2=evening 3=night 255=inactive) | — |
| `sensors/<n>/temp` | Temperature from each attached sensor | °F / °C |
| `runtimes/heat1` | Heat stage 1 runtime (most recent bucket) | min |
| `runtimes/heat2` | Heat stage 2 runtime | min |
| `runtimes/cool1` | Cool stage 1 runtime | min |
| `runtimes/cool2` | Cool stage 2 runtime | min |
| `runtimes/aux1` | Aux heat stage 1 runtime | min |
| `runtimes/aux2` | Aux heat stage 2 runtime | min |
| `runtimes/fc` | Fan runtime | min |

---

## Prerequisites

**Enable Local API on each thermostat:**
1. On the VYG-4900: `Menu → WiFi → Local API Option → Local API: ON`
2. Verify by browsing to `http://<tstat-ip>/` — should return JSON with `api_ver`, `type`, `model`

---

## Installation on Normal Framework Gateway

1. In the NF gateway UI, go to **Applications**
2. Click **Add Application**
3. Set the Git URL to: `https://github.com/tsbutterworth/Venstar.git`
4. Wait for install — verify the `hooks/` folder appears in the Git tab and hooks appear in the Hooks tab

---

## Configuration

After install, configure the app with the following keys:

| Key | Description | Example |
|-----|-------------|---------|
| `baseUrl` | Comma-separated list of thermostat IP URLs | `http://10.9.3.10, http://10.9.3.11` |
| `username` | HTTP Basic auth username (leave blank if Local API auth is disabled) | `admin` |
| `password` | HTTP Basic auth password (leave blank if Local API auth is disabled) | `password` |

---

## Hooks

| Hook | Schedule | Description |
|------|----------|-------------|
| `import-points-venstar` | Manual / on-demand | Discovers all thermostats and registers points in `hpl:venstar` |
| `poll-values-venstar` | Every 1 minute | Fetches current values from all thermostats and updates NF |

---

## Repo Structure

```
app-venstar/
├── app.json                          # NF app manifest
├── package.json                      # Node dependencies
├── .gitignore                        # Excludes node_modules, .npm
├── README.md
├── hooks/
│   ├── import-points-venstar.js      # Point discovery hook
│   └── poll-values-venstar.js        # Value polling hook
└── hooks-update/
    ├── import-points-venstar.json    # Hook registration (import)
    └── poll-values-venstar.json      # Hook registration (poll, 1-min schedule)
```
