/**
 * PIRO-COMPOSITOR 2D · Motor Unificado de Composición (Probador + Timeline)
 * Soporta marionetas modulares 1000x1600 con pivotes, prop anclado a mano,
 * múltiples actores simultáneos en plano, L-cuts y lip-sync por envolvente real.
 */

const MAX_IMG_CACHE = 140;
const MAX_ENV_CACHE = 40;
const _imgCache = new Map();
const _envCache = new Map();
const _corsBloqueadas = new Set();
let _audioCtx = null;

function lruGet(map, k) {
  if (!map.has(k)) return undefined;
  const v = map.get(k);
  map.delete(k);
  map.set(k, v);
  return v;
}

function lruSet(map, k, v, maxSize) {
  if (map.has(k)) map.delete(k);
  map.set(k, v);
  while (map.size > maxSize) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

export function limpiarCacheCompositor() {
  _imgCache.clear();
  _envCache.clear();
  _corsBloqueadas.clear();
}

export function limpiarBloqueosCorsPiro() {
  _corsBloqueadas.clear();
}

export function obtenerBloqueosCorsPiro() {
  return Array.from(_corsBloqueadas);
}

export function obtenerEstadisticasCachePiro() {
  let sinCors = 0;
  _imgCache.forEach(function(im) { if (im && im._corsOk === false) sinCors++; });
  return { imagenes: _imgCache.size, envolventes: _envCache.size, sinCorsCache: sinCors, bloqueadasExport: _corsBloqueadas.size };
}

export const PIVOTES_DEFAULT = {
  cuello: { x: 500, y: 480 },
  hombro_trasero: { x: 555, y: 560 },
    codo_trasero: { x: 605, y: 710 },
  mano_trasera: { x: 635, y: 880 },
  hombro_delantero: { x: 440, y: 560 },
  codo_delantero: { x: 420, y: 720 },
    mano_delantera: { x: 415, y: 940 },
  cadera_delantera: { x: 465, y: 920 },
  cadera_trasera: { x: 535, y: 920 }
};

const _imgInFlight = new Map();

export function cargarImagenPiro(url, opts) {
  const strictCors = Boolean(opts === true || (opts && opts.strictCors));
  if (!url) return Promise.resolve(null);
  const hit = lruGet(_imgCache, url);
  if (hit && (!strictCors || hit._corsOk === true)) return Promise.resolve(hit);
  const fKey = url + (strictCors ? '|strict' : '');
  if (_imgInFlight.has(fKey)) return _imgInFlight.get(fKey);
  const prom = new Promise(function(resolve) {
    const fin = function(res) { _imgInFlight.delete(fKey); resolve(res); };
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = function() {
      im._corsOk = true;
      _corsBloqueadas.delete(url);
      lruSet(_imgCache, url, im, MAX_IMG_CACHE);
      fin(im);
    };
    im.onerror = function() {
      if (strictCors) {
        _corsBloqueadas.add(url);
        fin(null);
        return;
      }
      const im2 = new Image();
      im2.onload = function() {
        im2._corsOk = false;
        lruSet(_imgCache, url, im2, MAX_IMG_CACHE);
        fin(im2);
      };
      im2.onerror = function() { fin(null); };
      im2.src = url;
    };
    im.src = url;
  });
  _imgInFlight.set(fKey, prom);
  return prom;
}

export async function precargarPiezasPersonajePiro(personaje, extraUrls, opts) {
  const urls = new Set();
  const pzs = (personaje && personaje.piezas) || {};
  Object.keys(pzs).forEach(function(k) {
    if (k.indexOf('maestro_') === 0) return;
    const u = pzs[k] && pzs[k].url;
    if (u && typeof u === 'string' && u.length > 5) urls.add(u);
  });
  if (Array.isArray(extraUrls)) {
    extraUrls.forEach(function(u) { if (u && typeof u === 'string' && u.length > 5) urls.add(u); });
  }
  const lista = Array.from(urls);
  let ok = 0, fail = 0; const faltantes = [];
  for (let i = 0; i < lista.length; i += 8) {
    const lote = lista.slice(i, i + 8);
    await Promise.all(lote.map(async function(u) {
      const im = await cargarImagenPiro(u, opts);
      if (im) {
        if (typeof im.decode === 'function') { try { await im.decode(); } catch (eD) {} }
        ok++;
      } else { fail++; faltantes.push(u); }
    }));
  }
  return { total: lista.length, ok: ok, fail: fail, faltantes: faltantes };
}

export function parsearPivotes(p) {
  let raw = null;
  if (p && p.pivotes && typeof p.pivotes === 'object') raw = p.pivotes;
  else if (p && p.pivotes_json) {
    try { raw = JSON.parse(p.pivotes_json); } catch (e) { raw = null; }
  }
  const res = {};
  Object.keys(PIVOTES_DEFAULT).forEach(function(k) {
    const def = PIVOTES_DEFAULT[k];
    const v = raw && raw[k] ? raw[k] : null;
    if (Array.isArray(v) && v.length >= 2) {
      res[k] = { x: Number(v[0]) || def.x, y: Number(v[1]) || def.y, marcado: true };
    } else if (v && typeof v.x === 'number' && typeof v.y === 'number') {
      res[k] = { x: v.x, y: v.y, marcado: true };
    } else {
      res[k] = { x: def.x, y: def.y, marcado: false };
    }
  });
      if (!res.mano_trasera.marcado) {
    const dxAnt = res.mano_delantera.x - res.codo_delantero.x;
    const dyAnt = Math.max(90, res.mano_delantera.y - res.codo_delantero.y);
    res.mano_trasera = { x: Math.round(res.codo_trasero.x + dxAnt * 0.35), y: Math.round(res.codo_trasero.y + dyAnt), marcado: false };
  }
  return res;
}

export const CUERPOS_ANGULO_STD_PIRO = ['cuerpo_base', 'cuerpo_frente', 'cuerpo_perfil', 'cuerpo_espalda_3_4', 'cuerpo_espalda'];

export function tieneUrlPiezaPiro(personaje, key) {
  const pzs = (personaje && personaje.piezas) || {};
  const o = pzs[key];
  return Boolean(o && typeof o.url === 'string' && o.url.trim().length > 4);
}

export function resolverCapacidadesRigPiro(personaje) {
  return {
    artDelCompleto: tieneUrlPiezaPiro(personaje, 'brazo_del_sup') && tieneUrlPiezaPiro(personaje, 'brazo_del_ant'),
    artTrasCompleto: tieneUrlPiezaPiro(personaje, 'brazo_tras_sup') && tieneUrlPiezaPiro(personaje, 'brazo_tras_ant'),
    brazoDelCompleto: tieneUrlPiezaPiro(personaje, 'brazo_delantero_reposo') || tieneUrlPiezaPiro(personaje, 'brazo_delantero_prop'),
    brazoTrasCompleto: tieneUrlPiezaPiro(personaje, 'brazo_trasero_reposo'),
    tieneManoTras: tieneUrlPiezaPiro(personaje, 'mano_trasera'),
    tieneManoRel: tieneUrlPiezaPiro(personaje, 'mano_relajada')
  };
}

export function resolverModoBrazosPiro(personaje, brazoDelSol, brazoTrasSol, tieneProp) {
  const caps = resolverCapacidadesRigPiro(personaje);
  const rawDel = String(brazoDelSol || '');
  const defDel = (tieneProp && tieneUrlPiezaPiro(personaje, 'brazo_delantero_prop')) ? 'brazo_delantero_prop' : 'brazo_delantero_reposo';
  let brazoDel = defDel;
  if (rawDel === 'ninguno' || rawDel.indexOf('trasero') >= 0) {
    brazoDel = 'ninguno';
  } else if (rawDel === 'articulado') {
    brazoDel = caps.artDelCompleto ? 'articulado' : defDel;
  } else if (!rawDel || rawDel === 'auto') {
    brazoDel = caps.artDelCompleto ? 'articulado' : defDel;
  } else {
    brazoDel = (tieneUrlPiezaPiro(personaje, rawDel) || !caps.artDelCompleto) ? rawDel : 'articulado';
  }
  const rawTras = String(brazoTrasSol || '');
  let brazoTras = 'brazo_trasero_reposo';
  if (rawTras === 'ninguno') {
    brazoTras = 'ninguno';
  } else if (rawTras === 'articulado') {
    brazoTras = caps.artTrasCompleto ? 'articulado' : 'brazo_trasero_reposo';
  } else if (!rawTras || rawTras === 'auto') {
    brazoTras = (brazoDel === 'articulado' && caps.artTrasCompleto) ? 'articulado' : 'brazo_trasero_reposo';
  } else {
    brazoTras = (tieneUrlPiezaPiro(personaje, rawTras) || !caps.artTrasCompleto) ? rawTras : 'articulado';
  }
  return { brazoDel: brazoDel, brazoTras: brazoTras, caps: caps };
}

export function resolverCuerpoPiro(personaje, cuerpoSol, ang360) {
  const req = String(cuerpoSol || '').trim();
  const esStd = !req || CUERPOS_ANGULO_STD_PIRO.indexOf(req) >= 0;
  if (!esStd) {
    if (ang360 && ang360.id) {
      const suf = ang360.id === 'frente' ? '_frente' : ((ang360.id === 'perfil_der' || ang360.id === 'perfil_izq') ? '_perfil' : (ang360.id === 'espalda' ? '_espalda' : ((ang360.id === 'espalda_3_4_der' || ang360.id === 'espalda_3_4_izq') ? '_espalda_3_4' : '')));
      if (suf && tieneUrlPiezaPiro(personaje, req + suf)) return req + suf;
    }
    return req;
  }
  if (ang360 && ang360.cuerpo) return ang360.cuerpo;
  return req || 'cuerpo_base';
}

export function resolverZonaAccesorioPiro(accKey, accObj) {
  if (!accKey) return '';
  const zExp = accObj && accObj.zona_anclaje ? String(accObj.zona_anclaje).toLowerCase().trim() : '';
  if (zExp === 'ojos' || zExp === 'cabeza_top' || zExp === 'cabeza') return 'cabeza';
  if (zExp === 'cuello' || zExp === 'torso') return 'torso';
  if (zExp === 'mano' || zExp === 'frente') return 'frente';
  const accTxt = ((accObj && accObj.etiqueta ? accObj.etiqueta : '') + ' ' + accKey).toLowerCase();
  if (/(gafa|lente|visor|audifon|gorra|sombrero|corona|diadema|casco|pelo|barba)/.test(accTxt)) return 'cabeza';
  if (/(hoodie|camis|chaquet|blazer|chaleco|abrigo|sueter|cadena|collar|corbata|vest)/.test(accTxt)) return 'torso';
  return 'frente';
}

export const ANGULOS_360_PIRO = {
  frente: { id: 'frente', nombre: '0° Frente', cabeza: 'cabeza_frente', cuerpo: 'cuerpo_frente', flipAuto: false, ocultarCara: false },
  '3_4_der': { id: '3_4_der', nombre: '45° 3/4 Der', cabeza: 'cabeza_base', cuerpo: 'cuerpo_base', flipAuto: false, ocultarCara: false },
  perfil_der: { id: 'perfil_der', nombre: '90° Perfil Der', cabeza: 'cabeza_perfil', cuerpo: 'cuerpo_perfil', flipAuto: false, ocultarCara: false },
  espalda_3_4_der: { id: 'espalda_3_4_der', nombre: '135° Esp 3/4 Der', cabeza: 'cabeza_espalda_3_4', cuerpo: 'cuerpo_espalda_3_4', flipAuto: false, ocultarCara: true },
  espalda: { id: 'espalda', nombre: '180° Espalda', cabeza: 'cabeza_espalda', cuerpo: 'cuerpo_espalda', flipAuto: false, ocultarCara: true },
  espalda_3_4_izq: { id: 'espalda_3_4_izq', nombre: '225° Esp 3/4 Izq', cabeza: 'cabeza_espalda_3_4', cuerpo: 'cuerpo_espalda_3_4', flipAuto: true, ocultarCara: true },
  perfil_izq: { id: 'perfil_izq', nombre: '270° Perfil Izq', cabeza: 'cabeza_perfil', cuerpo: 'cuerpo_perfil', flipAuto: true, ocultarCara: false },
  '3_4_izq': { id: '3_4_izq', nombre: '315° 3/4 Izq', cabeza: 'cabeza_base', cuerpo: 'cuerpo_base', flipAuto: true, ocultarCara: false }
};

export const CEJAS_PIRO = {
  neutro: 'Neutro', enojado: 'Enojado', triste: 'Triste', duda_izq: 'Duda Izq',
  duda_der: 'Duda Der', sorpresa: 'Sorpresa', coqueto: 'Coqueto', preocupado: 'Preocupado', sarcasmo: 'Sarcasmo'
};

export function resolverAngulo360Piro(anguloId) {
  if (!anguloId || !ANGULOS_360_PIRO[anguloId]) return null;
  return ANGULOS_360_PIRO[anguloId];
}

export function obtenerPerspectivaCabeza(cabezaKey) {
  const k = String(cabezaKey || 'cabeza_base');
  if (k === 'cabeza_frente') return 'frente';
  if (k === 'cabeza_perfil') return 'perfil';
  if (k === 'cabeza_espalda' || k === 'cabeza_espalda_3_4') return 'espalda';
  return '3_4';
}

export const AJUSTES_CAPA_KEYS = ['cuerpo', 'cabeza', 'ojos', 'cejas', 'boca', 'brazo', 'mano', 'acc'];

export function normalizarAjusteObjPiro(v) {
  return {
    dx: (v && typeof v.dx === 'number' && Number.isFinite(v.dx)) ? v.dx : 0,
    dy: (v && typeof v.dy === 'number' && Number.isFinite(v.dy)) ? v.dy : 0,
    sc: (v && typeof v.sc === 'number' && v.sc > 0.2 && v.sc < 3) ? v.sc : 1,
    rot: (v && typeof v.rot === 'number' && Number.isFinite(v.rot)) ? Math.max(-180, Math.min(180, v.rot)) : 0,
    flipX: Boolean(v && v.flipX)
  };
}

export function parsearAjustesCapas(p) {
  const raw = (p && p.ajustes_capas && typeof p.ajustes_capas === 'object') ? p.ajustes_capas : {};
  const out = {};
  AJUSTES_CAPA_KEYS.forEach(function(k) { out[k] = normalizarAjusteObjPiro(raw[k]); });
  return out;
}

export function parsearAjustePiezaPiro(p, slotKey, campoAlt) {
  const pzs = (p && p.piezas) || {};
  const pz = slotKey ? pzs[slotKey] : null;
  const raw = pz ? (campoAlt ? pz[campoAlt] : pz.ajuste) : null;
  return normalizarAjusteObjPiro(raw);
}

export function combinarAjustesPiro(a, b) {
  const x = normalizarAjusteObjPiro(a), y = normalizarAjusteObjPiro(b);
  return {
    dx: Number((x.dx + y.dx).toFixed(2)),
    dy: Number((x.dy + y.dy).toFixed(2)),
    sc: Math.max(0.2, Math.min(3, Number((x.sc * y.sc).toFixed(4)))),
    rot: Number((x.rot + y.rot).toFixed(2)),
    flipX: Boolean(x.flipX) !== Boolean(y.flipX)
  };
}

function aplicarTransformAjuste(ctx, aj, ax, ay) {
  if (!aj) return;
  const dx = Number(aj.dx) || 0, dy = Number(aj.dy) || 0;
  const sc = (typeof aj.sc === 'number' && aj.sc > 0.2 && aj.sc < 3) ? aj.sc : 1;
  const rot = Number(aj.rot) || 0, fl = Boolean(aj.flipX);
  if (dx === 0 && dy === 0 && sc === 1 && rot === 0 && !fl) return;
  ctx.translate(ax + dx, ay + dy);
  if (rot !== 0) ctx.rotate((rot * Math.PI) / 180);
  if (fl || sc !== 1) ctx.scale((fl ? -1 : 1) * sc, sc);
  ctx.translate(-ax, -ay);
}

export function parsearMoldes(p) {
  let raw = null;
  if (p && p.pivotes && typeof p.pivotes === 'object') raw = p.pivotes;
  else if (p && p.pivotes_json) {
    try { raw = JSON.parse(p.pivotes_json); } catch (e) { raw = null; }
  }
  const moldes = {};
  if (raw && raw._moldes && typeof raw._moldes === 'object') {
    Object.keys(raw._moldes).forEach(function(mk) {
      const m = raw._moldes[mk];
      if (m && typeof m === 'object') moldes[mk] = m;
    });
  }
  const cajasLegacy = (raw && raw._cajas && typeof raw._cajas === 'object') ? raw._cajas : null;
  if (cajasLegacy && !moldes.cabeza_base) {
    const zBase = {};
    ['ojos', 'boca', 'accesorio'].forEach(function(z) {
      if (cajasLegacy[z] && cajasLegacy[z].w > 4 && cajasLegacy[z].h > 4) {
        zBase[z] = { caja: cajasLegacy[z], puntos: [] };
      }
    });
    if (Object.keys(zBase).length > 0) {
      moldes.cabeza_base = { angulo: '3_4', zonas: zBase, calibrado: true };
    }
  }
  return moldes;
}

export function calcularTransformZona(cajaSrc, cajaDst) {
  if (!cajaSrc || !cajaDst || !(cajaSrc.w > 4) || !(cajaSrc.h > 4) || !(cajaDst.w > 4) || !(cajaDst.h > 4)) return null;
  const cxSrc = cajaSrc.x + cajaSrc.w / 2;
  const cySrc = cajaSrc.y + cajaSrc.h / 2;
  const cxDst = cajaDst.x + cajaDst.w / 2;
  const cyDst = cajaDst.y + cajaDst.h / 2;
  const sc = Math.min(cajaDst.w / cajaSrc.w, cajaDst.h / cajaSrc.h);
  return { cxSrc: cxSrc, cySrc: cySrc, cxDst: cxDst, cyDst: cyDst, scale: Math.max(0.45, Math.min(2.2, sc)) };
}

export function resolverPiezaPerspectiva(personaje, grupo, claveSolicitada, cabezaKey, opts) {
  const cfg = opts || {};
  const piezas = (personaje && personaje.piezas) || {};
  const persp = obtenerPerspectivaCabeza(cabezaKey);
  const pref = grupo === 'ojos' ? 'ojos_' : (grupo === 'cejas' ? 'cejas_' : 'boca_');
  const defBase = grupo === 'ojos' ? 'ojos_neutro' : (grupo === 'cejas' ? 'cejas_neutro' : 'boca_cerrada');
  const rawStr = String(claveSolicitada || defBase);
  const sinPref = rawStr.indexOf(pref) === 0 ? rawStr.slice(pref.length) : rawStr;
  const exprLimpia = sinPref.replace(/^(frente|perfil)_/, '') || (grupo === 'boca' ? 'cerrada' : 'neutro');
  const claveExacta = persp === '3_4' ? (pref + exprLimpia) : (pref + persp + '_' + exprLimpia);
  const claveDefaultPersp = persp === '3_4' ? defBase : (pref + persp + '_' + (grupo === 'boca' ? 'cerrada' : 'neutro'));

  if (piezas[claveExacta] && piezas[claveExacta].url) {
    return { key: claveExacta, url: piezas[claveExacta].url, esExacta: true, perspectiva: persp, transform: null };
  }
  if (persp === '3_4') {
    if (piezas[defBase] && piezas[defBase].url && !cfg.sinFallbackDefault) {
      return { key: defBase, url: piezas[defBase].url, esExacta: true, perspectiva: persp, transform: null };
    }
    return { key: claveExacta, url: null, esExacta: false, perspectiva: persp, transform: null };
  }
  if (piezas[claveDefaultPersp] && piezas[claveDefaultPersp].url && !cfg.sinFallbackDefault) {
    return { key: claveDefaultPersp, url: piezas[claveDefaultPersp].url, esExacta: true, perspectiva: persp, transform: null };
  }

  const moldes = parsearMoldes(personaje);
  const zonaKey = grupo === 'cejas' ? 'ojos' : grupo;
  const zSrc = moldes.cabeza_base && moldes.cabeza_base.zonas && moldes.cabeza_base.zonas[zonaKey] ? moldes.cabeza_base.zonas[zonaKey].caja : null;
  const zDst = moldes[cabezaKey] && moldes[cabezaKey].zonas && moldes[cabezaKey].zonas[zonaKey] ? moldes[cabezaKey].zonas[zonaKey].caja : null;
  const tf = calcularTransformZona(zSrc, zDst);

  if (cfg.soloPerspectiva) {
    if (grupo === 'boca' && cfg.adaptarBocas && persp === 'frente' && tf) {
      const k34 = pref + exprLimpia;
      const u34 = (piezas[k34] && piezas[k34].url) || (piezas[defBase] && piezas[defBase].url) || null;
      if (u34) return { key: (piezas[k34] && piezas[k34].url) ? k34 : defBase, url: u34, esExacta: false, adaptada: true, perspectiva: persp, transform: tf };
    }
    return { key: claveExacta, url: null, esExacta: false, perspectiva: persp, transform: null };
  }

  const kFb = pref + exprLimpia;
  const uFb = (piezas[kFb] && piezas[kFb].url) || (piezas[defBase] && piezas[defBase].url) || null;
  if (uFb) {
    return { key: (piezas[kFb] && piezas[kFb].url) ? kFb : defBase, url: uFb, esExacta: false, adaptada: Boolean(tf), perspectiva: persp, transform: tf };
  }
  return { key: claveExacta, url: null, esExacta: false, perspectiva: persp, transform: null };
}

export async function extraerEnvolventeAudio(url, fps) {
  const rate = fps || 24;
  if (!url) return null;
  const key = url + '@' + rate;
    const hitEnv = lruGet(_envCache, key);
  if (hitEnv) return hitEnv;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!_audioCtx) _audioCtx = new AC();
        let buf = null;
    if (String(url).indexOf('data:') === 0 && String(url).indexOf(';base64,') > 0) {
      const bin = atob(String(url).split(',')[1]);
      const u8 = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
      buf = u8.buffer;
    } else {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      buf = await resp.arrayBuffer();
    }
    const audioBuf = await _audioCtx.decodeAudioData(buf);
    const ch = audioBuf.getChannelData(0);
    const sr = audioBuf.sampleRate;
    const win = Math.max(1, Math.floor(sr / rate));
    const totalFrames = Math.max(1, Math.ceil(ch.length / win));
    const rms = new Float32Array(totalFrames);
    let maxVal = 0.001;
    for (let f = 0; f < totalFrames; f++) {
      let sum = 0;
      const ini = f * win;
      const fin = Math.min(ch.length, ini + win);
      for (let i = ini; i < fin; i++) sum += ch[i] * ch[i];
      const v = Math.sqrt(sum / Math.max(1, fin - ini));
      rms[f] = v;
      if (v > maxVal) maxVal = v;
    }
    const norm = new Array(totalFrames);
    for (let f = 0; f < totalFrames; f++) norm[f] = Number((rms[f] / maxVal).toFixed(3));
    const env = { fps: rate, duracion: audioBuf.duration, frames: norm };
        lruSet(_envCache, key, env, MAX_ENV_CACHE);
    return env;
  } catch (e) {
    return null;
  }
}

export function obtenerBocaDesdeEnvolvente(env, tiempoLocalSeg, textoFallback) {
  if (env && Array.isArray(env.frames) && env.frames.length > 0) {
    const idx = Math.floor(Math.max(0, tiempoLocalSeg) * (env.fps || 24));
    if (idx >= env.frames.length) return 'boca_cerrada';
    const amp = env.frames[idx] || 0;
    if (amp < 0.14) return 'boca_cerrada';
    if (amp < 0.42) return 'boca_media';
    return 'boca_abierta';
  }
  if (textoFallback && String(textoFallback).trim()) {
    const fase = Math.floor(Math.max(0, tiempoLocalSeg) * 7) % 3;
    return fase === 0 ? 'boca_cerrada' : (fase === 1 ? 'boca_media' : 'boca_abierta');
  }
  return 'boca_cerrada';
}

const FALLBACK_BOCAS_VISEMA = {
  boca_mbp: ['boca_mbp', 'boca_cerrada'],
  boca_aa: ['boca_aa', 'boca_abierta', 'boca_media', 'boca_cerrada'],
  boca_ee: ['boca_ee', 'boca_sonrisa', 'boca_media', 'boca_cerrada'],
  boca_oh: ['boca_oh', 'boca_o_u', 'boca_abierta', 'boca_media', 'boca_cerrada'],
  boca_oo: ['boca_oo', 'boca_o_u', 'boca_media', 'boca_cerrada'],
  boca_fv: ['boca_fv', 'boca_f_v', 'boca_dientes', 'boca_media', 'boca_cerrada'],
  boca_lth: ['boca_lth', 'boca_dientes', 'boca_media', 'boca_cerrada'],
  boca_s: ['boca_s', 'boca_dientes', 'boca_media', 'boca_cerrada'],
  boca_dtn: ['boca_dtn', 'boca_dientes', 'boca_media', 'boca_cerrada'],
  boca_sh: ['boca_sh', 'boca_o_u', 'boca_dientes', 'boca_media', 'boca_cerrada'],
  boca_kg: ['boca_kg', 'boca_media', 'boca_abierta', 'boca_cerrada'],
  boca_r: ['boca_r', 'boca_o_u', 'boca_media', 'boca_cerrada'],
  boca_f_v: ['boca_fv', 'boca_f_v', 'boca_dientes', 'boca_media', 'boca_cerrada'],
  boca_o_u: ['boca_oh', 'boca_oo', 'boca_o_u', 'boca_media', 'boca_abierta', 'boca_cerrada'],
  boca_dientes: ['boca_s', 'boca_dtn', 'boca_dientes', 'boca_media', 'boca_cerrada'],
  boca_abierta: ['boca_aa', 'boca_abierta', 'boca_media', 'boca_cerrada'],
  boca_media: ['boca_ee', 'boca_media', 'boca_abierta', 'boca_cerrada'],
  boca_cerrada: ['boca_mbp', 'boca_cerrada']
};

export function palabraAVisemasPiro(palabra) {
  const w = String(palabra || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  if (!w) return [];
  const out = [];
  for (let i = 0; i < w.length; i++) {
    const ch = w[i], nxt = w[i + 1] || '', dig = ch + nxt;
    let v = 'boca_ee';
    if (dig === 'ch' || dig === 'sh') { v = 'boca_sh'; i++; }
    else if (dig === 'th' || dig === 'll') { v = 'boca_lth'; i++; }
    else if (dig === 'ph') { v = 'boca_fv'; i++; }
    else if (dig === 'wh' || dig === 'qu' || dig === 'oo') { v = 'boca_oo'; i++; }
    else if (dig === 'aw' || dig === 'ay' || dig === 'ai') { v = 'boca_aa'; i++; }
    else if (dig === 'or') { v = 'boca_oh'; i++; }
    else if (ch === 'm' || ch === 'b' || ch === 'p') v = 'boca_mbp';
    else if (ch === 'f' || ch === 'v') v = 'boca_fv';
    else if (ch === 'a') v = 'boca_aa';
    else if (ch === 'e' || ch === 'i' || ch === 'y') v = 'boca_ee';
    else if (ch === 'o') v = 'boca_oh';
    else if (ch === 'u' || ch === 'w') v = 'boca_oo';
    else if (ch === 'l') v = 'boca_lth';
    else if (ch === 's' || ch === 'z' || ch === 'x' || (ch === 'c' && (nxt === 'e' || nxt === 'i'))) v = 'boca_s';
    else if (ch === 'd' || ch === 't' || ch === 'n') v = 'boca_dtn';
    else if (ch === 'j') v = 'boca_sh';
    else if (ch === 'r') v = 'boca_r';
    else if (ch === 'c' || ch === 'k' || ch === 'g' || ch === 'q') v = 'boca_kg';
    else if (ch === 'h') continue;
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

export function construirVisemasDesdeMarcasPiro(marcas, textoFallback, duracionSeg, env) {
  const pista = [];
  if (Array.isArray(marcas) && marcas.length > 0) {
    marcas.forEach(function(m) {
      const t0 = Math.max(0, Number(m.t) || 0);
      const d = Math.max(0.05, Number(m.d) || 0.16);
      const seq = palabraAVisemasPiro(m.w);
      if (!seq.length) return;
      const paso = d / seq.length;
      for (let i = 0; i < seq.length; i++) {
        pista.push({ t: Number((t0 + i * paso).toFixed(3)), d: Number(paso.toFixed(3)), b: seq[i] });
      }
    });
    return pista;
  }
  const palabras = String(textoFallback || '').trim().split(/\s+/).filter(Boolean);
  if (!palabras.length) return pista;
  if (env && Array.isArray(env.frames) && env.frames.length > 4) {
    const fps = env.fps || 24, dt = 1 / fps;
    const allV = [];
    palabras.forEach(function(w) { palabraAVisemasPiro(w).forEach(function(v) { allV.push(v); }); });
    const activos = [];
    for (let f = 0; f < env.frames.length; f++) { if ((env.frames[f] || 0) >= 0.08) activos.push(f); }
    if (allV.length > 0 && activos.length > 0) {
      for (let i = 0; i < activos.length; i++) {
        const vIdx = Math.min(allV.length - 1, Math.floor((i / activos.length) * allV.length));
        const tF = activos[i] * dt;
        if (pista.length && pista[pista.length - 1].b === allV[vIdx] && Math.abs((pista[pista.length - 1].t + pista[pista.length - 1].d) - tF) < dt * 1.5) {
          pista[pista.length - 1].d = Number((pista[pista.length - 1].d + dt).toFixed(3));
        } else {
          pista.push({ t: Number(tF.toFixed(3)), d: Number(dt.toFixed(3)), b: allV[vIdx] });
        }
      }
      return pista;
    }
  }
  const total = Math.max(0.5, Number(duracionSeg) || (palabras.length * 0.34));
  const pesos = palabras.map(function(w) { return Math.max(2, w.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ]/g, '').length); });
  const sumP = pesos.reduce(function(a, b) { return a + b; }, 0) || 1;
  let cur = 0.06;
  const spanUtil = Math.max(0.3, total - 0.18);
  palabras.forEach(function(w, idx) {
    const dw = (pesos[idx] / sumP) * spanUtil;
    const seq = palabraAVisemasPiro(w);
    if (seq.length) {
      const paso = dw / seq.length;
      for (let i = 0; i < seq.length; i++) {
        pista.push({ t: Number((cur + i * paso).toFixed(3)), d: Number(paso.toFixed(3)), b: seq[i] });
      }
    }
    cur += dw;
  });
  return pista;
}

function elegirBocaDisponiblePiro(personaje, cabezaKey, bocaObjetivo) {
  if (!personaje) return bocaObjetivo;
  const cands = FALLBACK_BOCAS_VISEMA[bocaObjetivo] || [bocaObjetivo, 'boca_media', 'boca_cerrada'];
  for (let i = 0; i < cands.length; i++) {
    const r = resolverPiezaPerspectiva(personaje, 'boca', cands[i], cabezaKey, { soloPerspectiva: false, sinFallbackDefault: true });
    if (r && r.url) return cands[i];
  }
  return bocaObjetivo;
}

export function obtenerBocaLipSyncPiro(opts) {
  const o = opts || {};
  const t = Math.max(0, Number(o.tiempoLocal) || 0);
  const modo = o.modo === 'volumen' ? 'volumen' : 'visemas';
  const env = o.envolvente || null;
  const texto = String(o.texto || '');
  const cabezaKey = o.cabezaKey || 'cabeza_base';
  if (modo === 'volumen') {
    return obtenerBocaDesdeEnvolvente(env, t, texto);
  }
  let amp = -1;
  if (env && Array.isArray(env.frames) && env.frames.length > 0) {
    const idx = Math.floor(t * (env.fps || 24));
    if (idx >= env.frames.length) return elegirBocaDisponiblePiro(o.personaje, cabezaKey, 'boca_cerrada');
    amp = env.frames[idx] || 0;
    if (amp < 0.08) return elegirBocaDisponiblePiro(o.personaje, cabezaKey, 'boca_cerrada');
  }
  let pista = Array.isArray(o.visemas) && o.visemas.length > 0 ? o.visemas : null;
  if (!pista && Array.isArray(o.marcas) && o.marcas.length > 0) pista = construirVisemasDesdeMarcasPiro(o.marcas, texto, o.duracion);
  if (!pista && texto.trim()) pista = construirVisemasDesdeMarcasPiro(null, texto, (env && env.duracion) || o.duracion || 3, env);
  if (pista && pista.length > 0) {
    for (let i = 0; i < pista.length; i++) {
      const it = pista[i];
      if (t >= it.t && t <= it.t + it.d + 0.03) {
        let bSel = it.b || 'boca_media';
        if (amp > 0.62 && bSel === 'boca_media') bSel = 'boca_abierta';
        return elegirBocaDisponiblePiro(o.personaje, cabezaKey, bSel);
      }
    }
    if (amp >= 0.14) return elegirBocaDisponiblePiro(o.personaje, cabezaKey, amp >= 0.42 ? 'boca_abierta' : 'boca_media');
    return 'boca_cerrada';
  }
  return obtenerBocaDesdeEnvolvente(env, t, texto);
}

export const MIRADAS_PIRO = {
  frente: { id: 'frente', nombre: 'Frente', x: 0, y: 0, dil: 1 },
  interlocutor: { id: 'interlocutor', nombre: 'Al Otro Actor', x: 0.35, y: 0, dil: 1, autoOtro: true },
  camara: { id: 'camara', nombre: 'A Camara', x: -0.08, y: 0.02, dil: 1.08 },
  arriba_frustracion: { id: 'arriba_frustracion', nombre: 'Frustracion Arriba', x: 0.05, y: -0.78, dil: 0.92 },
  abajo_culpa: { id: 'abajo_culpa', nombre: 'Culpa Abajo', x: 0.14, y: 0.74, dil: 0.95 },
  evadir_izq: { id: 'evadir_izq', nombre: 'Evadir Izq', x: -0.78, y: 0.1, dil: 0.94 },
  evadir_der: { id: 'evadir_der', nombre: 'Evadir Der', x: 0.78, y: 0.1, dil: 0.94 },
  arriba_pensar: { id: 'arriba_pensar', nombre: 'Pensar Arriba', x: 0.56, y: -0.64, dil: 1.0 },
  shock: { id: 'shock', nombre: 'Shock (Pequena)', x: 0, y: 0, dil: 0.54 },
  ternura: { id: 'ternura', nombre: 'Ternura (Grande)', x: 0, y: -0.05, dil: 1.32 }
};

function resolverVectorMirada(miradaId, vecInterlocutor) {
  const m = MIRADAS_PIRO[miradaId] || MIRADAS_PIRO.frente;
  if (m.autoOtro && vecInterlocutor) {
    return { x: Math.max(-0.85, Math.min(0.85, Number(vecInterlocutor.x) || 0)), y: Math.max(-0.8, Math.min(0.8, Number(vecInterlocutor.y) || 0)), dil: m.dil || 1 };
  }
  return { x: m.x || 0, y: m.y || 0, dil: m.dil || 1 };
}

export function evaluarMiradaActorPiro(actorObj, sc, tLocalSeg, vecInterlocutor, seedStr) {
  const a = actorObj || {}, t = Math.max(0, Number(tLocalSeg) || 0);
  let prevId = a.mirada || (sc && sc.mirada) || (vecInterlocutor ? 'interlocutor' : 'frente');
  let curId = prevId, tCambio = -1;
  const evs = (sc && Array.isArray(sc.eventos_actuacion)) ? sc.eventos_actuacion : [];
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    if (!ev || typeof ev.t !== 'number' || !ev.mirada || (ev.actorId && ev.actorId !== a.id)) continue;
    if (t >= ev.t) { prevId = curId; curId = ev.mirada; tCambio = ev.t; }
  }
  const vPrev = resolverVectorMirada(prevId, vecInterlocutor);
  const vCur = resolverVectorMirada(curId, vecInterlocutor);
  let x = vCur.x, y = vCur.y, dil = vCur.dil;
  if (tCambio >= 0 && (t - tCambio) < 0.095) {
    const k = evaluarCurvaPiro('easeOut', Math.max(0, (t - tCambio) / 0.095));
    x = vPrev.x + (vCur.x - vPrev.x) * k;
    y = vPrev.y + (vCur.y - vPrev.y) * k;
    dil = vPrev.dil + (vCur.dil - vPrev.dil) * k;
  }
  if (!sc || sc.vida_auto !== false) {
    const h = hashSemillaPiro(seedStr || a.id || 'gaze');
    const pasoMicro = Math.floor((t + (h % 17) * 0.13) / 1.45);
    const hm = hashSemillaPiro((seedStr || 'g') + '_' + pasoMicro);
    x += (((hm % 100) / 100) - 0.5) * 0.11;
    y += ((((hm >> 7) % 100) / 100) - 0.5) * 0.07;
  }
  return { id: curId, x: Math.max(-0.9, Math.min(0.9, x)), y: Math.max(-0.85, Math.min(0.85, y)), dil: Math.max(0.45, Math.min(1.45, dil)) };
}

function dibujarPupilasDinamicasPiro(ctx, piezaObj, mirada, tf, personaje, ajOjos, ptOjos) {
  if (!piezaObj || !piezaObj.pupila_dinamica || !Array.isArray(piezaObj.escleroticas) || !piezaObj.escleroticas.length) return;
  const m = mirada || { x: 0, y: 0, dil: 1 };
  const colorIris = (personaje && personaje.encuesta_v2 && personaje.encuesta_v2.color_iris_hex) || '';
  ctx.save();
  if (ajOjos && ptOjos) aplicarTransformAjuste(ctx, ajOjos, ptOjos.x, ptOjos.y);
  if (tf) {
    ctx.translate(tf.cxDst, tf.cyDst);
    ctx.scale(tf.scale, tf.scale);
    ctx.translate(-tf.cxSrc, -tf.cySrc);
  }
  piezaObj.escleroticas.forEach(function(s) {
    const rx = Math.max(4, Number(s.rx) || 12), ry = Math.max(3, Number(s.ry) || 10);
    const cx = Number(s.cx) || 500, cy = Number(s.cy) || 340;
    const rBase = Math.max(2.6, Math.min(rx, ry) * 0.44 * (m.dil || 1));
    const dx = (m.x || 0) * Math.max(1.5, rx - rBase * 0.72);
    const dy = (m.y || 0) * Math.max(1.2, ry - rBase * 0.72);
    const px = cx + dx, py = cy + dy;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.94, ry * 0.92, 0, 0, Math.PI * 2);
    ctx.clip();
    if (colorIris) {
      ctx.fillStyle = colorIris;
      ctx.beginPath(); ctx.arc(px, py, rBase * 1.28, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#090b10';
    ctx.beginPath(); ctx.arc(px, py, rBase, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath(); ctx.arc(px - rBase * 0.34, py - rBase * 0.34, Math.max(1.2, rBase * 0.28), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
  ctx.restore();
}

export function calcularCamara25DPiro(sc, tLocalSeg, esH) {
  const cam = (sc && sc.camara) || 'centro';
  const dur = Math.max(0.5, Number(sc && sc.duracion) || 3);
  const u = evaluarCurvaPiro('easeInOut', Math.max(0, Math.min(1, (Number(tLocalSeg) || 0) / dur)));
  const spanPan = esH ? 95 : 150;
  let zoom = 1.0, panX = 0;
  if (cam === 'zoom_actor') zoom = 1.18;
  else if (cam === 'plano_general') zoom = 0.92;
  else if (cam === 'izq') panX = spanPan;
  else if (cam === 'der') panX = -spanPan;
  else if (cam === 'paneo_der') panX = spanPan * (1 - 2 * u);
  else if (cam === 'paneo_izq') panX = spanPan * (-1 + 2 * u);
  else if (cam === 'zoom_in') { zoom = 0.96 + 0.24 * u; panX = (esH ? -18 : -28) * u; }
  else if (cam === 'zoom_out') { zoom = 1.20 - 0.24 * u; panX = (esH ? 18 : 28) * (1 - u); }
  return { zoom: zoom, panX: panX };
}

export async function dibujarElementosVivosPiro(ctx, lista, capaObjetivo, W, H, panX, zoom, tSeg, corsOpt) {
  if (!Array.isArray(lista) || !lista.length) return;
  const t = Math.max(0, Number(tSeg) || 0);
  const multZ = capaObjetivo === 'z1' ? 0.2 : (capaObjetivo === 'z4' ? 1.32 : 0.55);
  for (let i = 0; i < lista.length; i++) {
    const el = lista[i];
    if (!el || !el.url || (el.capa || 'z2') !== capaObjetivo) continue;
    const im = await cargarImagenPiro(el.url, corsOpt);
    if (!im) continue;
    const wDraw = (Number(el.w) || 0.24) * W * zoom;
    const hDraw = (Number(el.h) ? (Number(el.h) * H * zoom) : (wDraw * (im.height / Math.max(1, im.width))));
    const bw = Math.max(16, wDraw), bh = Math.max(16, hDraw);
    const cx = (el.x !== undefined && !isNaN(Number(el.x)) ? Number(el.x) : 0.5) * W + panX * multZ;
    const cy = (el.y !== undefined && !isNaN(Number(el.y)) ? Number(el.y) : 0.25) * H;
    const modo = el.modo || 'flotar';
    const vel = Number(el.vel) || 1;
    const amp = Number(el.amp) || 8;
    ctx.save();
    if (modo === 'bucle_h') {
      const span = W + bw * 1.4;
      const desp = ((cx + t * vel * 38) % span + span) % span - bw * 0.7;
      ctx.drawImage(im, desp - bw / 2, cy - bh / 2, bw, bh);
    } else if (modo === 'rotar') {
      ctx.translate(cx, cy);
      ctx.rotate(t * vel * 2.4);
      ctx.drawImage(im, -bw / 2, -bh / 2, bw, bh);
    } else if (modo === 'frames') {
      const cols = Math.max(1, Number(el.cols) || 2), rows = Math.max(1, Number(el.rows) || 2);
      const totF = cols * rows, fpsEl = Math.max(1, Number(el.fps) || 4);
      const fIdx = Math.floor(t * fpsEl) % totF;
      const fc = fIdx % cols, fr = Math.floor(fIdx / cols);
      const sw = im.width / cols, sh = im.height / rows;
      ctx.drawImage(im, fc * sw, fr * sh, sw, sh, cx - bw / 2, cy - bh / 2, bw, bh);
    } else {
      const dy = Math.sin(t * vel * 2.0 + i) * amp;
      ctx.drawImage(im, cx - bw / 2, cy - bh / 2 + dy, bw, bh);
    }
    ctx.restore();
  }
}

export const CURVAS_PIRO = {
  linear: function(u) { return u; },
  easeInOut: function(u) { return u < 0.5 ? (2 * u * u) : (1 - Math.pow(-2 * u + 2, 2) / 2); },
  easeOut: function(u) { return 1 - Math.pow(1 - u, 3); },
  easeIn: function(u) { return u * u * u; },
  elastic: function(u) { return (u <= 0 || u >= 1) ? u : (Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1); },
  bounce: function(u) { const n1 = 7.5625, d1 = 2.75; if (u < 1 / d1) return n1 * u * u; if (u < 2 / d1) { const t = u - 1.5 / d1; return n1 * t * t + 0.75; } if (u < 2.5 / d1) { const t = u - 2.25 / d1; return n1 * t * t + 0.9375; } const t = u - 2.625 / d1; return n1 * t * t + 0.984375; },
  step: function(u) { return u >= 1 ? 1 : 0; }
};
export function evaluarCurvaPiro(nombre, u) { const c = Math.max(0, Math.min(1, Number(u) || 0)); return (CURVAS_PIRO[nombre] || CURVAS_PIRO.easeInOut)(c); }
function hashSemillaPiro(txt) { const s = String(txt || 'piro'); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
export const ACTUACIONES_PIRO = {
  ninguna: { id: 'ninguna', nombre: 'Normal (Base)', durCiclo: 1.0, loop: false, curva: 'easeInOut', frames: [] },
  saludar: { id: 'saludar', nombre: 'Saludar', durCiclo: 1.4, loop: true, curva: 'easeInOut', ojos: 'feliz', mano: 'mano_abierta', frames: [{ p: 0, rotCab: -4, rotBrazo: -38, rotAntebrazo: -25, rotMano: -12, scaleX: 1, scaleY: 1, offsetY: 0 }, { p: 0.25, rotCab: 5, rotBrazo: -52, rotAntebrazo: -12, rotMano: 18, scaleX: 0.98, scaleY: 1.02, offsetY: -6 }, { p: 0.5, rotCab: -3, rotBrazo: -40, rotAntebrazo: -28, rotMano: -16, scaleX: 1.01, scaleY: 0.99, offsetY: 0 }, { p: 0.75, rotCab: 5, rotBrazo: -52, rotAntebrazo: -10, rotMano: 18, scaleX: 0.98, scaleY: 1.02, offsetY: -6 }, { p: 1, rotCab: -4, rotBrazo: -38, rotAntebrazo: -25, rotMano: -12, scaleX: 1, scaleY: 1, offsetY: 0 }] },
  cantar_feliz: { id: 'cantar_feliz', nombre: 'Feliz Cantando', durCiclo: 1.2, loop: true, curva: 'easeInOut', ojos: 'feliz', mano: 'mano_abierta', frames: [{ p: 0, rotCab: -9, rotBrazo: -18, rotAntebrazo: -14, rotMano: 8, scaleX: 1.03, scaleY: 0.97, offsetY: 4 }, { p: 0.25, rotCab: 2, rotBrazo: -30, rotAntebrazo: -6, rotMano: -8, scaleX: 0.97, scaleY: 1.04, offsetY: -12 }, { p: 0.5, rotCab: 9, rotBrazo: -14, rotAntebrazo: -18, rotMano: 10, scaleX: 1.03, scaleY: 0.97, offsetY: 4 }, { p: 0.75, rotCab: -2, rotBrazo: -28, rotAntebrazo: -8, rotMano: -8, scaleX: 0.97, scaleY: 1.04, offsetY: -12 }, { p: 1, rotCab: -9, rotBrazo: -18, rotAntebrazo: -14, rotMano: 8, scaleX: 1.03, scaleY: 0.97, offsetY: 4 }] },
  llorar_triste: { id: 'llorar_triste', nombre: 'Triste Llorando', durCiclo: 1.5, loop: true, curva: 'easeInOut', ojos: 'triste', bocaDef: 'boca_triste', mano: 'mano_pecho', frames: [{ p: 0, rotCab: 11, rotBrazo: 14, rotAntebrazo: -18, rotMano: 0, scaleX: 1.02, scaleY: 0.97, offsetY: 6 }, { p: 0.22, rotCab: 15, rotBrazo: 18, rotAntebrazo: -22, rotMano: -4, scaleX: 1.04, scaleY: 0.95, offsetY: 10 }, { p: 0.45, rotCab: 9, rotBrazo: 12, rotAntebrazo: -15, rotMano: 3, scaleX: 1, scaleY: 0.99, offsetY: 3 }, { p: 0.7, rotCab: 15, rotBrazo: 17, rotAntebrazo: -22, rotMano: -4, scaleX: 1.04, scaleY: 0.95, offsetY: 10 }, { p: 1, rotCab: 11, rotBrazo: 14, rotAntebrazo: -18, rotMano: 0, scaleX: 1.02, scaleY: 0.97, offsetY: 6 }] },
  rabieta_enojado: { id: 'rabieta_enojado', nombre: 'Enojado Rabieta', durCiclo: 0.65, loop: true, curva: 'bounce', ojos: 'enojado', bocaDef: 'boca_grito', mano: 'mano_puno', frames: [{ p: 0, rotCab: -10, rotBrazo: -42, rotAntebrazo: -18, rotMano: -10, scaleX: 1.06, scaleY: 0.94, offsetY: 8 }, { p: 0.35, rotCab: 10, rotBrazo: -10, rotAntebrazo: 12, rotMano: 12, scaleX: 0.95, scaleY: 1.06, offsetY: -14 }, { p: 0.7, rotCab: -8, rotBrazo: -46, rotAntebrazo: -22, rotMano: -14, scaleX: 1.06, scaleY: 0.94, offsetY: 8 }, { p: 1, rotCab: -10, rotBrazo: -42, rotAntebrazo: -18, rotMano: -10, scaleX: 1.06, scaleY: 0.94, offsetY: 8 }] },
  reir: { id: 'reir', nombre: 'Reir', durCiclo: 0.55, loop: true, curva: 'easeOut', ojos: 'feliz', bocaDef: 'boca_abierta', frames: [{ p: 0, rotCab: -8, rotBrazo: -10, rotAntebrazo: -6, rotMano: 0, scaleX: 1.03, scaleY: 0.97, offsetY: 4 }, { p: 0.5, rotCab: -15, rotBrazo: -18, rotAntebrazo: -12, rotMano: 6, scaleX: 0.97, scaleY: 1.04, offsetY: -10 }, { p: 1, rotCab: -8, rotBrazo: -10, rotAntebrazo: -6, rotMano: 0, scaleX: 1.03, scaleY: 0.97, offsetY: 4 }] },
  sorprenderse: { id: 'sorprenderse', nombre: 'Sorprenderse', durCiclo: 1.1, loop: false, curva: 'elastic', ojos: 'indignado', bocaDef: 'boca_o_u', mano: 'mano_abierta', frames: [{ p: 0, rotCab: 0, rotBrazo: 0, rotAntebrazo: 0, rotMano: 0, scaleX: 1, scaleY: 1, offsetY: 0 }, { p: 0.25, rotCab: -12, rotBrazo: -36, rotAntebrazo: -20, rotMano: 14, scaleX: 0.92, scaleY: 1.09, offsetY: -18 }, { p: 1, rotCab: -6, rotBrazo: -24, rotAntebrazo: -12, rotMano: 6, scaleX: 0.98, scaleY: 1.02, offsetY: -4 }] },
  pensar: { id: 'pensar', nombre: 'Pensar', durCiclo: 2.2, loop: true, curva: 'easeInOut', ojos: 'duda', mano: 'mano_pecho', frames: [{ p: 0, rotCab: -8, rotBrazo: -24, rotAntebrazo: -28, rotMano: -8, scaleX: 1, scaleY: 1, offsetY: 0 }, { p: 0.5, rotCab: -13, rotBrazo: -28, rotAntebrazo: -32, rotMano: -12, scaleX: 0.99, scaleY: 1.01, offsetY: -2 }, { p: 1, rotCab: -8, rotBrazo: -24, rotAntebrazo: -28, rotMano: -8, scaleX: 1, scaleY: 1, offsetY: 0 }] },
  senalar: { id: 'senalar', nombre: 'Senalar', durCiclo: 1.2, loop: false, curva: 'easeOut', ojos: 'indignado', mano: 'mano_senalando', frames: [{ p: 0, rotCab: 2, rotBrazo: 6, rotAntebrazo: 0, rotMano: 0, scaleX: 1.02, scaleY: 0.98, offsetY: 3 }, { p: 0.35, rotCab: -5, rotBrazo: -44, rotAntebrazo: -10, rotMano: 8, scaleX: 0.97, scaleY: 1.03, offsetY: -8 }, { p: 1, rotCab: -3, rotBrazo: -36, rotAntebrazo: -6, rotMano: 4, scaleX: 1, scaleY: 1, offsetY: 0 }] },
  asentir: { id: 'asentir', nombre: 'Asentir', durCiclo: 0.9, loop: true, curva: 'easeInOut', frames: [{ p: 0, rotCab: -4, rotBrazo: 0, rotAntebrazo: 0, rotMano: 0, scaleX: 1, scaleY: 1, offsetY: 0 }, { p: 0.45, rotCab: 12, rotBrazo: 2, rotAntebrazo: 0, rotMano: 0, scaleX: 1.01, scaleY: 0.99, offsetY: 3 }, { p: 1, rotCab: -4, rotBrazo: 0, rotAntebrazo: 0, rotMano: 0, scaleX: 1, scaleY: 1, offsetY: 0 }] },
  negar: { id: 'negar', nombre: 'Negar', durCiclo: 0.85, loop: true, curva: 'easeInOut', ojos: 'duda', frames: [{ p: 0, rotCab: -11, rotBrazo: -6, rotAntebrazo: 0, rotMano: 0, scaleX: 1, scaleY: 1, offsetY: 0 }, { p: 0.5, rotCab: 11, rotBrazo: 6, rotAntebrazo: 0, rotMano: 0, scaleX: 1, scaleY: 1, offsetY: 0 }, { p: 1, rotCab: -11, rotBrazo: -6, rotAntebrazo: 0, rotMano: 0, scaleX: 1, scaleY: 1, offsetY: 0 }] }
};
function interpolarActuacion(actDef, tLocal) {
  if (!actDef || !Array.isArray(actDef.frames) || !actDef.frames.length) return null;
  const dur = Math.max(0.2, Number(actDef.durCiclo) || 1), tPos = Math.max(0, Number(tLocal) || 0);
  const uCiclo = actDef.loop ? ((tPos % dur) / dur) : Math.min(1, tPos / dur), fs = actDef.frames;
  let a = fs[0], b = fs[fs.length - 1];
  for (let i = 0; i < fs.length - 1; i++) { if (uCiclo >= fs[i].p && uCiclo <= fs[i + 1].p) { a = fs[i]; b = fs[i + 1]; break; } }
  const k = evaluarCurvaPiro(actDef.curva || 'easeInOut', (uCiclo - a.p) / Math.max(0.0001, b.p - a.p));
  const lr = function(v0, v1) { return v0 + (v1 - v0) * k; };
  return { rotCab: lr(a.rotCab || 0, b.rotCab || 0), rotBrazo: lr(a.rotBrazo || 0, b.rotBrazo || 0), rotAntebrazo: lr(a.rotAntebrazo || 0, b.rotAntebrazo || 0), rotMano: lr(a.rotMano || 0, b.rotMano || 0), scaleX: lr(a.scaleX || 1, b.scaleX || 1), scaleY: lr(a.scaleY || 1, b.scaleY || 1), offsetY: lr(a.offsetY || 0, b.offsetY || 0) };
}
export function calcularVidaAutonomaPiro(tSeg, seedStr, estaHablando) {
  const t = Math.max(0, Number(tSeg) || 0), h = hashSemillaPiro(seedStr), fase = (h % 628) / 100;
  const resp = Math.sin(t * 2.1 + fase), cicloParp = 3.2 + ((h % 19) * 0.11), posParp = (t + fase * 0.5) % cicloParp;
  let cabExtra = Math.sin(t * 1.15 + fase) * (estaHablando ? 1.8 : 0.9);
  if (!estaHablando) { const cEsc = (t + fase) % 4.6; if (cEsc > 3.9 && cEsc < 4.45) cabExtra += Math.sin(((cEsc - 3.9) / 0.55) * Math.PI) * 4.5; }
  return { rotCab: cabExtra, rotBrazo: Math.sin(t * 1.4 + fase) * (estaHablando ? 2.6 : 1.0), scaleX: 1 - (resp * 0.007), scaleY: 1 + (resp * 0.013), offsetY: -resp * 2.5, parpadeando: posParp > (cicloParp - 0.14) };
}
export function evaluarAnimacionActorPiro(actorObj, sc, tLocalSeg, estaHablando, personaje) {
  const a = actorObj || {}, t = Math.max(0, Number(tLocalSeg) || 0), vidaOn = !sc || sc.vida_auto !== false;
  const out = { cabeza: a.cabeza || 'cabeza_base', angulo: a.angulo || (sc && sc.angulo) || '', cejas: a.cejas || (sc && sc.cejas) || '', cejasOffsetY: 0, ojos: a.ojos || 'neutro', bocaDef: a.boca || 'boca_cerrada', mano: a.mano || '', rotCab: Number(a.rotCab) || 0, rotBrazo: Number(a.rotBrazo) || 0, rotAntebrazo: Number(a.rotAntebrazo) || 0, rotMano: Number(a.rotMano) || 0, rotBrazoTras: Number(a.rotBrazoTras) || 0, rotAntebrazoTras: Number(a.rotAntebrazoTras) || 0, scaleX: 1, scaleY: 1, offsetY: 0, actuacionActiva: a.actuacion || (sc && sc.actuacion) || 'ninguna' };
  let tActInicio = 0;
  const evs = (sc && Array.isArray(sc.eventos_actuacion)) ? sc.eventos_actuacion : [];
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i]; if (!ev || typeof ev.t !== 'number' || (ev.actorId && ev.actorId !== a.id)) continue;
    if (t >= ev.t) {
      if (ev.cabeza) out.cabeza = ev.cabeza; if (ev.angulo) out.angulo = ev.angulo; if (ev.cejas !== undefined) out.cejas = ev.cejas; if (ev.ojos) out.ojos = ev.ojos; if (ev.mano !== undefined) out.mano = ev.mano;
      const durEv = Number(ev.dur) || 0; if (ev.actuacion && (!durEv || t <= ev.t + durEv)) { out.actuacionActiva = ev.actuacion; tActInicio = ev.t; }
    }
  }
  if (vidaOn) {
    const v = calcularVidaAutonomaPiro(t, (sc && sc.id ? sc.id : 'sc') + '_' + (a.id || 'per'), estaHablando);
    out.rotCab += v.rotCab; out.rotBrazo += v.rotBrazo; out.scaleX *= v.scaleX; out.scaleY *= v.scaleY; out.offsetY += v.offsetY;
    if (estaHablando) out.cejasOffsetY += Math.sin(t * 7.5) * -3.5;
    if (v.parpadeando && out.ojos !== 'cerrados' && out.ojos !== 'ojos_cerrados') {
      const rCerr = resolverPiezaPerspectiva(personaje, 'ojos', 'ojos_cerrados', out.cabeza, { soloPerspectiva: true, sinFallbackDefault: true });
      if (rCerr && rCerr.url) out.ojos = 'ojos_cerrados';
    }
  }
  const actDef = ACTUACIONES_PIRO[out.actuacionActiva];
  if (actDef && actDef.frames && actDef.frames.length > 0) {
    const pose = interpolarActuacion(actDef, Math.max(0, t - tActInicio));
        const modRigA = resolverModoBrazosPiro(personaje, a.brazo || '', a.brazoTras || '', Boolean(a.prop));
    const usaArtDel = modRigA.brazoDel === 'articulado' && modRigA.caps.artDelCompleto;
    if (pose) { const kBr = usaArtDel ? 1 : 0.35; out.rotCab += pose.rotCab; out.rotBrazo += pose.rotBrazo * kBr; out.rotAntebrazo += pose.rotAntebrazo * kBr; out.rotMano += pose.rotMano * kBr; out.rotBrazoTras += (pose.rotBrazo || 0) * -0.18 * kBr; out.rotAntebrazoTras += (pose.rotAntebrazo || 0) * 0.22 * kBr; out.scaleX *= pose.scaleX; out.scaleY *= pose.scaleY; out.offsetY += pose.offsetY; }
    if (actDef.ojos && out.ojos !== 'ojos_cerrados') out.ojos = actDef.ojos;
    if (actDef.bocaDef) out.bocaDef = actDef.bocaDef;
    if (actDef.mano && !out.mano && usaArtDel) out.mano = actDef.mano;
  }
  return out;
}

export function normalizarActoresEscena(sc) {
  if (!sc) return [];
  if (Array.isArray(sc.actores) && sc.actores.length > 0) {
    return sc.actores.map(function(a) {
      return {
        id: String(a.id || sc.actor || 'per_001'),
        posicion: String(a.posicion || 'centro'),
                cabeza: String(a.cabeza || 'cabeza_base'),
        cuerpo: String(a.cuerpo || 'cuerpo_base'),
        ojos: String(a.ojos || 'neutro'),
        boca: String(a.boca || 'boca_cerrada'),
        brazo: String(a.brazo || (a.prop ? 'brazo_delantero_prop' : 'brazo_delantero_reposo')),
              brazoTras: String(a.brazoTras || ((a.brazo === 'articulado' || a.brazo === 'auto') ? 'auto' : 'brazo_trasero_reposo')),
        mano: String(a.mano || ''),
        rotCab: Number(a.rotCab) || 0,
        rotBrazo: Number(a.rotBrazo) || 0,
        rotAntebrazo: Number(a.rotAntebrazo) || 0,
        rotMano: Number(a.rotMano) || 0,
        rotBrazoTras: Number(a.rotBrazoTras) || 0,
        prop: String(a.prop || ''),
        acc: String(a.acc || ''),
        rotAntebrazoTras: Number(a.rotAntebrazoTras) || 0,
        actuacion: String(a.actuacion || ''),
        mirada: String(a.mirada || ''),
        cejas: String(a.cejas || ''),
        angulo: String(a.angulo || ''),
        escala: Number(a.escala) || 1
      };
    });
  }
  if (!sc.actor) return [];
  const esPropMano = Boolean(sc.prop && String(sc.prop).indexOf('fx_') !== 0);
  return [{
    id: String(sc.actor),
    posicion: String(sc.posicion || 'centro'),
    ojos: String(sc.ojos || 'neutro'),
    boca: 'boca_cerrada',
    brazo: esPropMano ? 'brazo_delantero_prop' : 'brazo_delantero_reposo',
    rotCab: Number(sc.rotCab) || 0,
    rotBrazo: Number(sc.rotBrazo) || 0,
    prop: esPropMano ? String(sc.prop) : '',
    acc: String(sc.acc || ''),
    actuacion: String(sc.actuacion || ''),
    mirada: String(sc.mirada || ''),
    cejas: String(sc.cejas || ''),
    angulo: String(sc.angulo || ''),
    escala: 1
  }];
}

/**
 * Dibuja una marioneta Piro-Rig 2D en su espacio canónico 1000x1600.
 * - Si opts.modoLienzoCompleto === true: dibuja directamente en (0..1000, 0..1600) (Probador Sándwich).
 * - Si no: posiciona el centro (500,800) en (opts.x, opts.y) aplicando opts.scale y opts.flipX (Timeline).
 */
export async function dibujarMarionetaPiro(ctx, personaje, opts) {
  if (!ctx || !personaje) return 0;
  const cfg = opts || {};
  const piezas = personaje.piezas || {};
  const piv = parsearPivotes(personaje);
  const ajCapas = parsearAjustesCapas(personaje);
  const accKey = cfg.acc ? String(cfg.acc) : '';

      const ang360 = resolverAngulo360Piro(cfg.angulo360);
    const cabezaKey = (ang360 && ang360.cabeza) ? ang360.cabeza : (cfg.cabeza || 'cabeza_base');
  const cuerpoKey = resolverCuerpoPiro(personaje, cfg.cuerpo, ang360);
  const ocultarCara360 = Boolean((ang360 && ang360.ocultarCara) || cabezaKey === 'cabeza_espalda' || cabezaKey === 'cabeza_espalda_3_4');
  const flip360 = Boolean(ang360 && ang360.flipAuto);
  const moldes = parsearMoldes(personaje);
  const resOjos = resolverPiezaPerspectiva(personaje, 'ojos', cfg.ojos, cabezaKey, { soloPerspectiva: Boolean(cfg.soloPerspectiva), sinFallbackDefault: Boolean(cfg.soloPerspectiva) });
  const resBoca = resolverPiezaPerspectiva(personaje, 'boca', cfg.boca, cabezaKey, { soloPerspectiva: Boolean(cfg.soloPerspectiva), adaptarBocas: cfg.adaptarBocas === true, sinFallbackDefault: Boolean(cfg.soloPerspectiva) });
  const tieneCejasLib = Object.keys(piezas).some(function(k) { return k.indexOf('cejas_') === 0 && piezas[k] && piezas[k].url; });
  const cejasSol = (cfg.cejas && cfg.cejas !== 'ninguno') ? cfg.cejas : (tieneCejasLib ? ('cejas_' + String(cfg.ojos || 'neutro').replace(/^ojos_(frente_|perfil_)?/, '')) : '');
  const resCejas = (!ocultarCara360 && cejasSol && tieneCejasLib) ? resolverPiezaPerspectiva(personaje, 'cejas', cejasSol, cabezaKey, { soloPerspectiva: Boolean(cfg.soloPerspectiva), sinFallbackDefault: Boolean(cfg.soloPerspectiva) }) : { key: 'ninguno', url: null, transform: null };
  const ojosKey = (!ocultarCara360 && resOjos.url) ? resOjos.key : 'ninguno';
  const cejasKey = (!ocultarCara360 && resCejas.url) ? resCejas.key : 'ninguno';
  const bocaKey = resBoca.url ? resBoca.key : 'ninguno';
    const modoBr = resolverModoBrazosPiro(personaje, cfg.brazoDel, cfg.brazoTras, Boolean(cfg.propImg));
  const brazoDelKey = modoBr.brazoDel;
  const brazoTrasKey = modoBr.brazoTras;
  const accObj = (accKey && piezas[accKey]) ? piezas[accKey] : null;
  const accZona = resolverZonaAccesorioPiro(accKey, accObj);
  const manoKey = cfg.mano ? (String(cfg.mano).indexOf('mano_') === 0 ? cfg.mano : ('mano_' + cfg.mano)) : '';
  const piernaDelKey = cfg.piernaDel || 'pierna_delantera';
  const piernaTrasKey = cfg.piernaTras || 'pierna_trasera';
  const rotCab = Number(cfg.rotCab) || 0;
  const rotBrazo = Number(cfg.rotBrazo) || 0;
  const rotAntebrazo = Number(cfg.rotAntebrazo) || 0;
  const rotMano = Number(cfg.rotMano) || 0;
  const rotBrazoTras = Number(cfg.rotBrazoTras) || 0;
  const rotAntebrazoTras = Number(cfg.rotAntebrazoTras) || 0;
  const piernas = cfg.piernas !== false;

  const claves = [
    'brazo_trasero_reposo', brazoTrasKey, 'brazo_tras_sup', 'brazo_tras_ant',
    'pierna_trasera', 'pierna_delantera', piernaTrasKey, piernaDelKey,
    'cuerpo_base', cuerpoKey, 'maestro_cuerpo', 'maestro_perfil',
    'cabeza_base', cabezaKey, ojosKey, cejasKey, bocaKey, 'cuerpo_frente', 'cuerpo_perfil', 'cuerpo_espalda', 'cuerpo_espalda_3_4',
            'brazo_delantero_reposo', brazoDelKey, 'brazo_del_sup', 'brazo_del_ant', manoKey, 'mano_relajada', 'mano_trasera', cfg.manoTras || '', personaje.mano_trasera_ref || '', accKey
  ];
  const imgs = {};
  await Promise.all(claves.map(async function(k) {
    if (k && k !== 'ninguno' && k !== 'articulado' && !imgs[k]) {
            imgs[k] = await cargarImagenPiro(piezas[k] ? piezas[k].url : null, { strictCors: Boolean(cfg.modoExportacion) });
    }
  }));

    const cuerpoImg = imgs[cuerpoKey] || ((ang360 && ang360.cuerpo && imgs[ang360.cuerpo]) || imgs.cuerpo_base);
  const cabezaImg = imgs[cabezaKey] || (cfg.soloPerspectiva ? null : imgs.cabeza_base);
  const ojosImg = (!ocultarCara360 && resOjos.url) ? imgs[resOjos.key] : null;
  const cejasImg = (!ocultarCara360 && resCejas.url) ? imgs[resCejas.key] : null;
  const bocaImg = (!ocultarCara360 && resBoca.url) ? imgs[resBoca.key] : null;
  const tieneArtDel = Boolean(imgs.brazo_del_sup && imgs.brazo_del_ant);
  const tieneArtTras = Boolean(imgs.brazo_tras_sup && imgs.brazo_tras_ant);
  const tieneModulares = Boolean(
    cuerpoImg || cabezaImg || ojosImg || bocaImg || tieneArtDel || tieneArtTras ||
    imgs.brazo_trasero_reposo || (brazoDelKey !== 'ninguno' && imgs[brazoDelKey])
  );

  ctx.save();
  if (!cfg.modoLienzoCompleto) {
    const sc = Number(cfg.scale) || 0.44;
    ctx.translate(Number(cfg.x) || 270, Number(cfg.y) || 530);
    if (cfg.flipX) ctx.scale(-1, 1);
    ctx.scale(sc, sc);
    ctx.translate(-500, -800);
  } else if (flip360) {
    ctx.translate(1000, 0);
    ctx.scale(-1, 1);
  }
  const sxAnim = Number(cfg.scaleX) || 1, syAnim = Number(cfg.scaleY) || 1, oyAnim = Number(cfg.offsetY) || 0;
  if (sxAnim !== 1 || syAnim !== 1 || oyAnim !== 0) {
    ctx.translate(500, 1480 + oyAnim);
    ctx.scale(sxAnim, syAnim);
    ctx.translate(-500, -1480);
  }

  let capasDibujadas = 0;
  const drawP = function(im) {
    if (im) { ctx.drawImage(im, 0, 0, 1000, 1600); capasDibujadas++; }
  };
  const drawR = function(im, pt, deg) {
    if (!im) return;
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(im, -pt.x, -pt.y, 1000, 1600);
    ctx.restore();
    capasDibujadas++;
  };

    if (tieneModulares) {
    const esOverlayDoble = (brazoDelKey === 'brazos_cruzados' || brazoDelKey === 'manos_cintura');
    if (brazoTrasKey !== 'ninguno' && !esOverlayDoble) {
      const ptHT = piv.hombro_trasero;
            if (brazoTrasKey === 'articulado' && tieneArtTras) {
        const ajBTSup = parsearAjustePiezaPiro(personaje, 'brazo_tras_sup');
        const ajBTAnt = parsearAjustePiezaPiro(personaje, 'brazo_tras_ant');
        ctx.save();
        aplicarTransformAjuste(ctx, ajCapas.brazo, ptHT.x, ptHT.y);
        ctx.translate(ptHT.x, ptHT.y);
        ctx.rotate((rotBrazoTras * Math.PI) / 180);
        if (imgs.brazo_tras_sup) { ctx.save(); aplicarTransformAjuste(ctx, ajBTSup, 0, 0); ctx.drawImage(imgs.brazo_tras_sup, -ptHT.x, -ptHT.y, 1000, 1600); ctx.restore(); capasDibujadas++; }
        if (imgs.brazo_tras_ant) {
          const ptCT = piv.codo_trasero;
          const ptMT = piv.mano_trasera;
          ctx.translate(ptCT.x - ptHT.x, ptCT.y - ptHT.y);
          ctx.rotate((rotAntebrazoTras * Math.PI) / 180);
          ctx.save(); aplicarTransformAjuste(ctx, ajBTAnt, 0, 0); ctx.drawImage(imgs.brazo_tras_ant, -ptCT.x, -ptCT.y, 1000, 1600); ctx.restore();
          capasDibujadas++;
          const manoTrasSlot = (cfg.manoTras && imgs[cfg.manoTras]) ? cfg.manoTras : ((personaje.mano_trasera_ref && imgs[personaje.mano_trasera_ref]) ? personaje.mano_trasera_ref : (imgs.mano_trasera ? 'mano_trasera' : 'mano_relajada'));
          const manoTrasImg = imgs[manoTrasSlot] || null;
          if (manoTrasImg) {
            const esManoTrasPropia = manoTrasSlot === 'mano_trasera';
            const pzMT = piezas[manoTrasSlot];
            const rawAjMT = (pzMT && pzMT.ajuste_tras) ? pzMT.ajuste_tras : (esManoTrasPropia ? (pzMT && pzMT.ajuste) : { flipX: true });
            const ajMT = normalizarAjusteObjPiro(rawAjMT);
            ctx.translate(ptMT.x - ptCT.x, ptMT.y - ptCT.y);
            ctx.save();
            aplicarTransformAjuste(ctx, ajMT, 0, 0);
            if (esManoTrasPropia) ctx.drawImage(manoTrasImg, -ptMT.x, -ptMT.y, 1000, 1600);
            else ctx.drawImage(manoTrasImg, -piv.mano_delantera.x, -piv.mano_delantera.y, 1000, 1600);
            ctx.restore();
            capasDibujadas++;
          }
        }
        ctx.restore();
      } else {
        drawR(imgs[brazoTrasKey] || imgs.brazo_trasero_reposo, ptHT, rotBrazoTras);
      }
    }

    if (piernas && cuerpoKey !== 'cuerpo_sentado') {
      drawP(imgs[piernaTrasKey] || imgs.pierna_trasera);
      drawP(imgs[piernaDelKey] || imgs.pierna_delantera);
    }
            const ajCuerpoTot = combinarAjustesPiro(ajCapas.cuerpo, parsearAjustePiezaPiro(personaje, cuerpoKey));
    const ajAccTot = combinarAjustesPiro(ajCapas.acc, parsearAjustePiezaPiro(personaje, accKey));
    if (cuerpoImg) {
      ctx.save(); aplicarTransformAjuste(ctx, ajCuerpoTot, 500, 1480); drawP(cuerpoImg); ctx.restore();
    } else if (imgs.maestro_cuerpo && cfg.modoLienzoCompleto) {
      ctx.save(); ctx.globalAlpha = 0.42; drawP(imgs.maestro_cuerpo); ctx.restore();
    }
    if (accZona === 'torso' && imgs[accKey]) {
      ctx.save(); aplicarTransformAjuste(ctx, ajAccTot, 500, 680); drawP(imgs[accKey]); ctx.restore();
    }

        const moldeCab = moldes[cabezaKey] || null;
    const ptCuello = (moldeCab && moldeCab.cuello && typeof moldeCab.cuello.x === 'number') ? moldeCab.cuello : piv.cuello;
    const zOjosC = moldeCab && moldeCab.zonas && moldeCab.zonas.ojos && moldeCab.zonas.ojos.caja;
    const zBocaC = moldeCab && moldeCab.zonas && moldeCab.zonas.boca && moldeCab.zonas.boca.caja;
    const ptOjos = zOjosC ? { x: zOjosC.x + zOjosC.w / 2, y: zOjosC.y + zOjosC.h / 2 } : { x: 500, y: 350 };
    const ptCejas = zOjosC ? { x: zOjosC.x + zOjosC.w / 2, y: zOjosC.y - 12 } : { x: 500, y: 315 };
    const ptBoca = zBocaC ? { x: zBocaC.x + zBocaC.w / 2, y: zBocaC.y + zBocaC.h / 2 } : { x: 500, y: 430 };
    const drawFacialEnCab = function(im, tf, aj, ptRef) {
      if (!im) return;
      ctx.save();
      if (aj && ptRef) aplicarTransformAjuste(ctx, aj, ptRef.x, ptRef.y);
      if (tf) { ctx.translate(tf.cxDst, tf.cyDst); ctx.scale(tf.scale, tf.scale); ctx.drawImage(im, -tf.cxSrc, -tf.cySrc, 1000, 1600); }
      else { ctx.drawImage(im, 0, 0, 1000, 1600); }
      ctx.restore();
      capasDibujadas++;
    };
        const ajCabTot = combinarAjustesPiro(ajCapas.cabeza, parsearAjustePiezaPiro(personaje, cabezaKey));
    const ajOjosTot = combinarAjustesPiro(ajCapas.ojos, parsearAjustePiezaPiro(personaje, resOjos.key));
    const ajCejBase = combinarAjustesPiro(ajCapas.cejas, parsearAjustePiezaPiro(personaje, resCejas.key));
    const ajBocaTot = combinarAjustesPiro(ajCapas.boca, parsearAjustePiezaPiro(personaje, resBoca.key));
    ctx.save();
    aplicarTransformAjuste(ctx, ajCabTot, ptCuello.x, ptCuello.y);
    ctx.translate(ptCuello.x, ptCuello.y);
    ctx.rotate((rotCab * Math.PI) / 180);
    ctx.translate(-ptCuello.x, -ptCuello.y);
    if (cabezaImg) { ctx.drawImage(cabezaImg, 0, 0, 1000, 1600); capasDibujadas++; }
    drawFacialEnCab(ojosImg, resOjos.transform, ajOjosTot, ptOjos);
    if (!ocultarCara360 && resOjos.key && resOjos.key.indexOf('cerrad') < 0 && piezas[resOjos.key] && piezas[resOjos.key].pupila_dinamica) {
      dibujarPupilasDinamicasPiro(ctx, piezas[resOjos.key], cfg.miradaVec || null, resOjos.transform, personaje, ajOjosTot, ptOjos);
    }
    if (cejasImg) {
      const cOffY = Number(cfg.cejasOffsetY) || 0;
      const ajCej = Object.assign({}, ajCejBase, { dy: ajCejBase.dy + cOffY });
      drawFacialEnCab(cejasImg, resCejas.transform, ajCej, ptCejas);
    }
    drawFacialEnCab(bocaImg, resBoca.transform, ajBocaTot, ptBoca);
    if (accZona === 'cabeza' && imgs[accKey]) {
      ctx.save(); aplicarTransformAjuste(ctx, ajAccTot, ptOjos.x, ptOjos.y); ctx.drawImage(imgs[accKey], 0, 0, 1000, 1600); ctx.restore(); capasDibujadas++;
    }
    ctx.restore();

    const ptHombro = piv.hombro_delantero;
    const ptCodo = piv.codo_delantero;
    const ptMano = piv.mano_delantera;
    const manoImg = manoKey ? imgs[manoKey] : null;
        if (esOverlayDoble && imgs[brazoDelKey]) {
      const ajBrDoble = combinarAjustesPiro(ajCapas.brazo, parsearAjustePiezaPiro(personaje, brazoDelKey));
      ctx.save(); aplicarTransformAjuste(ctx, ajBrDoble, 500, 640); drawP(imgs[brazoDelKey]); ctx.restore();
    } else if (brazoDelKey === 'articulado' && tieneArtDel) {
      const manoArtKey = manoImg ? manoKey : 'mano_relajada';
      const manoArtImg = manoImg || imgs.mano_relajada;
      const ajBDSup = parsearAjustePiezaPiro(personaje, 'brazo_del_sup');
      const ajBDAnt = parsearAjustePiezaPiro(personaje, 'brazo_del_ant');
      const ajManoArt = combinarAjustesPiro(ajCapas.mano, parsearAjustePiezaPiro(personaje, manoArtKey));
      ctx.save();
      aplicarTransformAjuste(ctx, ajCapas.brazo, ptHombro.x, ptHombro.y);
      ctx.translate(ptHombro.x, ptHombro.y);
      ctx.rotate((rotBrazo * Math.PI) / 180);
      ctx.save(); aplicarTransformAjuste(ctx, ajBDSup, 0, 0); ctx.drawImage(imgs.brazo_del_sup, -ptHombro.x, -ptHombro.y, 1000, 1600); ctx.restore(); capasDibujadas++;
      ctx.translate(ptCodo.x - ptHombro.x, ptCodo.y - ptHombro.y);
      ctx.rotate((rotAntebrazo * Math.PI) / 180);
      ctx.save(); aplicarTransformAjuste(ctx, ajBDAnt, 0, 0); ctx.drawImage(imgs.brazo_del_ant, -ptCodo.x, -ptCodo.y, 1000, 1600); ctx.restore(); capasDibujadas++;
      if (manoArtImg || cfg.propImg) {
        ctx.translate(ptMano.x - ptCodo.x, ptMano.y - ptCodo.y);
        ctx.rotate((rotMano * Math.PI) / 180);
        ctx.save();
        aplicarTransformAjuste(ctx, ajManoArt, 0, 0);
        if (manoArtImg) { ctx.drawImage(manoArtImg, -ptMano.x, -ptMano.y, 1000, 1600); capasDibujadas++; }
        if (cfg.propImg) {
          const propSize = Number(cfg.propSize) || 230;
          ctx.drawImage(cfg.propImg, -propSize / 2, -propSize / 2, propSize, propSize);
          capasDibujadas++;
        }
        ctx.restore();
      }
      ctx.restore();
    } else {
      const brazoUseKey = (brazoDelKey !== 'ninguno') ? (imgs[brazoDelKey] ? brazoDelKey : 'brazo_delantero_reposo') : '';
      const brazoImg = brazoUseKey ? imgs[brazoUseKey] : null;
      if (brazoImg || manoImg || cfg.propImg) {
        const ajBrTot = combinarAjustesPiro(ajCapas.brazo, parsearAjustePiezaPiro(personaje, brazoUseKey));
        const ajManoTot = combinarAjustesPiro(ajCapas.mano, parsearAjustePiezaPiro(personaje, manoKey));
        ctx.save();
        aplicarTransformAjuste(ctx, ajBrTot, ptHombro.x, ptHombro.y);
        ctx.translate(ptHombro.x, ptHombro.y);
        ctx.rotate((rotBrazo * Math.PI) / 180);
        if (brazoImg) {
          ctx.drawImage(brazoImg, -ptHombro.x, -ptHombro.y, 1000, 1600);
          capasDibujadas++;
        }
        const mostrarManoExtra = Boolean(manoImg && (!brazoImg || cfg.forzarManoSuelta));
        if (mostrarManoExtra || cfg.propImg) {
          ctx.translate(ptMano.x - ptHombro.x, ptMano.y - ptHombro.y);
          ctx.rotate((rotMano * Math.PI) / 180);
          ctx.save();
          aplicarTransformAjuste(ctx, ajManoTot, 0, 0);
          if (mostrarManoExtra) { ctx.drawImage(manoImg, -ptMano.x, -ptMano.y, 1000, 1600); capasDibujadas++; }
          if (cfg.propImg) {
            const propSize = Number(cfg.propSize) || 230;
            ctx.drawImage(cfg.propImg, -propSize / 2, -propSize / 2, propSize, propSize);
            capasDibujadas++;
          }
          ctx.restore();
        }
        ctx.restore();
      }
    }
    if (accZona === 'frente' && imgs[accKey]) {
      ctx.save(); aplicarTransformAjuste(ctx, ajAccTot, ptMano.x, ptMano.y); ctx.drawImage(imgs[accKey], 0, 0, 1000, 1600); ctx.restore(); capasDibujadas++;
    }
  } else if (imgs.maestro_cuerpo) {
    drawP(imgs.maestro_cuerpo);
  } else if (imgs.maestro_perfil) {
    drawP(imgs.maestro_perfil);
  }

  if (cfg.mostrarGuias) {
    ctx.save();
    ctx.strokeStyle = 'rgba(34,197,94,0.75)';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.beginPath(); ctx.moveTo(0, 1480); ctx.lineTo(1000, 1480); ctx.stroke();
    ctx.setLineDash([]);
        Object.keys(piv).forEach(function(k) {
      if (!piv[k].marcado) return;
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath(); ctx.arc(piv[k].x, piv[k].y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    });
    const mCabG = moldes[cabezaKey];
    if (mCabG && mCabG.zonas) {
      Object.keys(mCabG.zonas).forEach(function(zk) {
        const z = mCabG.zonas[zk];
        if (!z) return;
        if (z.caja && z.caja.w > 4 && z.caja.h > 4) {
          ctx.strokeStyle = zk === 'ojos' ? 'rgba(56,189,248,0.85)' : (zk === 'boca' ? 'rgba(250,204,21,0.85)' : 'rgba(192,132,252,0.85)');
          ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
          ctx.strokeRect(z.caja.x, z.caja.y, z.caja.w, z.caja.h);
          ctx.setLineDash([]);
        }
        if (Array.isArray(z.puntos)) {
          ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3;
          z.puntos.forEach(function(pt) {
            ctx.beginPath();
            ctx.moveTo(pt.x - 8, pt.y - 8); ctx.lineTo(pt.x + 8, pt.y + 8);
            ctx.moveTo(pt.x + 8, pt.y - 8); ctx.lineTo(pt.x - 8, pt.y + 8);
            ctx.stroke();
          });
        }
      });
    }
    ctx.restore();
  }

  ctx.restore();
  return capasDibujadas;
}

function dibujarSubtituloPiro(ctx, texto, W, H, esH) {
  if (!texto || !String(texto).trim()) return;
  const maxChars = esH ? 46 : 26;
  const palabras = String(texto).trim().split(/\s+/);
  const lineas = [];
  let act = '';
  palabras.forEach(function(w) {
    if ((act + ' ' + w).trim().length > maxChars) { if (act) lineas.push(act); act = w; }
    else act = (act + ' ' + w).trim();
  });
  if (act) lineas.push(act);
  const visibles = lineas.slice(0, esH ? 2 : 3);
  ctx.save();
  ctx.font = esH ? '900 28px system-ui, sans-serif' : '900 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.92)';
  ctx.fillStyle = '#ffffff';
  const yBase = (esH ? (H - 58) : 710) - (visibles.length - 1) * 30;
  visibles.forEach(function(l, i) {
    ctx.strokeText(l, W / 2, yBase + i * 32);
    ctx.fillText(l, W / 2, yBase + i * 32);
  });
  ctx.restore();
}

/**
 * Compone una escena completa (Fondo -> Múltiples Actores + Props en mano -> Frente -> FX -> Subtítulo -> Safe Zones).
 */
export function evaluarEpisodioEnTiempoPiro(episodio, biblioteca, tSeg, opts) {
  const g = episodio || {}, bib = biblioteca || {}, o = opts || {};
  const escenas = Array.isArray(g.escenas) ? g.escenas : [];
  if (!escenas.length) return null;
  const t = Math.max(0, Number(tSeg) || 0);
  let acum = 0, clipIdx = escenas.length - 1;
  const inicios = new Array(escenas.length);
  for (let i = 0; i < escenas.length; i++) {
    inicios[i] = acum;
    const d = Math.max(0.5, Number(escenas[i].duracion) || 3);
    if (t < acum + d) { clipIdx = i; break; }
    acum += d;
  }
  const scVis = escenas[clipIdx];
  const tLocVis = Math.max(0, t - inicios[clipIdx]);
  let audIdx = clipIdx;
  if (scVis.continuar_audio && !scVis.audio_url) {
    let j = clipIdx - 1;
    while (j >= 0) {
      if (escenas[j].audio_url || !escenas[j].continuar_audio) { audIdx = j; break; }
      j--;
    }
  }
  const scAud = escenas[audIdx] || scVis;
  const tLocAud = Math.max(0, t - inicios[audIdx]);
  let durSpanAud = Math.max(0.5, Number(scAud.duracion) || 3);
  for (let k = audIdx + 1; k < escenas.length; k++) {
    if (escenas[k].continuar_audio && !escenas[k].audio_url) durSpanAud += Math.max(0.5, Number(escenas[k].duracion) || 3);
    else break;
  }
  const habId = scAud.hablante !== undefined ? scAud.hablante : scAud.actor;
  const perHab = (bib.personajes || []).find(function(x) { return x.id === habId; }) || null;
  const actsVis = normalizarActoresEscena(scVis);
  const aHab = actsVis.find(function(a) { return a.id === habId; }) || actsVis[0] || null;
  const env = (o.envolventesPorIdx && o.envolventesPorIdx[audIdx]) || o.envolventeActiva || null;
  const modoLS = o.modoLipSync || (g.modo_lipsync === 'volumen' ? 'volumen' : 'visemas');
  const durAudRef = (env && env.duracion > 0.2) ? env.duracion : Math.min(durSpanAud, Math.max(0.5, Number(scAud.duracion) || 3));
  let boca = 'boca_cerrada';
  if (habId && habId !== 'ninguno' && tLocAud <= durSpanAud + 0.05) {
    boca = obtenerBocaLipSyncPiro({ modo: modoLS, tiempoLocal: tLocAud, envolvente: env, marcas: scAud.marcas_voz, visemas: scAud.visemas, texto: scAud.texto || '', duracion: durAudRef, personaje: perHab, cabezaKey: aHab ? aHab.cabeza : 'cabeza_base' });
  }
  const subTxt = (scVis.texto && String(scVis.texto).trim()) ? scVis.texto : (scAud.texto || '');
  return { clipIdx: clipIdx, clipVisual: scVis, tLocalVisual: tLocVis, clipAudioIdx: audIdx, clipAudio: scAud, audioInicioSeg: inicios[audIdx], durSpanAudio: durSpanAud, tLocalAudio: tLocAud, hablanteId: habId, bocaHablante: boca, hablandoAhora: Boolean(habId && habId !== 'ninguno' && boca !== 'boca_cerrada'), subtitulo: subTxt };
}

export async function precargarRecursosEpisodioPiro(episodio, biblioteca, opts) {
  const reqMap = new Map();
  const optMap = new Map();
  const g = episodio || {}, bib = biblioteca || {};
  const corsOpt = { strictCors: Boolean(opts && opts.strictCors) };
  const addReq = function(u, lbl) { if (u && typeof u === 'string' && u.length > 5 && !reqMap.has(u)) reqMap.set(u, lbl || u); };
  const addOpt = function(u, lbl) { if (u && typeof u === 'string' && u.length > 5 && !reqMap.has(u) && !optMap.has(u)) optMap.set(u, lbl || u); };
  (g.escenas || []).forEach(function(sc, scIdx) {
    if (sc.modo === 'plano' && sc.plano_url) { addReq(sc.plano_url, 'Plano clip #' + (scIdx + 1)); return; }
    const escObj = (bib.escenarios || []).find(function(e) { return e.id === (sc.escenario || g.escenario_id); }) || (bib.escenarios || [])[0];
    const zObj = escObj ? ((escObj.zonas || []).find(function(z) { return z.id === (sc.zona || g.zona_id); }) || (escObj.zonas || [])[0]) : null;
    if (zObj) {
      if (zObj.z1_lejano && zObj.z1_lejano.url) addOpt(zObj.z1_lejano.url, 'Fondo Z1');
      if (zObj.z2_medio && zObj.z2_medio.url) addReq(zObj.z2_medio.url, 'Fondo Z2');
      else if (zObj.fondo && zObj.fondo.url) addReq(zObj.fondo.url, 'Fondo Escenario');
      if (zObj.z4_frente && zObj.z4_frente.url) addOpt(zObj.z4_frente.url, 'Frente Z4');
      else if (zObj.frente && zObj.frente.url) addOpt(zObj.frente.url, 'Frente');
      (zObj.elementos_vivos || []).forEach(function(ev) { if (ev && ev.url) addOpt(ev.url, 'Elem vivo'); });
    }
    if (sc.prop && String(sc.prop).indexOf('fx_') === 0) {
      const fx = (bib.props || []).find(function(x) { return x.id === sc.prop; });
      if (fx && fx.archivo && fx.archivo.url) addOpt(fx.archivo.url, 'FX ' + sc.prop);
    }
    const evs = Array.isArray(sc.eventos_actuacion) ? sc.eventos_actuacion : [];
    normalizarActoresEscena(sc).forEach(function(a) {
      const per = (bib.personajes || []).find(function(p) { return p.id === a.id; });
      if (per && per.piezas) {
        const pzs = per.piezas;
        const addPz = function(k, esReq) { const u = k && pzs[k] && pzs[k].url; if (!u) return; if (esReq) addReq(u, per.nombre + ':' + k); else addOpt(u, per.nombre + ':' + k); };
        const ang = resolverAngulo360Piro(a.angulo || sc.angulo);
        const cabK = (ang && ang.cabeza) ? ang.cabeza : (a.cabeza || 'cabeza_base');
        const cueK = resolverCuerpoPiro(per, a.cuerpo, ang);
        addPz(cabK, true); addPz(cueK, true); addPz('cabeza_base', false); addPz('cuerpo_base', false);
        const modBr = resolverModoBrazosPiro(per, a.brazo, a.brazoTras, Boolean(a.prop));
        if (modBr.brazoDel === 'articulado') { addPz('brazo_del_sup', true); addPz('brazo_del_ant', true); addPz('mano_relajada', false); }
        else if (modBr.brazoDel !== 'ninguno') { addPz(modBr.brazoDel, true); }
        if (modBr.brazoTras === 'articulado') { addPz('brazo_tras_sup', true); addPz('brazo_tras_ant', true); addPz('mano_trasera', false); if (per.mano_trasera_ref) addPz(per.mano_trasera_ref, false); }
        else if (modBr.brazoTras !== 'ninguno') { addPz(modBr.brazoTras, false); }
        if (a.mano) addPz(String(a.mano).indexOf('mano_') === 0 ? a.mano : ('mano_' + a.mano), false);
        if (a.acc) addPz(a.acc, true);
        const rO = resolverPiezaPerspectiva(per, 'ojos', a.ojos, cabK, { soloPerspectiva: false }); if (rO && rO.url) addReq(rO.url, per.nombre + ':' + rO.key);
        const rOC = resolverPiezaPerspectiva(per, 'ojos', 'ojos_cerrados', cabK, { soloPerspectiva: true, sinFallbackDefault: true }); if (rOC && rOC.url) addOpt(rOC.url, per.nombre + ':' + rOC.key);
        if (a.cejas) { const rC = resolverPiezaPerspectiva(per, 'cejas', a.cejas, cabK, { soloPerspectiva: false }); if (rC && rC.url) addOpt(rC.url, per.nombre + ':' + rC.key); }
        Object.keys(pzs).forEach(function(k) { if (k.indexOf('boca_') === 0 || k.indexOf('cejas_') === 0) addPz(k, false); });
        const actDef = ACTUACIONES_PIRO[a.actuacion || sc.actuacion];
        if (actDef && actDef.mano) addPz(actDef.mano, false);
        if (actDef && actDef.ojos) { const rAO = resolverPiezaPerspectiva(per, 'ojos', actDef.ojos, cabK, { soloPerspectiva: false }); if (rAO && rAO.url) addOpt(rAO.url, per.nombre + ':' + rAO.key); }
        evs.forEach(function(ev) {
          if (!ev || (ev.actorId && ev.actorId !== a.id)) return;
          if (ev.cabeza) addPz(ev.cabeza, false);
          if (ev.angulo && ANGULOS_360_PIRO[ev.angulo]) { addPz(ANGULOS_360_PIRO[ev.angulo].cabeza, false); addPz(ANGULOS_360_PIRO[ev.angulo].cuerpo, false); }
          if (ev.mano) addPz(ev.mano, false);
          if (ev.ojos) { const rEO = resolverPiezaPerspectiva(per, 'ojos', ev.ojos, ev.cabeza || cabK, { soloPerspectiva: false }); if (rEO && rEO.url) addOpt(rEO.url, per.nombre + ':' + rEO.key); }
        });
      }
      if (a.prop) {
        const pr = (bib.props || []).find(function(x) { return x.id === a.prop; });
        if (pr && pr.archivo && pr.archivo.url) addReq(pr.archivo.url, 'Prop ' + a.prop);
      }
    });
  });
  const listaReq = Array.from(reqMap.entries());
  const listaOpt = Array.from(optMap.entries());
  const todas = listaReq.map(function(e) { return { u: e[0], lbl: e[1], req: true }; }).concat(listaOpt.map(function(e) { return { u: e[0], lbl: e[1], req: false }; }));
  let ok = 0, fail = 0, obligatoriosFail = 0; const faltantes = [];
  for (let i = 0; i < todas.length; i += 6) {
    const lote = todas.slice(i, i + 6);
    const res = await Promise.all(lote.map(function(it) { return cargarImagenPiro(it.u, corsOpt); }));
    res.forEach(function(im, j) {
      if (im) ok++;
      else { fail++; if (lote[j].req) obligatoriosFail++; faltantes.push(lote[j].lbl); }
    });
  }
  return { total: todas.length, ok: ok, fail: fail, obligatoriosFail: obligatoriosFail, faltantes: faltantes };
}

export async function componerEscenaPiro(ctx, params) {
  const sc = params.escena;
  const g = params.episodio || {};
  const bib = params.biblioteca || {};
  const esH = Boolean(params.esHorizontal);
  const W = esH ? 960 : 540;
  const H = esH ? 540 : 960;
  const WOut = Number(params.ancho) || W;
  const HOut = Number(params.alto) || H;

  ctx.save();
  if (WOut !== W || HOut !== H) ctx.scale(WOut / W, HOut / H);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  if (!sc) {
    ctx.fillStyle = '#64748b'; ctx.font = '700 18px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Sin escenas en el timeline', W / 2, H / 2);
    ctx.restore();
    return;
  }

  if (sc.modo === 'plano' && sc.plano_url) {
      const imPlano = await cargarImagenPiro(sc.plano_url, { strictCors: Boolean(params.modoExportacion) });
    if (imPlano) {
      const r = Math.max(W / imPlano.width, H / imPlano.height);
      const dw = imPlano.width * r, dh = imPlano.height * r;
      ctx.drawImage(imPlano, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
  } else {
    const escList = bib.escenarios || [];
    const escObj = escList.find(function(e) { return e.id === (sc.escenario || g.escenario_id); }) || escList[0];
    const zObj = escObj ? ((escObj.zonas || []).find(function(z) { return z.id === (sc.zona || g.zona_id); }) || (escObj.zonas || [])[0]) : null;
        const corsOpt = { strictCors: Boolean(params.modoExportacion) };
    const imZ1 = zObj && zObj.z1_lejano ? await cargarImagenPiro(zObj.z1_lejano.url, corsOpt) : null;
    const imFondo = zObj && ((zObj.z2_medio && zObj.z2_medio.url) ? zObj.z2_medio : zObj.fondo) ? await cargarImagenPiro((zObj.z2_medio && zObj.z2_medio.url) ? zObj.z2_medio.url : zObj.fondo.url, corsOpt) : null;
    const imFrente = zObj && ((zObj.z4_frente && zObj.z4_frente.url) ? zObj.z4_frente : zObj.frente) ? await cargarImagenPiro((zObj.z4_frente && zObj.z4_frente.url) ? zObj.z4_frente.url : zObj.frente.url, corsOpt) : null;
    const vivosZ = (zObj && Array.isArray(zObj.elementos_vivos)) ? zObj.elementos_vivos : [];
    const tEsc = Number(params.tiempoLocal) || 0;
    const cam25 = calcularCamara25DPiro(sc, tEsc, esH);

    const zoom = cam25.zoom;
    const panX = cam25.panX; const _panLegacy = esH
      ? (sc.camara === 'izq' ? 75 : (sc.camara === 'der' ? -75 : 0))
      : (sc.camara === 'izq' ? 140 : (sc.camara === 'der' ? -140 : 0));
    const bgSize = 960 * zoom;

    if (imZ1) { const bgZ1 = bgSize * 1.06; ctx.drawImage(imZ1, (W - bgZ1) / 2 + panX * 0.2, (H - bgZ1) / 2, bgZ1, bgZ1); }
    await dibujarElementosVivosPiro(ctx, vivosZ, 'z1', W, H, panX, zoom, tEsc, corsOpt);
    if (imFondo) ctx.drawImage(imFondo, (W - bgSize) / 2 + panX * 0.55, (H - bgSize) / 2, bgSize, bgSize);
    await dibujarElementosVivosPiro(ctx, vivosZ, 'z2', W, H, panX, zoom, tEsc, corsOpt);

    const actores = normalizarActoresEscena(sc);
    const hablanteId = params.hablanteActivoId !== undefined
      ? params.hablanteActivoId
      : (sc.hablante !== undefined ? sc.hablante : sc.actor);
    const bocaActiva = params.bocaHablante || 'boca_cerrada';
    const propsBib = bib.props || [];

    for (let i = 0; i < actores.length; i++) {
      const a = actores[i];
      const per = (bib.personajes || []).find(function(p) { return p.id === a.id; });
      if (!per) continue;

      const xBase = esH
        ? (a.posicion === 'izq' ? 275 : (a.posicion === 'der' ? 685 : 480))
        : (a.posicion === 'izq' ? 155 : (a.posicion === 'der' ? 385 : 270));
      const yBase = esH ? 315 : 530;
      const flip = a.posicion === 'der';
      const scPer = (esH ? 0.31 : 0.44) * zoom * (a.escala || 1);

      let propImg = null;
      if (a.prop) {
        const prObj = propsBib.find(function(x) { return x.id === a.prop; });
                if (prObj && prObj.archivo && prObj.archivo.url) propImg = await cargarImagenPiro(prObj.archivo.url, corsOpt);
      }

            const estaHablando = Boolean(hablanteId && hablanteId !== 'ninguno' && a.id === hablanteId);
      const anim = evaluarAnimacionActorPiro(a, sc, tEsc, estaHablando, per);
      let vecOtro = null;
      if (actores.length > 1) {
        const otroA = actores.find(function(x) { return x.id !== a.id; }) || null;
        if (otroA) {
          const ox = esH ? (otroA.posicion === 'izq' ? 275 : (otroA.posicion === 'der' ? 685 : 480)) : (otroA.posicion === 'izq' ? 155 : (otroA.posicion === 'der' ? 385 : 270));
          const dxRaw = (ox - xBase) * (flip ? -1 : 1);
          vecOtro = { x: Math.max(-0.78, Math.min(0.78, dxRaw / (esH ? 340 : 210))), y: 0 };
        }
      }
      const miradaVec = evaluarMiradaActorPiro(a, sc, tEsc, vecOtro, (sc.id || 'sc') + '_' + a.id);
      const bocaFinal = estaHablando ? bocaActiva : (anim.bocaDef || a.boca || 'boca_cerrada');

      await dibujarMarionetaPiro(ctx, per, {
        cabeza: anim.cabeza || 'cabeza_base',
        cuerpo: a.cuerpo || 'cuerpo_base',
        ojos: anim.ojos || 'neutro',
        miradaVec: miradaVec,
        angulo360: anim.angulo || a.angulo || sc.angulo || '',
        cejas: anim.cejas || a.cejas || '',
        cejasOffsetY: anim.cejasOffsetY || 0,
        boca: bocaFinal,
                brazoDel: resolverModoBrazosPiro(per, a.brazo, a.brazoTras, Boolean(propImg)).brazoDel,
        brazoTras: resolverModoBrazosPiro(per, a.brazo, a.brazoTras, Boolean(propImg)).brazoTras,
        mano: anim.mano || '',
        forzarManoSuelta: Boolean(a.mano),
        acc: a.acc || '',
        rotCab: anim.rotCab || 0,
        rotBrazo: anim.rotBrazo || 0,
        rotAntebrazo: anim.rotAntebrazo || 0,
        rotMano: anim.rotMano || 0,
        rotBrazoTras: anim.rotBrazoTras || 0,
        rotAntebrazoTras: anim.rotAntebrazoTras || 0,
        scaleX: anim.scaleX,
        scaleY: anim.scaleY,
        offsetY: anim.offsetY,
        propImg: propImg,
        x: xBase + panX * 0.45,
        y: yBase,
        scale: scPer,
        flipX: (function() { const ag = resolverAngulo360Piro(anim.angulo || a.angulo || sc.angulo); return ag ? Boolean(ag.flipAuto) : flip; })(),
        modoExportacion: Boolean(params.modoExportacion)
      });
    }

    if (imFrente) ctx.drawImage(imFrente, (W - bgSize) / 2 + panX * 1.32, (H - bgSize) / 2, bgSize, bgSize);
    await dibujarElementosVivosPiro(ctx, vivosZ, 'z4', W, H, panX, zoom, tEsc, corsOpt);

    // Ícono FX flotante (si el prop de escena es un fx_*)
    if (sc.prop && String(sc.prop).indexOf('fx_') === 0) {
      const fxObj = propsBib.find(function(x) { return x.id === sc.prop; });
      if (fxObj && fxObj.archivo && fxObj.archivo.url) {
                const imFx = await cargarImagenPiro(fxObj.archivo.url, corsOpt);
        if (imFx) ctx.drawImage(imFx, esH ? 710 : 330, esH ? 70 : 185, 130, 130);
      }
    }
  }

  const txtSub = params.subtituloOverride !== undefined ? params.subtituloOverride : (sc.texto || '');
  dibujarSubtituloPiro(ctx, txtSub, W, H, esH);

  if (params.safeZones) {
    ctx.save();
    if (esH) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)'; ctx.setLineDash([10, 8]);
      ctx.strokeRect(48, 28, W - 96, H - 56);
    } else {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
      ctx.fillRect(0, 768, 540, 192);
      ctx.fillRect(455, 420, 85, 348);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)'; ctx.setLineDash([8, 6]);
      ctx.strokeRect(10, 80, 440, 680);
    }
    ctx.restore();
  }
  ctx.restore();
}
