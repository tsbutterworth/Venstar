const NormalSdk = require("@normalframework/applications-sdk");
const { v5: uuidv5 } = require("uuid");
const axios = require("axios");

const ROOT_NAMESPACE = "b9f3c721-4e8a-5d2b-a1f6-3c7e0d9b2f45";
const LAYER = "hpl:venstar";

/**
 * Invoke hook function
 * @param {NormalSdk.InvokeParams} params
 * @returns {NormalSdk.InvokeResult}
 */
module.exports = async ({ sdk, config }) => {
  if (!config.baseUrl) {
    return NormalSdk.InvokeError("missing baseUrl in configuration");
  }

  const tstatUrls = config.baseUrl.split(",").map(u => u.trim()).filter(Boolean);
  const username = config.username || "";
  const password = config.password || "";
  const authOpts = username ? { auth: { username, password } } : {};
  const allPoints = [];

  for (const tstatBase of tstatUrls) {
    const tstatNamespace = uuidv5(tstatBase, ROOT_NAMESPACE);

    let info;
    try {
      const res = await axios.get(`${tstatBase}/query/info`, { ...authOpts, timeout: 15000 });
      info = res.data;
    } catch (err) {
      sdk.logEvent(`[venstar] Failed to reach ${tstatBase}/query/info: ${err.message}`);
      continue;
    }

    const tstatName = info.name || tstatBase;
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
      const extraAttrs = units ? { units } : {};
      allPoints.push(makePoint(key, label, extraAttrs));
    }

    try {
      const sensRes = await axios.get(`${tstatBase}/query/sensors`, { ...authOpts, timeout: 10000 });
      const sensors = sensRes.data?.sensors || [];
      sensors.forEach((sensor, idx) => {
        allPoints.push(makePoint(
          `${tstatBase}/sensors/${idx}/temp`,
          `${tstatName} Sensor: ${sensor.name || idx}`,
          {
            "venstar/source":      "sensors",
            "venstar/sensorIndex": String(idx),
            units:                 tempUnit,
          }
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
        {
          "venstar/source":     "runtimes",
          "venstar/runtimeKey": rk,
          units:                "min",
        }
      ));
    }
  }

  const batch_size = 100;
  for (let i = 0; i < allPoints.length; i += batch_size) {
    await sdk.http.post(`http://${process.env.NFURL}/api/v1/point/points`, {
      points: allPoints.slice(i, i + batch_size),
    }, { timeout: 30000 });
  }

  sdk.logEvent(`[venstar] Import complete. ${allPoints.length} points across ${tstatUrls.length} thermostat(s)`);
};
