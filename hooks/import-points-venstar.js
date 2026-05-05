const { v5: uuidv5 } = require('uuid');
const axios = require('axios');

// Must match poll-values-venstar.js exactly
const ROOT_NAMESPACE = 'b9f3c721-4e8a-5d2b-a1f6-3c7e0d9b2f45';
const LAYER = 'hpl:venstar';

/**
 * Venstar ColorTouch — import-points
 *
 * Discovers points from one or more VYG-4900 thermostats and registers
 * them in the Normal Framework layer hpl:venstar.
 *
 * Config keys:
 *   baseUrl   — comma-separated list of thermostat base URLs
 *                e.g. "http://10.9.3.10, http://10.9.3.11"
 *   username  — HTTP Basic auth username (leave blank if auth not enabled)
 *   password  — HTTP Basic auth password (leave blank if auth not enabled)
 *
 * Points registered per thermostat:
 *   <tstat>/spacetemp        — current zone temperature
 *   <tstat>/heattemp         — heating setpoint
 *   <tstat>/cooltemp         — cooling setpoint
 *   <tstat>/mode             — operating mode  (0=off 1=heat 2=cool 3=auto)
 *   <tstat>/state            — system state    (0=idle 1=heating 2=cooling 3=lockout 4=error)
 *   <tstat>/fan              — fan setting     (0=auto 1=on)
 *   <tstat>/fanstate         — fan running     (0=off 1=on)
 *   <tstat>/schedule         — schedule active (0=off 1=on)
 *   <tstat>/schedulepart     — schedule period (0=morning 1=day 2=evening 3=night 255=inactive)
 *   <tstat>/sensors/<n>/temp — temperature from each sensor reported by /query/sensors
 *   <tstat>/runtimes/heat1   — heat stage 1 runtime minutes (most recent bucket)
 *   <tstat>/runtimes/cool1   — cool stage 1 runtime minutes (most recent bucket)
 */
module.exports = async (config, points, sdk) => {
  const baseUrlRaw = config.baseUrl || '';
  const tstatUrls = baseUrlRaw.split(',').map(u => u.trim()).filter(Boolean);
  const username = config.username || '';
  const password = config.password || '';

  if (!tstatUrls.length) throw new Error('No thermostat URLs configured in baseUrl');

  const authOpts = username
    ? { auth: { username, password } }
    : {};

  const allPoints = [];

  for (const tstatBase of tstatUrls) {
    const tstatNamespace = uuidv5(tstatBase, ROOT_NAMESPACE);

    // ── Fetch /query/info ──────────────────────────────────────────────────
    let info;
    try {
      const res = await axios.get(`${tstatBase}/query/info`, {
        ...authOpts,
        timeout: 15000,
      });
      info = res.data;
    } catch (err) {
      console.error(`[venstar] Failed to reach ${tstatBase}/query/info: ${err.message}`);
      continue;
    }

    const tstatName = info.name || tstatBase;

    // Helper: build a point object
    const makePoint = (pointKey, displayName, value, extraAttrs = {}) => ({
      uuid: uuidv5(pointKey, tstatNamespace),
      layer: LAYER,
      parent_uuid: tstatNamespace,
      attrs: {
        name:        { value: displayName },
        'venstar/key': { value: pointKey },
        'venstar/source': { value: 'info' },
        tstatUrl:    { value: tstatBase },
        tstatName:   { value: tstatName },
        ...extraAttrs,
      },
    });

    // ── /query/info scalar points ──────────────────────────────────────────
    const infoPoints = [
      { key: `${tstatBase}/spacetemp`,    label: `${tstatName} Space Temp`,        units: info.tempunits === 1 ? '°C' : '°F' },
      { key: `${tstatBase}/heattemp`,     label: `${tstatName} Heat Setpoint`,     units: info.tempunits === 1 ? '°C' : '°F' },
      { key: `${tstatBase}/cooltemp`,     label: `${tstatName} Cool Setpoint`,     units: info.tempunits === 1 ? '°C' : '°F' },
      { key: `${tstatBase}/mode`,         label: `${tstatName} Mode` },
      { key: `${tstatBase}/state`,        label: `${tstatName} State` },
      { key: `${tstatBase}/fan`,          label: `${tstatName} Fan Setting` },
      { key: `${tstatBase}/fanstate`,     label: `${tstatName} Fan Running` },
      { key: `${tstatBase}/schedule`,     label: `${tstatName} Schedule Active` },
      { key: `${tstatBase}/schedulepart`, label: `${tstatName} Schedule Part` },
    ];

    for (const { key, label, units } of infoPoints) {
      const extraAttrs = units ? { units: { value: units } } : {};
      allPoints.push(makePoint(key, label, null, extraAttrs));
    }

    // ── /query/sensors ─────────────────────────────────────────────────────
    try {
      const sensRes = await axios.get(`${tstatBase}/query/sensors`, {
        ...authOpts,
        timeout: 10000,
      });
      const sensors = sensRes.data?.sensors || [];
      sensors.forEach((sensor, idx) => {
        const key = `${tstatBase}/sensors/${idx}/temp`;
        const label = `${tstatName} Sensor: ${sensor.name || idx}`;
        allPoints.push(makePoint(key, label, null, {
          'venstar/source': { value: 'sensors' },
          'venstar/sensorIndex': { value: String(idx) },
          units: { value: info.tempunits === 1 ? '°C' : '°F' },
        }));
      });
    } catch (err) {
      console.warn(`[venstar] Could not fetch sensors from ${tstatBase}: ${err.message}`);
    }

    // ── /query/runtimes ────────────────────────────────────────────────────
    const runtimeKeys = ['heat1', 'heat2', 'cool1', 'cool2', 'aux1', 'aux2', 'fc'];
    for (const rk of runtimeKeys) {
      const key = `${tstatBase}/runtimes/${rk}`;
      allPoints.push(makePoint(key, `${tstatName} Runtime ${rk.toUpperCase()}`, null, {
        'venstar/source': { value: 'runtimes' },
        'venstar/runtimeKey': { value: rk },
        units: { value: 'min' },
      }));
    }
  }

  await sdk.upsertPoints(allPoints);
  console.log(`[venstar] Imported ${allPoints.length} points across ${tstatUrls.length} thermostat(s)`);
};
