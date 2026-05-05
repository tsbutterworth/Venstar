const { v5: uuidv5 } = require('uuid');
const axios = require('axios');

// Must match import-points-venstar.js exactly
const ROOT_NAMESPACE = 'b9f3c721-4e8a-5d2b-a1f6-3c7e0d9b2f45';
const LAYER = 'hpl:venstar';

/**
 * Venstar ColorTouch — poll-values
 *
 * Runs on a 1-minute schedule. For each registered point in hpl:venstar,
 * fetches fresh data from the appropriate thermostat endpoint and pushes
 * value updates back to Normal Framework.
 *
 * Routing strategy (mirrors Niagara R2 pattern):
 *   Primary:  reads tstatUrl attribute stored on each point during import
 *   Fallback: matches parent_uuid against derived per-tstat namespace
 */
module.exports = async (config, points, sdk) => {
  const baseUrlRaw = config.baseUrl || '';
  const tstatUrls = baseUrlRaw.split(',').map(u => u.trim()).filter(Boolean);
  const username = config.username || '';
  const password = config.password || '';

  const authOpts = username
    ? { auth: { username, password } }
    : {};

  // Build namespace → tstatUrl fallback map
  const namespaceMap = {};
  for (const url of tstatUrls) {
    namespaceMap[uuidv5(url, ROOT_NAMESPACE)] = url;
  }

  // Group points by thermostat URL so we make one API call per tstat per source
  // rather than one HTTP request per point
  const tstatGroups = {};  // tstatBase → { info: [...], sensors: [...], runtimes: [...] }

  for (const point of points) {
    let tstatBase = point.attrs?.tstatUrl?.value;
    if (!tstatBase && point.parent_uuid) {
      tstatBase = namespaceMap[point.parent_uuid];
    }
    if (!tstatBase) {
      console.warn(`[venstar] Cannot resolve tstat URL for point ${point.uuid}`);
      continue;
    }

    if (!tstatGroups[tstatBase]) {
      tstatGroups[tstatBase] = { info: [], sensors: [], runtimes: [] };
    }

    const source = point.attrs?.['venstar/source']?.value || 'info';
    tstatGroups[tstatBase][source].push(point);
  }

  const updates = [];

  for (const [tstatBase, groups] of Object.entries(tstatGroups)) {

    // ── Fetch /query/info (covers scalar points) ───────────────────────────
    if (groups.info.length > 0) {
      try {
        const res = await axios.get(`${tstatBase}/query/info`, {
          ...authOpts,
          timeout: 10000,
        });
        const info = res.data;

        // Map of pointKey suffix → value from info response
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
          const key = point.attrs?.['venstar/key']?.value;
          const val = infoValues[key];
          if (val !== undefined && val !== null) {
            updates.push({ uuid: point.uuid, layer: LAYER, value: String(val) });
          }
        }
      } catch (err) {
        console.error(`[venstar] poll /query/info failed @ ${tstatBase}: ${err.message}`);
      }
    }

    // ── Fetch /query/sensors ───────────────────────────────────────────────
    if (groups.sensors.length > 0) {
      try {
        const res = await axios.get(`${tstatBase}/query/sensors`, {
          ...authOpts,
          timeout: 10000,
        });
        const sensors = res.data?.sensors || [];

        for (const point of groups.sensors) {
          const idx = parseInt(point.attrs?.['venstar/sensorIndex']?.value, 10);
          if (!isNaN(idx) && sensors[idx] !== undefined) {
            const temp = sensors[idx].temp;
            if (temp !== undefined) {
              updates.push({ uuid: point.uuid, layer: LAYER, value: String(temp) });
            }
          }
        }
      } catch (err) {
        console.error(`[venstar] poll /query/sensors failed @ ${tstatBase}: ${err.message}`);
      }
    }

    // ── Fetch /query/runtimes ──────────────────────────────────────────────
    if (groups.runtimes.length > 0) {
      try {
        const res = await axios.get(`${tstatBase}/query/runtimes`, {
          ...authOpts,
          timeout: 10000,
        });
        // The API returns an array; the most recent bucket is the last entry
        const runtimes = res.data?.runtimes || [];
        const latest = runtimes[runtimes.length - 1];

        if (latest) {
          for (const point of groups.runtimes) {
            const rk = point.attrs?.['venstar/runtimeKey']?.value;
            if (rk && latest[rk] !== undefined) {
              updates.push({ uuid: point.uuid, layer: LAYER, value: String(latest[rk]) });
            }
          }
        }
      } catch (err) {
        console.error(`[venstar] poll /query/runtimes failed @ ${tstatBase}: ${err.message}`);
      }
    }
  }

  if (updates.length) await sdk.updateValues(updates);
  console.log(`[venstar] Polled ${updates.length}/${points.length} points across ${Object.keys(tstatGroups).length} thermostat(s)`);
};
