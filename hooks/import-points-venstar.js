const NormalSdk = require("@normalframework/applications-sdk");
const { v5: uuidv5 } = require("uuid");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const ROOT_NAMESPACE = "b9f3c721-4e8a-5d2b-a1f6-3c7e0d9b2f45";
const LAYER = "hpl:venstar";
const DEVICES_FILE = path.join(__dirname, "../Venstar-devices.json");

/**
 * Invoke hook function
 * @param {NormalSdk.InvokeParams} params
 * @returns {NormalSdk.InvokeResult}
 */
module.exports = async ({ sdk, config }) => {
  // Load device list from venstar-devices.json
  // config.baseUrl can still be used to override/add a single device for testing
  let devices = [];
  try {
    const raw = fs.readFileSync(DEVICES_FILE, "utf8");
    devices = JSON.parse(raw);
    sdk.logEvent(`[venstar] Loaded ${devices.length} device(s) from venstar-devices.json`);
  } catch (err) {
    sdk.logEvent(`[venstar] Could not read venstar-devices.json: ${err.message}`);
  }

  // Allow config.baseUrl to add/override devices for testing
  if (config.baseUrl) {
    const overrideUrls = config.baseUrl.split(",").map(u => u.trim()).filter(Boolean);
    for (const url of overrideUrls) {
      if (!devices.find(d => d.url === url)) {
        devices.push({ url, name: url });
      }
    }
  }

  if (devices.length === 0) {
    return NormalSdk.InvokeError("No devices found in venstar-devices.json and no baseUrl configured");
  }

  const username = config.username || "";
  const password = config.password || "";
  const authOpts = username ? { auth: { username, password } } : {};
  const allPoints = [];

  for (const device of devices) {
    const tstatBase = device.url.replace(/\/+$/, "");
    const tstatNamespace = uuidv5(tstatBase, ROOT_NAMESPACE);

    let info;
    try {
      const res = await axios.get(`${tstatBase}/query/info`, { ...authOpts, timeout: 15000 });
      info = res.data;
    } catch (err) {
      sdk.logEvent(`[venstar] Failed to reach ${tstatBase}: ${err.message}`);
      continue;
    }

    // Prefer the name from venstar-devices.json, fall back to what the tstat reports
    const tstatName = device.name || info.name || tstatBase;
    sdk.logEvent(`[venstar] Importing points from: ${tstatName} (${tstatBase})`);
    const tempUnit = info.tempunits === 1 ? "C" : "F";

    const makePoint = (pointKey, displayName, extraAttrs = {}) => ({
      uuid: uuidv5(pointKey, tstatNamespace),
      layer: LAYER,
      parent_uuid: tstatNamespace,
      attrs: {
        name:             displayName,
        "venstar/key":    pointKey,
        "venstar/source": "info",
        tstatUrl:         tstatBase,
        tstatName:        tstatName,
        ...extraAttrs,
      },
    });

    const infoPoints = [
      { key: `${tstatBase}/spacetemp`,    label: `${tstatName} Space Temp`,      units: tempUnit },
      { key: `${tstatBase}/heattemp`,     label: `${tstatName} Heat Setpoint`,   units: tempUnit },
      { key: `${tstatBase}/cooltemp`,     label: `${tstatName} Cool Setpoint`,   units: tempUnit },
      { key: `${tstatBase}/mode`,         label: `${tstatName} Mode` },
      { key: `${tstatBase}/state`,        label: `${tstatName} State` },
      { key: `${tstatBase}/fan`,          label: `${tstatName} Fan Setting` },
      { key: `${tstatBase}/fanstate`,     label: `${tstatName} Fan Running` },
      { key: `${tstatBase}/schedule`,     label: `${tstatName} Schedule Active` },
      { key: `${tstatBase}/schedulepart`, label: `${tstatName} Schedule Part` },
    ];

    for (const { key, label, units } of infoPoints) {
      allPoints.push(makePoint(key, label, units ? { units } : {}));
    }

    try {
      const sensRes = await axios.get(`${tstatBase}/query/sensors`, { ...authOpts, timeout: 10000 });
      const sensors = sensRes.data?.sensors || [];
      sensors.forEach((sensor, idx) => {
        allPoints.push(makePoint(
          `${tstatBase}/sensors/${idx}/temp`,
          `${tstatName} Sensor: ${sensor.name || idx}`,
          { "venstar/source": "sensors", "venstar/sensorIndex": String(idx), units: tempUnit }
        ));
      });
      sdk.logEvent(`[venstar] Found ${sensors.length} sensor(s) on ${tstatName}`);
    } catch (err) {
      sdk.logEvent(`[venstar] Could not fetch sensors from ${tstatBase}: ${err.message}`);
    }

    for (const rk of ["heat1", "heat2", "cool1", "cool2", "aux1", "aux2", "fc"]) {
      allPoints.push(makePoint(
        `${tstatBase}/runtimes/${rk}`,
        `${tstatName} Runtime ${rk.toUpperCase()}`,
        { "venstar/source": "runtimes", "venstar/runtimeKey": rk, units: "min" }
      ));
    }
  }

  const batch_size = 100;
  for (let i = 0; i < allPoints.length; i += batch_size) {
    await sdk.http.post(`http://${process.env.NFURL}/api/v1/point/points`, {
      points: allPoints.slice(i, i + batch_size),
    }, { timeout: 30000 });
  }

  sdk.logEvent(`[venstar] Import complete. ${allPoints.length} points across ${devices.length} thermostat(s)`);
};
