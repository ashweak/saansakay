// SaanSakay basemap: free OpenFreeMap vector tiles (OpenMapTiles schema, no API key),
// styled warm & clean — cream land, soft green parks, teal water, orange expressways,
// yellow main roads and white streets — so transit routes stand out on top.
const C = {
  land: '#f5f0e4', residential: '#efe9da', commercial: '#f3e6d4', industrial: '#ebe5d9',
  hospital: '#f6e0de', school: '#f2ecd2', park: '#cfe5b4', wood: '#bcd9a0', sand: '#efe6c8',
  water: '#a6d4da', waterLine: '#8fc6cd', building: '#e7e0d2', buildingLine: '#d8cfbd',
  motorway: '#f0a04b', motorwayCase: '#d4822d', trunk: '#f7c46a', trunkCase: '#dfa84b',
  primary: '#fde39c', primaryCase: '#e5c46c', street: '#ffffff', streetCase: '#ddd4c2',
  rail: '#b5ada0', text: '#4b453c', textSoft: '#7a7266', halo: 'rgba(255,255,255,0.92)',
  parkText: '#3f8a4c', waterText: '#4b8b94',
}
const FONT = ['Noto Sans Regular']
const FONT_B = ['Noto Sans Bold']
const FONT_I = ['Noto Sans Italic']

const cls = (...v) => ['match', ['get', 'class'], v, true, false]
const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel']
const w = (stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops.flat()]

const roadDefs = [
  // [id, classes, fill, casing, minzoom, width stops]
  ['street', ['minor', 'service'], C.street, C.streetCase, 13, [[13, 1], [15, 4], [18, 18]]],
  ['secondary', ['secondary', 'tertiary'], C.street, C.streetCase, 10, [[10, 1], [13, 3], [15, 7], [18, 26]]],
  ['primary', ['primary'], C.primary, C.primaryCase, 8, [[8, 1], [12, 3], [15, 9], [18, 30]]],
  ['trunk', ['trunk'], C.trunk, C.trunkCase, 6, [[6, 1], [12, 3.5], [15, 10], [18, 32]]],
  ['motorway', ['motorway'], C.motorway, C.motorwayCase, 5, [[5, 1], [12, 4], [15, 11], [18, 34]]],
]

function roadLayers() {
  const out = []
  for (const [id, classes, , casing, minzoom, stops] of roadDefs) {
    out.push({
      id: `road-${id}-casing`, type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom,
      filter: ['all', cls(...classes), notTunnel],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': casing, 'line-width': w(stops.map(([z, v]) => [z, v + (z >= 14 ? 2 : 1)])) },
    })
  }
  for (const [id, classes, fill, , minzoom, stops] of roadDefs) {
    out.push({
      id: `road-${id}`, type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom,
      filter: ['all', cls(...classes), notTunnel],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': fill, 'line-width': w(stops) },
    })
  }
  return out
}

export const baseStyle = {
  version: 8,
  name: 'SaanSakay',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': C.land } },
    { id: 'landuse-residential', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('residential', 'suburb', 'neighbourhood'), paint: { 'fill-color': C.residential } },
    { id: 'landuse-commercial', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('commercial', 'retail'), paint: { 'fill-color': C.commercial } },
    { id: 'landuse-industrial', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('industrial', 'railway', 'garages'), paint: { 'fill-color': C.industrial } },
    { id: 'landuse-hospital', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('hospital'), paint: { 'fill-color': C.hospital } },
    { id: 'landuse-school', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('school', 'university', 'college', 'kindergarten'), paint: { 'fill-color': C.school } },
    { id: 'landcover-sand', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls('sand', 'beach'), paint: { 'fill-color': C.sand } },
    { id: 'landcover-grass', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls('grass', 'farmland', 'wetland'), paint: { 'fill-color': C.park, 'fill-opacity': 0.7 } },
    { id: 'landcover-wood', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls('wood', 'forest'), paint: { 'fill-color': C.wood, 'fill-opacity': 0.8 } },
    { id: 'landuse-green', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('cemetery', 'stadium', 'pitch', 'playground', 'golf_course'), paint: { 'fill-color': C.park, 'fill-opacity': 0.8 } },
    { id: 'park', type: 'fill', source: 'ofm', 'source-layer': 'park', paint: { 'fill-color': C.park } },
    { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'fill-color': C.water } },
    { id: 'waterway', type: 'line', source: 'ofm', 'source-layer': 'waterway', minzoom: 11, paint: { 'line-color': C.waterLine, 'line-width': w([[11, 0.6], [15, 2], [18, 6]]) } },
    { id: 'building', type: 'fill', source: 'ofm', 'source-layer': 'building', minzoom: 15, paint: { 'fill-color': C.building, 'fill-outline-color': C.buildingLine, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 1] } },
    { id: 'rail', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 11, filter: cls('rail', 'transit'), paint: { 'line-color': C.rail, 'line-width': w([[11, 1], [16, 2.5]]), 'line-dasharray': [3, 2] } },
    ...roadLayers(),
    {
      id: 'water-name', type: 'symbol', source: 'ofm', 'source-layer': 'water_name', minzoom: 10,
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_I, 'text-size': 12, 'text-max-width': 8 },
      paint: { 'text-color': C.waterText, 'text-halo-color': C.halo, 'text-halo-width': 1 },
    },
    {
      id: 'road-name', type: 'symbol', source: 'ofm', 'source-layer': 'transportation_name', minzoom: 13,
      filter: cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'),
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 13], 'text-letter-spacing': 0.02 },
      paint: { 'text-color': C.text, 'text-halo-color': C.halo, 'text-halo-width': 1.4 },
    },
    {
      id: 'poi', type: 'symbol', source: 'ofm', 'source-layer': 'poi', minzoom: 15,
      filter: ['<=', ['coalesce', ['get', 'rank'], 99], 12],
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11, 'text-max-width': 8, 'text-optional': true },
      paint: { 'text-color': ['match', ['get', 'class'], ['park', 'garden'], C.parkText, C.textSoft], 'text-halo-color': C.halo, 'text-halo-width': 1.2 },
    },
    {
      id: 'place-neighbourhood', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 12,
      filter: cls('suburb', 'neighbourhood', 'quarter', 'village', 'hamlet'),
      layout: { 'text-field': ['upcase', ['get', 'name']], 'text-font': FONT_B, 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 13], 'text-letter-spacing': 0.12, 'text-max-width': 9 },
      paint: { 'text-color': C.textSoft, 'text-halo-color': C.halo, 'text-halo-width': 1.2 },
    },
    {
      id: 'place-city', type: 'symbol', source: 'ofm', 'source-layer': 'place', maxzoom: 15,
      filter: cls('city', 'town'),
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_B, 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 12, 13, 18] },
      paint: { 'text-color': C.text, 'text-halo-color': C.halo, 'text-halo-width': 1.6 },
    },
  ],
}

export const VECTOR_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
