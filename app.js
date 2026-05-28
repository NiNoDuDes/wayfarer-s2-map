/**
 * Wayfarer S2 Map — main application
 */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────
  const state = {
    map: null,
    userMarker: null,
    userPos: null,
    watchId: null,
    layers: { l14: null, l17: null, stops: null },
    toggles: { l14: true, l17: true, stops: false },
    tiles: null,          // { dark, sat, isSat }
    stopData: [],         // [{lat,lng,name,type}]
    renderScheduled: false
  };

  // ── Map init ───────────────────────────────────────────────────

  function initMap() {
    state.map = L.map('map', {
      center: [48.137154, 11.576124],
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
      tap: false
    });

    const darkTile = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 21, subdomains: 'abcd' }
    ).addTo(state.map);

    const satTile = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 21 }
    );

    state.tiles = { dark: darkTile, sat: satTile, isSat: false };

    state.layers.l14   = L.layerGroup().addTo(state.map);
    state.layers.l17   = L.layerGroup().addTo(state.map);
    state.layers.stops = L.layerGroup().addTo(state.map);

    state.map.on('moveend zoomend', onViewChange);
  }

  // ── GPS ────────────────────────────────────────────────────────

  function startGPS() {
    if (!navigator.geolocation) { showToast('Geolocation not supported'); return; }
    showToast('Locating…');
    navigator.geolocation.getCurrentPosition(onGPSSuccess, onGPSError, {
      enableHighAccuracy: true, timeout: 10000
    });
    state.watchId = navigator.geolocation.watchPosition(onGPSUpdate, null, {
      enableHighAccuracy: true, maximumAge: 5000
    });
  }

  function onGPSSuccess(pos) {
    const { latitude: lat, longitude: lng } = pos.coords;
    state.userPos = { lat, lng };
    state.map.setView([lat, lng], 17);
    updateUserMarker(lat, lng);
    renderCells();
    showToast('GPS locked');
  }

  function onGPSUpdate(pos) {
    const { latitude: lat, longitude: lng } = pos.coords;
    state.userPos = { lat, lng };
    updateUserMarker(lat, lng);
  }

  function onGPSError(err) { showToast('GPS error: ' + err.message); }

  function updateUserMarker(lat, lng) {
    if (state.userMarker) {
      state.userMarker.setLatLng([lat, lng]);
    } else {
      const icon = L.divIcon({
        className: '',
        html: '<div class="gps-dot"></div>',
        iconSize: [16, 16], iconAnchor: [8, 8]
      });
      state.userMarker = L.marker([lat, lng], { icon, zIndexOffset: 500 })
        .addTo(state.map);
    }
  }

  // ── Satellite toggle ───────────────────────────────────────────

  function toggleSatellite() {
    const t = state.tiles;
    if (t.isSat) {
      state.map.removeLayer(t.sat);
      t.dark.addTo(state.map);
    } else {
      state.map.removeLayer(t.dark);
      t.sat.addTo(state.map);
    }
    t.isSat = !t.isSat;
    document.getElementById('btn-sat').classList.toggle('active', t.isSat);
    showToast(t.isSat ? 'Satellite view' : 'Dark map');
  }

  // ── S2 cell rendering ──────────────────────────────────────────

  function onViewChange() {
    if (state.renderScheduled) return;
    state.renderScheduled = true;
    requestAnimationFrame(() => {
      state.renderScheduled = false;
      renderCells();
      updateStopBadge();
    });
  }

  function renderCells() {
    const z  = state.map.getZoom();
    const b  = state.map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();

    if (state.toggles.l14) renderLevel(14, sw, ne, z);
    else state.layers.l14.clearLayers();

    if (state.toggles.l17) renderLevel(17, sw, ne, z);
    else state.layers.l17.clearLayers();
  }

  function renderLevel(level, sw, ne, zoom) {
    const layer = level === 14 ? state.layers.l14 : state.layers.l17;
    layer.clearLayers();

    if (level === 14 && zoom < 10) return;
    if (level === 17 && zoom < 13) return;

    const cells = S2.getCellsInBounds(sw.lat, sw.lng, ne.lat, ne.lng, level);

    const color     = level === 14 ? '#ff9800' : '#4fc3f7';
    const weight    = level === 14 ? 2 : 1;
    const opacity   = level === 14 ? 0.7 : 0.5;
    const fill      = level === 14 ? 0.04 : 0.02;
    const showLabel = (level === 17 && zoom >= 17) || (level === 14 && zoom >= 13);

    cells.forEach(cell => {
      const latlngs = cell.corners.map(c => [c.lat, c.lng]);
      const poly = L.polygon(latlngs, { color, weight, opacity, fillOpacity: fill });
      poly.on('click', (e) => { L.DomEvent.stopPropagation(e); onCellClick(cell, level, e.latlng); });
      layer.addLayer(poly);

      if (showLabel) {
        const labelIcon = L.divIcon({
          className: 's2-label',
          html: level === 17 ? cell.token.slice(-4) : 'L14',
          iconSize: null
        });
        L.marker([cell.center.lat, cell.center.lng], {
          icon: labelIcon, interactive: false, zIndexOffset: -100
        }).addTo(layer);
      }
    });
  }

  // ── Cell tap popup ─────────────────────────────────────────────

  function onCellClick(cell, level, latlng) {
    const stopsInCell = countStopsInCell(cell);
    const gym = S2.gymCount(stopsInCell);

    const title = level === 17
      ? `L17 Cell <code style="font-size:11px">${cell.token}</code>`
      : 'L14 Cell';

    let html = `<div class="popup-title">${title}</div>`;

    if (level === 14) {
      html += `
        <div class="info-row">
          <span class="info-label">Stops in cell</span>
          <span class="info-value">${stopsInCell}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Gyms</span>
          <span class="info-value">${gym.gyms}</span>
        </div>`;
      if (gym.nextGymAt !== null) {
        html += `
        <div class="info-row">
          <span class="info-label">Next gym at</span>
          <span class="info-value">${gym.nextGymAt} stops (${gym.nextGymAt - stopsInCell} more)</span>
        </div>`;
      }
      const badge = gym.gyms > 0
        ? `<span class="gym-badge gym">🏟 ${gym.gyms} Gym${gym.gyms > 1 ? 's' : ''}</span>`
        : `<span class="gym-badge no-gym">No gym yet</span>`;
      html += `<div style="margin-top:6px">${badge}</div>`;
    } else {
      html += `
        <div class="info-row">
          <span class="info-label">Token</span>
          <span class="info-value">${cell.token}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Center</span>
          <span class="info-value">${cell.center.lat.toFixed(5)}, ${cell.center.lng.toFixed(5)}</span>
        </div>`;
    }

    L.popup({ maxWidth: 280 }).setLatLng(latlng).setContent(html).openOn(state.map);
  }

  function countStopsInCell(cell) {
    if (!state.stopData.length) return 0;
    return state.stopData.filter(s => pointInCell(s, cell)).length;
  }

  function pointInCell(pt, cell) {
    const lats = cell.corners.map(c => c.lat);
    const lngs = cell.corners.map(c => c.lng);
    return pt.lat >= Math.min(...lats) && pt.lat <= Math.max(...lats) &&
           pt.lng >= Math.min(...lngs) && pt.lng <= Math.max(...lngs);
  }

  // ── Import stops ───────────────────────────────────────────────

  function openImportModal() {
    document.getElementById('import-modal').classList.remove('hidden');
    document.getElementById('import-textarea').focus();
  }

  function closeImportModal() {
    document.getElementById('import-modal').classList.add('hidden');
  }

  function parseAndLoadStops() {
    const raw = document.getElementById('import-textarea').value.trim();
    if (!raw) { showToast('Nothing to import'); return; }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      showToast('Invalid JSON — check format');
      return;
    }

    if (!Array.isArray(parsed)) { showToast('Expected a JSON array'); return; }

    const stops = parsed.filter(s =>
      typeof s.lat === 'number' && typeof s.lng === 'number'
    ).map(s => ({
      lat: s.lat,
      lng: s.lng,
      name: s.name || 'Unnamed',
      type: s.type || 'stop'
    }));

    if (stops.length === 0) { showToast('No valid stops found'); return; }

    state.stopData = stops;
    state.toggles.stops = true;
    document.getElementById('btn-stops').classList.add('active');
    renderStops();
    updateStopBadge();
    closeImportModal();
    showToast(`${stops.length} stop${stops.length !== 1 ? 's' : ''} loaded`);
  }

  // ── Stop layer rendering ───────────────────────────────────────

  function renderStops() {
    state.layers.stops.clearLayers();
    if (!state.toggles.stops) { updateStopBadge(); return; }

    state.stopData.forEach(stop => {
      const isGym = stop.type === 'gym';
      const dot = isGym
        ? '<div class="stop-dot" style="background:#e91e63;box-shadow:0 0 6px #e91e63"></div>'
        : '<div class="stop-dot"></div>';
      const icon = L.divIcon({ className: '', html: dot, iconSize: [10, 10], iconAnchor: [5, 5] });
      const marker = L.marker([stop.lat, stop.lng], { icon, zIndexOffset: 200 });
      marker.on('click', () => onStopClick(stop));
      state.layers.stops.addLayer(marker);
    });

    updateStopBadge();
  }

  function onStopClick(stop) {
    const l14cell = S2.getCellForLatLng(stop.lat, stop.lng, 14);
    const stopsInCell = countStopsInCell(l14cell);
    const gym = S2.gymCount(stopsInCell);

    const html = `
      <div class="popup-title">${stop.name}</div>
      <div class="info-row">
        <span class="info-label">Type</span>
        <span class="info-value">${stop.type}</span>
      </div>
      <div class="info-row">
        <span class="info-label">L14 stops</span>
        <span class="info-value">${stopsInCell}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Gyms in L14</span>
        <span class="info-value">${gym.gyms}</span>
      </div>
      ${gym.nextGymAt !== null
        ? `<div class="info-row">
            <span class="info-label">Next gym at</span>
            <span class="info-value">${gym.nextGymAt} (${gym.nextGymAt - stopsInCell} more)</span>
          </div>`
        : ''}`;

    L.popup({ maxWidth: 260 })
      .setLatLng([stop.lat, stop.lng])
      .setContent(html)
      .openOn(state.map);
  }

  // ── Stop count badge ───────────────────────────────────────────

  function updateStopBadge() {
    const el = document.getElementById('stop-badge');

    if (!state.stopData.length || !state.toggles.stops) {
      el.classList.add('hidden');
      return;
    }

    const b  = state.map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();

    const visibleStops = state.stopData.filter(s =>
      s.lat >= sw.lat && s.lat <= ne.lat &&
      s.lng >= sw.lng && s.lng <= ne.lng
    );

    // Count gyms: one per L14 cell that has ≥ 2 stops
    const cellMap = new Map();
    visibleStops.forEach(s => {
      const cell = S2.getCellForLatLng(s.lat, s.lng, 14);
      const key = cell.token;
      cellMap.set(key, (cellMap.get(key) || 0) + 1);
    });
    let gymCount = 0;
    cellMap.forEach(count => { gymCount += S2.gymCount(count).gyms; });

    el.innerHTML =
      `<span class="badge-stops">${visibleStops.length}</span> stop${visibleStops.length !== 1 ? 's' : ''} · ` +
      `<span class="badge-gyms">${gymCount}</span> gym${gymCount !== 1 ? 's' : ''} in view`;
    el.classList.remove('hidden');
  }

  // ── Controls setup ─────────────────────────────────────────────

  function setupControls() {
    document.getElementById('btn-gps').addEventListener('click', () => {
      if (state.userPos) state.map.setView([state.userPos.lat, state.userPos.lng], 17);
      else startGPS();
    });

    document.getElementById('btn-sat').addEventListener('click', toggleSatellite);

    document.querySelectorAll('.toggle-btn[data-level]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = `l${btn.dataset.level}`;
        state.toggles[key] = !state.toggles[key];
        btn.classList.toggle('active', state.toggles[key]);
        renderCells();
        showToast(`L${btn.dataset.level} cells ${state.toggles[key] ? 'on' : 'off'}`);
      });
    });

    // Stops button: open import if no data, else toggle visibility
    document.getElementById('btn-stops').addEventListener('click', () => {
      if (state.stopData.length === 0) {
        openImportModal();
      } else {
        state.toggles.stops = !state.toggles.stops;
        document.getElementById('btn-stops').classList.toggle('active', state.toggles.stops);
        renderStops();
        showToast(`Stops ${state.toggles.stops ? 'shown' : 'hidden'}`);
      }
    });

    // Import modal
    document.getElementById('import-close').addEventListener('click', closeImportModal);
    document.getElementById('import-load').addEventListener('click', parseAndLoadStops);
    document.getElementById('import-clear').addEventListener('click', () => {
      state.stopData = [];
      state.toggles.stops = false;
      state.layers.stops.clearLayers();
      document.getElementById('btn-stops').classList.remove('active');
      document.getElementById('import-textarea').value = '';
      updateStopBadge();
      closeImportModal();
      showToast('Stops cleared');
    });

    // Close modal on backdrop click
    document.getElementById('import-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeImportModal();
    });

    document.getElementById('info-close').addEventListener('click', () => {
      document.getElementById('info-panel').classList.add('hidden');
    });
  }

  // ── Toast ──────────────────────────────────────────────────────

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  // ── Boot ───────────────────────────────────────────────────────

  function init() {
    initMap();
    setupControls();
    startGPS();
    renderCells();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
