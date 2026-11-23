# View 1: California overview

A north-up map of California's shaded terrain draped with PRISM 1991–2020 climate normals (precipitation or temperature toggle). The land outside California shows Landsat WELD 2000 true color, and the six study-fire perimeters are drawn on top. Hovering a fire (on the map, its label, or the side list) shows its recovery summary. Clicking a fire opens View 2.

The map fills the whole window under a slim title bar. The controls sit in a floating, collapsible panel at the top right (at the bottom on phones, where it starts collapsed), and Home centers California in the area the panel leaves open. Navigation follows the USGS National Map viewer: drag to pan, scroll/pinch/double-click to zoom toward the cursor, +/− and Home buttons, a km scale bar, and a cursor readout of lat/lon, elevation and the climate value. There is no tilt or rotation. The shaded relief is a baked Blender render (see below).

Built with Three.js r128 (orthographic top-down camera), using the same version and styling tokens as View 2.

## Live site and color themes

Hosted on GitHub Pages. Add `?theme=bone` to the address to preview the proposed bone color scheme (`theme-bone.css`); without it the page uses the default colors in `style.css`.

## Run locally

The page loads data with `fetch`, so it has to be served over http rather than opened as a file. Any static server works, e.g. from this folder:

```
python3 -m http.server 8137
```

Then open http://localhost:8137 (or http://localhost:8137/?theme=bone).

The data-prep, Blender and dev-server scripts mentioned below (`view1_prep/`) live in the project folder next to this site; they are not part of this repository.

## Files

- `index.html`, `style.css`, `app.js`: the page.
- `data/terrain.png`: heightmap at 1.25 km per pixel. Elevation in meters + 500 is stored as 16 bits in the R and G channels.
- `data/layers.png`: R = precipitation (log-scaled byte), G = temperature (byte), B = mask (255 = California, 128 = other land, 0 = ocean).
- `data/fires.geojson`: perimeters in grid km.
- `data/meta.json`: grid info, legend scales, and per-fire stats.

## Regenerate the data

`view1_prep/prep_view1.py` rebuilds everything in `data/` from:
- `final_project/website_data` (perimeters, fires.json, all_fires_cells.csv)
- `final_project/prism_normals`
- `final_project/bsp_perims_DD_clean.parquet` (MTBS acres)
- the downloaded terrain tiles and state outline in `view1_prep/raw/`

It needs GDAL's Python bindings and numpy:

```
python3 -I view1_prep/prep_view1.py
```

## Relief shading (Blender bake)

The map is flat and the sun never moves, so the shaded relief is rendered once offline in Blender Cycles and loaded as an image, `data/relief.jpg`. The page multiplies the climate and Landsat colors by `relief ÷ flat`, where `flat` (stored in `data/relief.json`) is the render's value on level ground. Level ground therefore keeps its exact legend color. Shading is fixed at full strength (`RELIEF` in app.js).

Run these from `view1_prep/`:

```
python3 -I relief.py prepare      # 250 m DEM on the map grid -> blender/dem_250m.*, plus a GDAL hillshade placeholder
/Applications/Blender.app/Contents/MacOS/Blender -b -P bake_relief.py --      # ~45 s on an M4 Max
python3 -I relief.py finalize     # blender/relief_render.png -> ../view1/data/relief.jpg + relief.json
```

`bake_relief.py` defaults give a look modeled on a Blender topo-map render:
- `--exag 12`
- `--elevation 18` (low sun, long shadows)
- `--azimuth 315`
- `--sun 2.0 --sun-angle 15` (a large sun disc gives soft, diffuse shadow edges)
- warm sun `--sun-color 1,0.93,0.8` and cool sky `--sky-color 0.62,0.76,1 --sky 0.5`, which give golden lit slopes and blue-gray shadows
- `--samples 64`
- `--scale 0.25` for quick tests
- `--save-blend` to open the scene in the Blender UI and tweak it by hand

The page divides each color channel by the level-ground value, so flat ground keeps its legend color whatever the light colors are. The map sheet also casts a soft drop shadow to the south-east.

Keep the camera and mesh untouched so the render stays aligned. Save a hand render as a 16-bit grayscale PNG and finalize that file.

## Stat definitions (hover card)

- **Structural recovery**: median `structural_ratio` (GEDI RH95 post/pre) over burned cells.
- **Greenness recovery**: median `ndvi_ratio` over burned cells where `ndvi_usable`.
- **Noise floor (R)**: `1 − rh95_floor`, the same definition as `merge_gedi_ndvi.py` and View 2.
- **Real structural loss**: the share of burned cells with `structure_beyond_floor`.
- **Historical climate**: the mean of PRISM values over unique burned cells.
- **Burn severity**: the MTBS severity mix of burned cells.

"All years" pools every observation year. Choosing a single year uses only that year's GEDI samples.

## Link to View 2

A click goes to `https://madisonsansone.github.io/csci2370-view2/?fire=<key>`, where `<key>` is one of `dixie`, `north`, `august`, `caldor`, `creek`, `castle`. View 2 needs to read that parameter. For example, near the top of View 2's `app.js`, after `cur` and `FIRES` are defined:

```js
var q = new URLSearchParams(location.search).get('fire');
if (q && FIRES[q]) cur.fire = q;
```

View 2 also needs data entries for the four fires it doesn't have yet (August, Caldor, Creek, Castle).
