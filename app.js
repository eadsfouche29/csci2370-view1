/* View 1: California overview — north-up map of shaded terrain + PRISM climate drape + fire perimeters.
   Navigation copies a standard web map (USGS National Map viewer): drag to pan, scroll/pinch to zoom
   toward the cursor, +/−/home buttons, scale bar and cursor readout. No tilt or rotation.
   Data is produced by view1_prep/prep_view1.py. 1 world unit = 1 km. */
(function () {
'use strict';

// Where a fire click goes. View 2 needs to read ?fire=<key> to open the right fire.
var VIEW2_URL = 'https://madisonsansone.github.io/csci2370-view2/';

// One-hue sequential ramps, light -> dark (dataviz palette: blue for precip, orange for temp)
var RAMPS = {
  precip: ['#EEF5FD', '#CDE2FB', '#9EC5F4', '#6DA7EC', '#3987E5', '#256ABF', '#184F95', '#0D366B'],
  temp:   ['#FDF1E9', '#FBD7C2', '#F7B48E', '#F18F5E', '#EB6834', '#C9501F', '#9C3C15', '#6B290E']
};
var SEVERITY = [['high', 'High', '--sev1'], ['moderate', 'Moderate', '--sev2'], ['low', 'Low', '--sev3'], ['very low', 'Very low', '--sev4']];
// Fire labels sit above each perimeter; North Complex and Caldor go below so neighbours don't collide.
var LABEL_BELOW = { north: true, caldor: true };
// State names in grid km (California Albers, projected with GDAL). CALIFORNIA sits in the San Joaquin
// Valley and runs along the valley axis (Sacramento -> Bakersfield is ~58 deg); NEVADA sits in central Nevada.
var STATE_LABELS = [
  { text: 'California', x: 366.3, y: 576.3, angle: 57 },   // 37.25 N, 120.55 W
  { text: 'Nevada',     x: 682.8, y: 366.4, angle: 0 }     // 39.10 N, 116.90 W
];

var state = { variable: 'precip', year: 'all', exag: 5, hover: null };
// Temperature display: most of California sits at 12-18 C, so the color stops are placed halfway
// between even spacing and equal-area (quantile) spacing over 0-25 C. The legend draws the same stops.
var TEMP_DISPLAY = { min: 0, max: 25, at: [0, 6.5, 9.8, 12.6, 15.1, 17.4, 20.2, 24.5], ticks: [0, 5, 10, 15, 20, 25] };
var LANDSAT_DESAT = 0.2;   // 0 = full Landsat color, 1 = grayscale
// Relief shading comes from an offline Blender Cycles render (view1_prep/bake_relief.py, finalized by
// relief.py into data/relief.jpg). Strength 0 = flat color, 1 = full render. Outside California the
// Landsat context and California both get the full relief.
// contrast: exponent on the normalized shade (a curves adjustment), >1 deepens shadows and brightens lit slopes.
var RELIEF = { california: 1.0, context: 1.0, contrast: 1.1 };
var stage = document.getElementById('stage');
var labelsEl = document.getElementById('labels');
var card = document.getElementById('card');

// floating map panel: Hide/Show collapses it to a small "Map layers" tab (starts collapsed on phones)
var aside = document.querySelector('aside'), panelToggle = document.getElementById('panel-toggle');
function collapsePanel(c) {
  aside.classList.toggle('collapsed', c);
  panelToggle.textContent = c ? 'Show' : 'Hide';
  panelToggle.setAttribute('aria-expanded', String(!c));
  window.dispatchEvent(new Event('v1-panel'));
}
panelToggle.addEventListener('click', function () { collapsePanel(!aside.classList.contains('collapsed')); });
if (window.matchMedia('(max-width: 800px)').matches) collapsePanel(true);

// ------------------------------------------------------------------ loading
function loadImageData(url) {
  return fetch(url, { cache: 'no-cache' }).then(function (r) { return r.blob(); })
    .then(function (b) { return createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); })
    .then(function (bmp) {
      var c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      var ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height);
    });
}

Promise.all([
  fetch('data/meta.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }),
  fetch('data/fires.geojson', { cache: 'no-cache' }).then(function (r) { return r.json(); }),
  loadImageData('data/terrain.png'),
  loadImageData('data/layers.png'),
  loadImageData('data/landsat.jpg'),
  fetch('data/relief.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rj) {
    if (!rj) return null;
    return new Promise(function (ok) {
      var img = new Image();
      img.onload = function () { ok({ meta: rj, img: img }); };
      img.onerror = function () { ok(null); };
      img.src = 'data/' + rj.file + '?v=' + (rj.version || Date.now());   // new render = new URL, never a stale cache
    });
  }).catch(function () { return null; })
]).then(function (res) { init(res[0], res[1], res[2], res[3], res[4], res[5]); })
  .catch(function (e) {
    document.getElementById('loading').textContent = 'Could not load data (' + e.message + '). Serve this folder over http, e.g. python3 -m http.server.';
    console.error(e);
  });

// ------------------------------------------------------------------ helpers
function hexToRgb(h) { h = h.trim().replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
// at (optional): data value of each color stop; decode: byte -> data value. Without them the
// stops are spread evenly over the encoded byte range.
function rampLUT(stops, at, decode) {
  var rgb = stops.map(hexToRgb), lut = new Uint8ClampedArray(256 * 3), n = rgb.length;
  for (var i = 0; i < 256; i++) {
    var t;
    if (at) {
      var v = decode(i), k0 = 0;
      if (v <= at[0]) t = 0; else if (v >= at[n - 1]) t = n - 1;
      else { while (v > at[k0 + 1]) k0++; t = k0 + (v - at[k0]) / (at[k0 + 1] - at[k0]); }
    } else t = Math.max(0, (i - 1) / 254) * (n - 1);
    var k = Math.min(n - 2, Math.floor(t)), f = t - k;
    for (var c = 0; c < 3; c++) lut[i * 3 + c] = rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * f;
  }
  return lut;
}
function fmt(n, d) { return n == null ? '–' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
function pct(x) { return x == null ? '–' : Math.round(x * 100) + '%'; }
function dateStr(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }

// even-odd point in (Multi)Polygon, coordinates in km (x right, y down)
function inGeom(g, x, y) {
  var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates, inside = false;
  for (var p = 0; p < polys.length; p++) for (var r = 0; r < polys[p].length; r++) {
    var ring = polys[p][r];
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// Inverse California Albers (EPSG:3310, GRS80) -> [lon, lat] in degrees. Snyder (1987) eqs 14-19, 3-16.
var albersInverse = (function () {
  var a = 6378137, f = 1 / 298.257222101, e2 = 2 * f - f * f, e = Math.sqrt(e2), D = Math.PI / 180;
  function m(p) { return Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) * Math.sin(p)); }
  function q(p) { var s = Math.sin(p); return (1 - e2) * (s / (1 - e2 * s * s) - Math.log((1 - e * s) / (1 + e * s)) / (2 * e)); }
  var p1 = 34 * D, p2 = 40.5 * D, m1 = m(p1), m2 = m(p2), q1 = q(p1), q2 = q(p2);
  var n = (m1 * m1 - m2 * m2) / (q2 - q1), C = m1 * m1 + n * q1, rho0 = a * Math.sqrt(C - n * q(0)) / n;
  return function (X, Y) {
    var x = X, y = Y + 4000000, rho = Math.hypot(x, rho0 - y), th = Math.atan2(x, rho0 - y);
    var qq = (C - rho * rho * n * n / (a * a)) / n, p = Math.asin(qq / 2);
    for (var i = 0; i < 8; i++) {
      var s = Math.sin(p), c = Math.cos(p), t = 1 - e2 * s * s;
      p += t * t / (2 * c) * (qq / (1 - e2) - s / t + Math.log((1 - e * s) / (1 + e * s)) / (2 * e));
    }
    return [-120 + th / n / D, p / D];
  };
})();

// ------------------------------------------------------------------ main
function init(meta, firesGeo, terrainImg, layersImg, landsatImg, relief) {
  document.getElementById('loading').remove();
  var W = meta.width_km, H = meta.height_km;
  var tw = meta.terrain.w, th = meta.terrain.h, tres = meta.terrain.res_m / 1000;
  var fireStats = {}; meta.fires.forEach(function (f) { fireStats[f.key] = f; });
  var fireGeo = {}; firesGeo.features.forEach(function (f) { fireGeo[f.properties.key] = f; });

  // elevation grid in km
  var elev = new Float32Array(tw * th), td = terrainImg.data;
  for (var i = 0; i < tw * th; i++) elev[i] = ((td[i * 4] << 8) + td[i * 4 + 1] - meta.terrain.offset_m) / 1000;
  function elevAt(x, y) {            // bilinear, x/y in km
    var gx = Math.min(tw - 1.001, Math.max(0, x / tres - 0.5)), gy = Math.min(th - 1.001, Math.max(0, y / tres - 0.5));
    var i0 = Math.floor(gx), j0 = Math.floor(gy), fx = gx - i0, fy = gy - j0;
    var a = elev[j0 * tw + i0], b = elev[j0 * tw + i0 + 1], c = elev[(j0 + 1) * tw + i0], d = elev[(j0 + 1) * tw + i0 + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  // ---------------- three.js scene
  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  stage.insertBefore(renderer.domElement, stage.firstChild);
  var scene = new THREE.Scene();
  // Straight-down orthographic camera, north up: the scene reads as a flat map with shaded relief.
  var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 5000);
  camera.up.set(0, 0, -1);

  // world: x = km east, z = km south, y = km up (scaled by exaggeration). Centered on the grid.
  var world = new THREE.Group(); world.position.set(-W / 2, 0, -H / 2); scene.add(world);
  var terrainGroup = new THREE.Group(); world.add(terrainGroup);

  // climate texture (rebuilt on toggle / theme change)
  var lw = meta.layers.w, lh = meta.layers.h, ld = layersImg.data;
  var texCanvas = document.createElement('canvas'); texCanvas.width = lw; texCanvas.height = lh;
  var texCtx = texCanvas.getContext('2d');
  var tex = new THREE.CanvasTexture(texCanvas);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();   // raw sRGB bytes, read as-is by the shader
  function paintClimate() {
    var lut = state.variable === 'temp'
      ? rampLUT(RAMPS.temp, TEMP_DISPLAY.at, function (i) { return meta.temp.min + (i - 1) / 254 * (meta.temp.max - meta.temp.min); })
      : rampLUT(RAMPS.precip);
    var ch = state.variable === 'precip' ? 0 : 1;
    var water = hexToRgb(cssVar('--water')), sat = landsatImg.data;
    var out = texCtx.createImageData(lw, lh), o = out.data;
    for (var p = 0, n = lw * lh; p < n; p++) {
      var m = ld[p * 4 + 2], q = p * 4;
      if (m === 255) { var v = ld[p * 4 + ch]; o[q] = lut[v * 3]; o[q + 1] = lut[v * 3 + 1]; o[q + 2] = lut[v * 3 + 2]; }
      else if (m === 128) {
        // Landsat true color for land outside California, slightly desaturated so it stays context
        var r = sat[q], g = sat[q + 1], b = sat[q + 2], y = 0.299 * r + 0.587 * g + 0.114 * b;
        o[q] = r + (y - r) * LANDSAT_DESAT; o[q + 1] = g + (y - g) * LANDSAT_DESAT; o[q + 2] = b + (y - b) * LANDSAT_DESAT;
      }
      else { o[q] = water[0]; o[q + 1] = water[1]; o[q + 2] = water[2]; }
      o[q + 3] = 255;
    }
    texCtx.putImageData(out, 0, 0);
    tex.needsUpdate = true;
    dirtyFlag();
  }
  var dirtyFlag = function () {};
  paintClimate();
  // ---------------- base map: one flat plane. color = climate/Landsat x baked relief (normalized so
  // level ground = 1, i.e. keeps its exact legend color). Shadows multiply; lit slopes screen toward white.
  var maskTex = new THREE.DataTexture(new Uint8Array(ld.buffer.slice(0)), lw, lh, THREE.RGBAFormat);
  maskTex.magFilter = THREE.NearestFilter; maskTex.minFilter = THREE.NearestFilter; maskTex.needsUpdate = true;
  var reliefTex = null;
  if (relief) {
    var img = relief.img, maxT = renderer.capabilities.maxTextureSize;
    if (img.width > maxT || img.height > maxT) {        // e.g. 4096 on some phones: downscale once
      var k = maxT / Math.max(img.width, img.height), cv = document.createElement('canvas');
      cv.width = Math.floor(img.width * k); cv.height = Math.floor(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); img = cv;
    }
    reliefTex = new THREE.Texture(img); reliefTex.needsUpdate = true;
    reliefTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    var srcEl = document.getElementById('relief-src');
    if (srcEl) srcEl.textContent = relief.meta.source;
  }
  var baseMat = new THREE.ShaderMaterial({
    uniforms: {
      climate: { value: tex }, relief: { value: reliefTex }, mask: { value: maskTex },
      hasRelief: { value: reliefTex ? 1 : 0 },
      flatLevel: { value: new THREE.Vector3().fromArray(relief ? [].concat(relief.meta.flat, relief.meta.flat, relief.meta.flat).slice(0, 3) : [1, 1, 1]) },
      kCA: { value: RELIEF.california }, kOut: { value: RELIEF.context }, contrast: { value: RELIEF.contrast }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform sampler2D climate, relief, mask; uniform vec3 flatLevel; uniform float hasRelief, kCA, kOut, contrast; varying vec2 vUv;',
      'void main(){',
      '  vec3 c = texture2D(climate, vUv).rgb;',
      '  float m = texture2D(mask, vec2(vUv.x, 1.0 - vUv.y)).b;',          // 1 = California, 0.5 = other land, 0 = ocean
      // per-channel: warm sun / cool sky render -> golden lit slopes, blue-gray shadows; level ground = 1
      '  vec3 f = hasRelief > 0.5 ? pow(texture2D(relief, vUv).rgb / flatLevel, vec3(contrast)) : vec3(1.0);',
      '  f = mix(vec3(1.0), f, m > 0.75 ? kCA : kOut);',
      '  vec3 lit = mix(c * f, c + (1.0 - c) * min(f - 1.0, vec3(1.0)), step(1.0, f));',
      '  gl_FragColor = vec4(lit, 1.0);',
      '}'].join('\n')
  });
  var basePlane = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), baseMat);
  scene.add(basePlane);

  // the map "sheet" casts a soft shadow to the south-east (same sun as the relief), like a printed
  // map lifted off the table in a Blender render
  (function () {
    var cv = document.createElement('canvas'), pad = 40, cw = 300, ch = Math.round(cw * H / W);
    cv.width = cw + pad * 2; cv.height = ch + pad * 2;
    var g = cv.getContext('2d'); g.filter = 'blur(14px)'; g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(pad, pad, cw, ch);
    var st = new THREE.CanvasTexture(cv), k = W / cw;
    var sh = new THREE.Mesh(new THREE.PlaneGeometry(cv.width * k, cv.height * k).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: st, transparent: true, opacity: 0.55, depthWrite: false }));
    sh.position.set(12, -2, 16); sh.renderOrder = -1;
    scene.add(sh);
  })();

  // California outline, draped just above the surface
  (function () {
    var polys = meta.ca_outline.type === 'Polygon' ? [meta.ca_outline.coordinates] : meta.ca_outline.coordinates;
    var mat = new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar('--ink')), transparent: true, opacity: 0.55 });
    polys.forEach(function (poly) {
      var pts = [], ring = poly[0];
      for (var i = 0; i < ring.length; i++) {
        var a = ring[i], b = ring[(i + 1) % ring.length], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / tres));
        for (var s = 0; s < steps; s++) {
          var x = a[0] + (b[0] - a[0]) * s / steps, y = a[1] + (b[1] - a[1]) * s / steps;
          pts.push(new THREE.Vector3(x, Math.max(0, elevAt(x, y)) + 0.03, y));
        }
      }
      terrainGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat));
    });
  })();

  // ---------------- fire overlays: a flat textured quad per fire (fill) + fat-line outlines
  var fires = {}, lineMats = [];
  firesGeo.features.forEach(function (f) {
    var key = f.properties.key, bb = f.properties.bbox, pad = 3;
    var x0 = bb[0] - pad, y0 = bb[1] - pad, sx = bb[2] - bb[0] + 2 * pad, sy = bb[3] - bb[1] + 2 * pad;
    var ppk = Math.min(10, 1400 / Math.max(sx, sy));      // texture pixels per km
    function draw(on) {
      var c = document.createElement('canvas'); c.width = Math.round(sx * ppk); c.height = Math.round(sy * ppk);
      var g = c.getContext('2d'); g.lineJoin = 'round';
      var polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      g.beginPath();
      polys.forEach(function (poly) { poly.forEach(function (ring) {
        ring.forEach(function (pt, i) { var X = (pt[0] - x0) * ppk, Y = (pt[1] - y0) * ppk; i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
        g.closePath();
      }); });
      g.fillStyle = on ? 'rgba(20,24,29,0.55)' : 'rgba(20,24,29,0.32)'; g.fill('evenodd');
      var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return t;
    }
    var texOff = draw(false), texOn = draw(true);
    var mat = new THREE.MeshBasicMaterial({ map: texOff, transparent: true, depthWrite: false, depthTest: false });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy).rotateX(-Math.PI / 2), mat);
    mesh.position.set(x0 + sx / 2, 0.5, y0 + sy / 2); mesh.renderOrder = 2;
    world.add(mesh);

    // perimeter: screen-constant fat lines (white halo under ink), draped on the terrain, drawn on top
    var halo = new THREE.LineMaterial({ color: 0xffffff, linewidth: 4.5, depthTest: false, transparent: true, opacity: 0.95 });
    var ink = new THREE.LineMaterial({ color: 0x1F2A37, linewidth: 2, depthTest: false, transparent: true });
    lineMats.push(halo, ink);
    var rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : [].concat.apply([], f.geometry.coordinates);
    rings.forEach(function (ring) {
      var pts = [];
      for (var i = 0; i < ring.length; i++) {
        var a = ring[i], b = ring[(i + 1) % ring.length], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (tres / 2)));
        for (var s2 = 0; s2 < steps; s2++) {
          var x = a[0] + (b[0] - a[0]) * s2 / steps, y = a[1] + (b[1] - a[1]) * s2 / steps;
          pts.push(x, elevAt(x, y) + 0.02, y);
        }
      }
      pts.push(pts[0], pts[1], pts[2]);
      [halo, ink].forEach(function (m, n) {
        var lg = new THREE.LineGeometry(); lg.setPositions(pts);
        var line = new THREE.Line2(lg, m); line.renderOrder = 10 + n; line.computeLineDistances();
        terrainGroup.add(line);
      });
    });

    // label, anchored to the north (or south) edge of the perimeter
    var s = fireStats[key], below = !!LABEL_BELOW[key];
    var lbl = document.createElement('div');
    lbl.className = 'flabel' + (below ? ' below' : '');
    lbl.textContent = s ? s.name : key;
    lbl.addEventListener('pointerenter', function () { setHover(key, null); });
    lbl.addEventListener('pointerleave', function () { setHover(null); });
    lbl.addEventListener('click', function () { openView2(key); });
    labelsEl.appendChild(lbl);
    fires[key] = { mat: mat, texOn: texOn, texOff: texOff, ink: ink, halo: halo, label: lbl, geom: f.geometry, bbox: bb,
                   ax: (bb[0] + bb[2]) / 2, ay: below ? bb[3] : bb[1] };
  });


  // ---------------- map view: center (grid km) + scale (km per screen pixel)
  var view = { x: W / 2, y: H / 2, s: 1 }, sHome = 1, homeView = null, dirty = true, anim = null;
  var caBox = (function () {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    var polys = meta.ca_outline.type === 'Polygon' ? [meta.ca_outline.coordinates] : meta.ca_outline.coordinates;
    polys.forEach(function (p) { p[0].forEach(function (c) {
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]);
    }); });
    return b;
  })();
  function invalidate() { dirty = true; }
  dirtyFlag = invalidate;
  function stageSize() { return [stage.clientWidth, stage.clientHeight]; }
  // pixels at the stage's right edge hidden by the open floating panel (desktop only)
  function panelCover() {
    if (aside.classList.contains('collapsed') || window.innerWidth <= 800) return 0;
    return Math.max(0, stage.getBoundingClientRect().right - aside.getBoundingClientRect().left + 12);
  }
  // Home fits California into the part of the map the panel doesn't cover
  function computeHome() {
    var sz = stageSize(), pad = 48, cover = panelCover();
    sHome = Math.max((caBox[2] - caBox[0]) / Math.max(50, sz[0] - cover - pad * 2), (caBox[3] - caBox[1]) / Math.max(50, sz[1] - pad * 2));
    homeView = { x: (caBox[0] + caBox[2]) / 2 + cover / 2 * sHome, y: (caBox[1] + caBox[3]) / 2, s: sHome };
  }
  function atHome() {
    return !homeView || Math.abs(view.s - homeView.s) < 1e-6 && Math.abs(view.x - homeView.x) < 1e-6 && Math.abs(view.y - homeView.y) < 1e-6;
  }
  function clampView(v) {
    v.s = Math.min(sHome * 1.6, Math.max(sHome / 48, v.s));
    v.x = Math.min(W, Math.max(0, v.x)); v.y = Math.min(H, Math.max(0, v.y));
    return v;
  }
  function applyView() {
    var sz = stageSize(), hw = sz[0] / 2 * view.s, hh = sz[1] / 2 * view.s;
    camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh;
    camera.position.set(view.x - W / 2, 2000, view.y - H / 2);
    camera.lookAt(view.x - W / 2, 0, view.y - H / 2);
    camera.updateProjectionMatrix();
    drawScale(); invalidate();
  }
  function setView(v, animate) {
    v = clampView({ x: v.x, y: v.y, s: v.s });
    if (!animate) { anim = null; view = v; applyView(); return; }
    anim = { from: { x: view.x, y: view.y, s: view.s }, to: v, t0: performance.now(), dur: 280 };
  }
  // screen px (relative to stage) <-> grid km
  function toGrid(px, py) { var sz = stageSize(); return [view.x + (px - sz[0] / 2) * view.s, view.y + (py - sz[1] / 2) * view.s]; }
  function toScreen(gx, gy) { var sz = stageSize(); return [(gx - view.x) / view.s + sz[0] / 2, (gy - view.y) / view.s + sz[1] / 2]; }
  function zoomAt(px, py, factor, animate) {
    var g = toGrid(px, py), sz = stageSize(), s2 = Math.min(sHome * 1.6, Math.max(sHome / 48, view.s * factor));
    setView({ x: g[0] - (px - sz[0] / 2) * s2, y: g[1] - (py - sz[1] / 2) * s2, s: s2 }, animate);
  }
  function goHome(animate) { setView(homeView, animate); }

  function resize() {
    var sz = stageSize();
    renderer.setSize(sz[0], sz[1], false);
    lineMats.forEach(function (m) { m.resolution.set(sz[0], sz[1]); });
    var wasHome = atHome();
    computeHome();
    if (wasHome) view = { x: homeView.x, y: homeView.y, s: homeView.s };
    clampView(view); applyView();
  }
  // panel shown/hidden: if the map is at its Home view, glide to the new Home framing
  window.addEventListener('v1-panel', function () { var wasHome = atHome(); computeHome(); if (wasHome) setView(homeView, true); });

  // ---------------- scale bar + cursor readout (as on the National Map viewer)
  var scaleEl = document.getElementById('scalebar'), readEl = document.getElementById('readout');
  function niceLen(x) { var p = Math.pow(10, Math.floor(Math.log10(x))), r = x / p; return (r >= 5 ? 5 : r >= 2 ? 2 : 1) * p; }
  function drawScale() {
    var km = niceLen(view.s * 110);
    scaleEl.innerHTML = '<div class="sb" style="width:' + (km / view.s).toFixed(0) + 'px">' + km.toLocaleString() + ' km</div>';
  }
  var lsc = meta.layers.res_m / 1000;
  function climateAt(gx, gy) {
    var i = Math.floor(gx / lsc), j = Math.floor(gy / lsc);
    if (i < 0 || j < 0 || i >= meta.layers.w || j >= meta.layers.h) return null;
    var p = (j * meta.layers.w + i) * 4, mask = layersImg.data[p + 2];
    if (mask !== 255) return { mask: mask };
    var P = meta.precip, T = meta.temp, bp = layersImg.data[p], bt = layersImg.data[p + 1];
    return { mask: 255,
      ppt: Math.exp(Math.log(P.min) + (bp - 1) / 254 * (Math.log(P.max) - Math.log(P.min))),
      tmp: T.min + (bt - 1) / 254 * (T.max - T.min) };
  }
  function updateReadout(gx, gy) {
    if (gx == null) { readEl.textContent = 'Move the pointer over the map'; return; }
    var ll = albersInverse(meta.origin_m[0] + gx * 1000, meta.origin_m[1] - gy * 1000);
    var txt = Math.abs(ll[1]).toFixed(3) + '° ' + (ll[1] >= 0 ? 'N' : 'S') + ', ' + Math.abs(ll[0]).toFixed(3) + '° ' + (ll[0] >= 0 ? 'E' : 'W');
    var c = climateAt(gx, gy);
    if (c && c.mask === 0) txt += ' · Ocean';
    else {
      txt += ' · Elev ' + fmt(Math.max(0, elevAt(gx, gy) * 1000)) + ' m';
      if (c && c.mask === 255) txt += state.variable === 'precip' ? ' · Precip ' + fmt(c.ppt) + ' mm/yr' : ' · Temp ' + fmt(c.tmp, 1) + ' °C';
    }
    readEl.textContent = txt;
  }
  updateReadout(null);
  new ResizeObserver(resize).observe(stage); resize();

  // ---------------- hover, click, pan, zoom
  function fireAt(gx, gy) {
    var keys = Object.keys(fires);
    for (var i = 0; i < keys.length; i++) {
      var F = fires[keys[i]], b = F.bbox;
      if (gx >= b[0] && gx <= b[2] && gy >= b[1] && gy <= b[3] && inGeom(F.geom, gx, gy)) return keys[i];
    }
    return null;
  }
  function local(ev) { var r = stage.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
  var el = renderer.domElement, pointers = {}, drag = null, pinch = null, downAt = null;

  el.addEventListener('pointerdown', function (ev) {
    el.setPointerCapture(ev.pointerId);
    pointers[ev.pointerId] = local(ev);
    var ids = Object.keys(pointers);
    if (ids.length === 1) { drag = { p: local(ev), x: view.x, y: view.y }; downAt = local(ev); stage.classList.add('dragging'); }
    else if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s }; drag = null; downAt = null;
    }
    anim = null; setHover(null);
  });
  el.addEventListener('pointermove', function (ev) {
    var p = local(ev);
    if (pointers[ev.pointerId]) pointers[ev.pointerId] = p;
    var ids = Object.keys(pointers);
    if (pinch && ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (pinch.s * pinch.d / d) / view.s, false);
      return;
    }
    if (drag) {
      setView({ x: drag.x - (p[0] - drag.p[0]) * view.s, y: drag.y - (p[1] - drag.p[1]) * view.s, s: view.s }, false);
    }
    var g = toGrid(p[0], p[1]);
    updateReadout(g[0], g[1]);
    if (!drag) { var k = fireAt(g[0], g[1]); setHover(k, k ? ev : null); }
  });
  function endPointer(ev) {
    var p = local(ev);
    if (downAt && Math.hypot(p[0] - downAt[0], p[1] - downAt[1]) < 5) {
      var g = toGrid(p[0], p[1]), k = fireAt(g[0], g[1]);
      if (k) openView2(k);
    }
    delete pointers[ev.pointerId];
    if (Object.keys(pointers).length < 2) pinch = null;
    if (!Object.keys(pointers).length) { drag = null; downAt = null; stage.classList.remove('dragging'); }
  }
  el.addEventListener('pointerup', endPointer);
  el.addEventListener('pointercancel', endPointer);
  el.addEventListener('pointerleave', function () { if (!drag) { setHover(null); updateReadout(null); } });
  el.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var dy = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1), p = local(ev);
    zoomAt(p[0], p[1], Math.exp(dy * 0.0025), false);
  }, { passive: false });
  el.addEventListener('dblclick', function (ev) { var p = local(ev); zoomAt(p[0], p[1], 0.5, true); });

  document.getElementById('zoom-in').addEventListener('click', function () { var sz = stageSize(); zoomAt(sz[0] / 2, sz[1] / 2, 0.5, true); });
  document.getElementById('zoom-out').addEventListener('click', function () { var sz = stageSize(); zoomAt(sz[0] / 2, sz[1] / 2, 2, true); });
  document.getElementById('home').addEventListener('click', function () { goHome(true); });
  stage.addEventListener('keydown', function (ev) {
    var sz = stageSize(), step = 80 * view.s, k = ev.key;
    if (k === 'ArrowLeft') setView({ x: view.x - step, y: view.y, s: view.s }, true);
    else if (k === 'ArrowRight') setView({ x: view.x + step, y: view.y, s: view.s }, true);
    else if (k === 'ArrowUp') setView({ x: view.x, y: view.y - step, s: view.s }, true);
    else if (k === 'ArrowDown') setView({ x: view.x, y: view.y + step, s: view.s }, true);
    else if (k === '+' || k === '=') zoomAt(sz[0] / 2, sz[1] / 2, 0.5, true);
    else if (k === '-' || k === '_') zoomAt(sz[0] / 2, sz[1] / 2, 2, true);
    else if (k === 'Home' || k === '0') goHome(true);
    else return;
    ev.preventDefault();
  });

  function openView2(key) { window.location.href = VIEW2_URL + '?fire=' + encodeURIComponent(key); }

  var cardAnchor = null;    // null = follow pointer; otherwise a fire key (hover came from label/list)
  function setHover(key, ev) {
    if (state.hover !== key) {
      if (state.hover && fires[state.hover]) {
        var P = fires[state.hover]; P.mat.map = P.texOff; P.ink.linewidth = 2; P.halo.linewidth = 4.5; P.label.classList.remove('on');
      }
      state.hover = key;
      if (key) { var F = fires[key]; F.mat.map = F.texOn; F.ink.linewidth = 3.5; F.halo.linewidth = 7; F.label.classList.add('on'); }
      listButtons.forEach(function (b) { b.classList.toggle('on', b.dataset.key === key); });
      stage.classList.toggle('over-fire', !!key);
      if (key) { card.innerHTML = cardHTML(fireStats[key]); card.hidden = false; } else card.hidden = true;
      invalidate();
    }
    cardAnchor = key && !ev ? key : null;
    if (key && ev) placeCard(ev.clientX, ev.clientY);
    if (cardAnchor) { var lr = fires[cardAnchor].label.getBoundingClientRect(); placeCard(lr.right, lr.bottom); }
  }
  function placeCard(cx, cy) {
    var r = stage.getBoundingClientRect(), x = cx - r.left + 16, y = cy - r.top + 16;
    var w = card.offsetWidth, h = card.offsetHeight;
    if (x + w > r.width - 8) x = cx - r.left - w - 16;
    if (y + h > r.height - 8) y = Math.max(8, r.height - h - 8);
    card.style.left = Math.max(8, x) + 'px'; card.style.top = y + 'px';
  }

  function cardHTML(s) {
    var yr = state.year, d = yr === 'all' ? s.all : s.by_year[yr];
    var yrs = s.years, ig = +s.ignition.slice(0, 4);
    var h = '<h3>' + s.name + ' Fire</h3><div class="meta">Ignited ' + dateStr(s.ignition) + ' · ' + fmt(s.acres) + ' acres</div>';
    h += '<div class="sec">Recovery · ' + (yr === 'all' ? 'all years (' + yrs[0] + '–' + yrs[yrs.length - 1] + ')' : yr + ' · ' + (yr - ig) + ' yr after fire') + '</div>';
    if (!d || !d.burned_obs) {
      h += '<p class="none">No GEDI observations of burned cells in ' + yr + '.</p>';
    } else {
      h += '<dl><dt>Structural recovery (median RH95 post/pre)</dt><dd>' + fmt(d.median_struct, 2) + '</dd>' +
           '<dt>Greenness recovery (median NDVI post/pre)</dt><dd>' + fmt(d.median_ndvi, 2) + '</dd>' +
           '<dt>Noise floor (R)</dt><dd>' + fmt(s.noise_floor, 2) + '</dd>' +
           '<dt>Burned cells with real structural loss</dt><dd>' + pct(d.loss_frac) + '</dd></dl>';
    }
    h += '<div class="sec">Historical climate (PRISM 1991–2020)</div><dl>' +
         '<dt>Mean annual temperature</dt><dd>' + fmt(s.hist_tmean_c, 1) + ' °C</dd>' +
         '<dt>Mean annual precipitation</dt><dd>' + fmt(s.hist_ppt_mm) + ' mm</dd>' +
         '<dt>GEDI cells (burned · reference)</dt><dd>' + (yr === 'all'
            ? fmt(s.all.unique_burned_cells) + ' · ' + fmt(s.all.unique_reference_cells)
            : fmt(d ? d.burned_obs : 0) + ' · ' + fmt(d ? d.reference_obs : 0)) + '</dd></dl>';
    if (d && d.burned_obs) {
      var sev = d.severity, tot = 0;
      SEVERITY.forEach(function (x) { tot += sev[x[0]] || 0; });
      if (tot) {
        h += '<div class="sec">Burn severity of burned cells (MTBS)</div><div class="sevbar">';
        SEVERITY.forEach(function (x) { var n = sev[x[0]] || 0; if (n) h += '<span style="flex:' + n + ';background:var(' + x[2] + ')"></span>'; });
        h += '</div><div class="sevkey">';
        SEVERITY.forEach(function (x) { var n = sev[x[0]] || 0; if (n) h += '<span><i style="background:var(' + x[2] + ')"></i>' + x[1] + ' ' + pct(n / tot) + '</span>'; });
        h += '</div>';
      }
    }
    h += '<div class="go">Click to open in View 2 →</div>';
    return h;
  }

  // ---------------- side panel
  var list = document.getElementById('fire-list'), listButtons = [];
  meta.fires.forEach(function (s) {
    var li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button'; b.dataset.key = s.key;
    b.innerHTML = '<span class="nm">' + s.name + '</span><span class="yr">' + s.ignition.slice(0, 4) + '</span>';
    b.addEventListener('pointerenter', function () { setHover(s.key, null); });
    b.addEventListener('pointerleave', function () { setHover(null); });
    b.addEventListener('focus', function () { setHover(s.key, null); });
    b.addEventListener('blur', function () { setHover(null); });
    b.addEventListener('click', function () { openView2(s.key); });
    li.appendChild(b); list.appendChild(li); listButtons.push(b);
  });

  var yearSel = document.getElementById('year'), allYears = {};
  meta.fires.forEach(function (s) { s.years.forEach(function (y) { allYears[y] = 1; }); });
  Object.keys(allYears).sort().forEach(function (y) { var o = document.createElement('option'); o.value = y; o.textContent = y; yearSel.appendChild(o); });
  yearSel.addEventListener('change', function () { state.year = yearSel.value; if (state.hover) card.innerHTML = cardHTML(fireStats[state.hover]); });




  function drawLegend() {
    var L = meta[state.variable], stops = RAMPS[state.variable];
    document.getElementById('legend-title').textContent = L.label + ' (' + L.unit + ')';
    var isT = state.variable === 'temp', D = isT ? TEMP_DISPLAY : L;
    var pos = L.scale === 'log'
      ? function (v) { return (Math.log(v) - Math.log(L.min)) / (Math.log(L.max) - Math.log(L.min)); }
      : function (v) { return (v - D.min) / (D.max - D.min); };
    document.getElementById('ramp').style.background = 'linear-gradient(90deg,' + (isT
      ? stops.map(function (c, k) { return c + ' ' + (pos(TEMP_DISPLAY.at[k]) * 100).toFixed(1) + '%'; })
      : stops).join(',') + ')';
    document.getElementById('legend-ticks').innerHTML = D.ticks.map(function (t, k) {
      var lbl = isT && k === 0 ? '≤' + t : t >= 1000 ? t / 1000 + 'k' : String(t);   // 1k 2k 4k keep the log-spaced ticks apart
      return '<span style="left:' + (pos(t) * 100).toFixed(1) + '%">' + lbl + '</span>';
    }).join('');
    document.getElementById('legend-note').textContent = L.scale === 'log'
      ? 'Log scale. Outside California: Landsat true color.'
      : 'Colors are spaced more tightly from 10–20 °C, where most of the state falls. Outside California: Landsat true color.';
  }
  drawLegend();
  document.querySelectorAll('.seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.variable = b.dataset.var;
      document.querySelectorAll('.seg button').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
      paintClimate(); drawLegend(); updateReadout(null);
    });
  });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintClimate);

  // ---------------- state names (under the fire labels, not interactive)
  var stateEls = STATE_LABELS.map(function (L) {
    var d = document.createElement('div');
    d.className = 'slabel'; d.textContent = L.text; d.setAttribute('aria-hidden', 'true');
    labelsEl.insertBefore(d, labelsEl.firstChild);
    return d;
  });
  function layoutStates() {
    var z = sHome / view.s, show = z < 6;                       // hide once zoomed in past ~6x
    var px = Math.max(14, Math.min(30, 20 * Math.pow(z, 0.35)));  // grow gently with zoom
    STATE_LABELS.forEach(function (L, i) {
      var el = stateEls[i], p = toScreen(L.x, L.y);
      el.hidden = !show;
      if (!show) return;
      el.style.fontSize = px.toFixed(1) + 'px';
      el.style.left = p[0].toFixed(1) + 'px'; el.style.top = p[1].toFixed(1) + 'px';
      el.style.transform = 'translate(-50%,-50%) rotate(' + L.angle + 'deg)';      // rotates about its own center
    });
  }

  // ---------------- render loop: only draws when the view, hover or layer changed
  function frame(now) {
    requestAnimationFrame(frame);
    if (anim) {
      var t = Math.min(1, (now - anim.t0) / anim.dur), e = 1 - Math.pow(1 - t, 3), A = anim;
      // interpolate scale geometrically so zooms feel even
      view = { x: A.from.x + (A.to.x - A.from.x) * e, y: A.from.y + (A.to.y - A.from.y) * e,
               s: A.from.s * Math.pow(A.to.s / A.from.s, e) };
      if (t >= 1) anim = null;
      applyView();
    }
    if (!dirty) return;
    dirty = false;
    renderer.render(scene, camera);
    var sz = stageSize();
    Object.keys(fires).forEach(function (k) {
      var F = fires[k], p = toScreen(F.ax, F.ay);
      var off = p[0] < -40 || p[0] > sz[0] + 40 || p[1] < -20 || p[1] > sz[1] + 20;
      F.label.hidden = off;
      if (!off) { F.label.style.left = p[0] + 'px'; F.label.style.top = p[1] + 'px'; }
    });
    layoutStates();
  }
  requestAnimationFrame(frame);
}
})();
