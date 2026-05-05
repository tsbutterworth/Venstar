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
module.exports = async ({ sdk, config, points }) => {
  if (!config.baseUrl) {
    return NormalSdk.InvokeError("missing baseUrl in configuration");
  }

  const tstatUrls = config.baseUrl.split(",").map(u => u.trim()).filter(Boolean);
  const username = config.username || "";
  const password = config.password || "";
  const authOpts = username ? { auth: { username, password } } : {};

  const namespaceMap = {};
  for (const url of tstatUrls) {
    namespaceMap[uuidv5(url, ROOT_NAMESPACE)] = url;
  }

  const tstatGroups = {};
  for (const point of points) {
    let tstatBase = point.attrs?.tstatUrl?.value;
    if (!tstatBase && point.parent_uuid) tstatBase = namespaceMap[point.parent_uuid];
    if (!tstatBase) continue;

    if (!tstatGroups[tstatBase]) tstatGroups[tstatBase] = { info: [], sensors: [], runtimes: [] };
    const source = point.attrs?.["venstar/source"]?.value || "info";
    tstatGroups[tstatBase][source].push(point);
  }

  const updates = [];

  for (const [tstatBase, groups] of Object.entries(tstatGroups)) {

    if (groups.info.length > 0) {
      try {
        const res = await axios.get(`${tstatBase}/query/info`, { ...authOpts, timeout: 10000 });
        const info = res.data;
        const infoValues = {
          [`${tstatBase}/spacetemp`]:    info.spacetemp,
          [`${tstatBase}/heattemp`]:     info.heattemp,
          [`${tstatBase}/cooltemp`]:     info.cooltemp,
          [`${tstatBase}/mode`]:         info.mode,
          [`${tstatBase}/state`]:        info.state,
          [`${tstatBase}/fan`]:          info.fan,
          [`${tstatBase}/fanstate`]:     info.fanstate,
          [`${tstatBase}/schedule`]:     info.schedule,
          [`${tstatBase}/schedulepart`]: info.schedulepart,
        };
        for (const point of groups.info) {
          const key = point.attrs?.["venstar/key"]?.value;
          const val = infoValues[key];
          if (val !== undefined && val !== null) {
            updates.push({ uuid: point.uuid, layer: LAYER, value: String(val) });
          }
        }
      } catch (err) {
        sdk.logEvent(`[venstar] poll /query/info failed @ ${tstatBase}: ${err.message}`);
      }
    }

    if (groups.sensors.length > 0) {
      try {
        const res = await axios.get(`${tstatBase}/query/sensors`, { ...authOpts, timeout: 10000 });
        const sensors = res.data?.sensors || [];
        for (const point of groups.sensors) {
          const idx = parseInt(point.attrs?.["venstar/sensorIndex"]?.value, 10);
          if (!isNaN(idx) && sensors[idx] !== undefined && sensors[idx].temp !== undefined) {
            updates.push({ uuid: point.uuid, layer: LAYER, value: String(sensors[idx].temp) });
          }
        }
      } catch (err) {
        sdk.logEvent(`[venstar] poll /query/sensors failed @ ${tstatBase}: ${err.message}`);
      }
    }

    if (groups.runtimes.length > 0) {
      try {
        const res = await axios.get(`${tstatBase}/query/runtimes`, { ...authOpts, timeout: 10000 });
        const runtimes = res.data?.runtimes || [];
        const latest = runtimes[runtimes.length - 1];
        if (latest) {
          for (const point of groups.runtimes) {
            const rk = point.attrs?.["venstar/runtimeKey"]?.value;
            if (rk && latest[rk] !== undefined) {
              updates.push({ uuid: point.uuid, layer: LAYER, value: String(latest[rk]) });
            }
          }
        }
      } catch (err) {
        sdk.logEvent(`[venstar] poll /query/runtimes failed @ ${tstatBase}: ${err.message}`);
      }
    }
  }

  const batch_size = 500;
  for (let i = 0; i < updates.length; i += batch_size) {
    await sdk.http.post(`http://${process.env.NFURL}/api/v1/point/data`, {
      updates: updates.slice(i, i + batch_size),
    }, { timeout: 15000 });
  }

  sdk.logEvent(`[venstar] Polled ${updates.length}/${points.length} points across ${Object.keys(tstatGroups).length} thermostat(s)`);
};
