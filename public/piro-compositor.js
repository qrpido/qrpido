/**
 * PIRO-COMPOSITOR 2D · Motor Unificado de Composición (Probador + Timeline)
 * Soporta marionetas modulares 1000x1600 con pivotes, prop anclado a mano,
 * múltiples actores simultáneos en plano, L-cuts y lip-sync por envolvente real.
 */

const _imgCache = {};
const _envCache = {};
let _audioCtx = null;

export const PIVOTES_DEFAULT = {
  cuello: { x: 500, y: 480 },
  hombro_trasero: { x: 555, y: 560 },
  codo_trasero: { x: 605, y: 710 },
  hombro_delantero: { x: 440, y: 560 },
  codo_delantero: { x: 420, y: 720 },
  mano_delantera: { x: 640, y: 820 },
  cadera_delantera: { x: 465, y: 920 },
  cadera_trasera: { x: 535, y: 920 }
};

export function cargarImagenPiro(url) {
  return new Promise(function(resolve) {
    if (!url) { resolve(null); return; }
    if (_imgCache[url]) { resolve(_imgCache[url]); return; }
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = function() { _imgCache[url] = im; resolve(im); };
    im.onerror = function() {
      // Reintento sin crossOrigin solo para vista previa si el servidor no devuelve CORS
      const im2 = new Image();
      im2.onload = function() { _imgCache[url] = im2; resolve(im2); };
      im2.onerror = function() { resolve(null); };
      im2.src = url;
    };
    im.src = url;
  });
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
    return res;
}

export function obtenerPerspectivaCabeza(cabezaKey) {
  const k = String(cabezaKey || 'cabeza_base');
  if (k === 'cabeza_frente') return 'frente';
  if (k === 'cabeza_perfil') return 'perfil';
  return '3_4';
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
  const pref = grupo === 'ojos' ? 'ojos_' : 'boca_';
  const defBase = grupo === 'ojos' ? 'ojos_neutro' : 'boca_cerrada';
  const rawStr = String(claveSolicitada || defBase);
  const sinPref = rawStr.indexOf(pref) === 0 ? rawStr.slice(pref.length) : rawStr;
  const exprLimpia = sinPref.replace(/^(frente|perfil)_/, '') || (grupo === 'ojos' ? 'neutro' : 'cerrada');
  const claveExacta = persp === '3_4' ? (pref + exprLimpia) : (pref + persp + '_' + exprLimpia);
  const claveDefaultPersp = persp === '3_4' ? defBase : (pref + persp + '_' + (grupo === 'ojos' ? 'neutro' : 'cerrada'));

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
  const zSrc = moldes.cabeza_base && moldes.cabeza_base.zonas && moldes.cabeza_base.zonas[grupo] ? moldes.cabeza_base.zonas[grupo].caja : null;
  const zDst = moldes[cabezaKey] && moldes[cabezaKey].zonas && moldes[cabezaKey].zonas[grupo] ? moldes[cabezaKey].zonas[grupo].caja : null;
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
  if (_envCache[key]) return _envCache[key];
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!_audioCtx) _audioCtx = new AC();
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
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
    _envCache[key] = env;
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
        brazoTras: String(a.brazoTras || 'brazo_trasero_reposo'),
        mano: String(a.mano || ''),
        rotCab: Number(a.rotCab) || 0,
        rotBrazo: Number(a.rotBrazo) || 0,
        rotAntebrazo: Number(a.rotAntebrazo) || 0,
        rotMano: Number(a.rotMano) || 0,
        rotBrazoTras: Number(a.rotBrazoTras) || 0,
        prop: String(a.prop || ''),
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

      const cabezaKey = cfg.cabeza || 'cabeza_base';
  const cuerpoKey = cfg.cuerpo || 'cuerpo_base';
  const moldes = parsearMoldes(personaje);
  const resOjos = resolverPiezaPerspectiva(personaje, 'ojos', cfg.ojos, cabezaKey, { soloPerspectiva: Boolean(cfg.soloPerspectiva), sinFallbackDefault: Boolean(cfg.soloPerspectiva) });
  const resBoca = resolverPiezaPerspectiva(personaje, 'boca', cfg.boca, cabezaKey, { soloPerspectiva: Boolean(cfg.soloPerspectiva), adaptarBocas: cfg.adaptarBocas === true, sinFallbackDefault: Boolean(cfg.soloPerspectiva) });
  const ojosKey = resOjos.url ? resOjos.key : 'ninguno';
  const bocaKey = resBoca.url ? resBoca.key : 'ninguno';
  const brazoDelKey = cfg.brazoDel || (cfg.propImg ? 'brazo_delantero_prop' : 'brazo_delantero_reposo');
  const brazoTrasKey = cfg.brazoTras || 'brazo_trasero_reposo';
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
    'cabeza_base', cabezaKey, ojosKey, bocaKey,
    'brazo_delantero_reposo', brazoDelKey, 'brazo_del_sup', 'brazo_del_ant', manoKey
  ];
  const imgs = {};
  await Promise.all(claves.map(async function(k) {
    if (k && k !== 'ninguno' && k !== 'articulado' && !imgs[k]) {
      imgs[k] = await cargarImagenPiro(piezas[k] ? piezas[k].url : null);
    }
  }));

  const cuerpoImg = imgs[cuerpoKey] || imgs.cuerpo_base;
  const cabezaImg = imgs[cabezaKey] || (cfg.soloPerspectiva ? null : imgs.cabeza_base);
  const ojosImg = resOjos.url ? imgs[resOjos.key] : null;
  const bocaImg = resBoca.url ? imgs[resBoca.key] : null;
  const tieneArtDel = Boolean(imgs.brazo_del_sup || imgs.brazo_del_ant);
  const tieneArtTras = Boolean(imgs.brazo_tras_sup || imgs.brazo_tras_ant);
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
        ctx.save();
        ctx.translate(ptHT.x, ptHT.y);
        ctx.rotate((rotBrazoTras * Math.PI) / 180);
        if (imgs.brazo_tras_sup) { ctx.drawImage(imgs.brazo_tras_sup, -ptHT.x, -ptHT.y, 1000, 1600); capasDibujadas++; }
        if (imgs.brazo_tras_ant) {
          const ptCT = piv.codo_trasero;
          ctx.translate(ptCT.x - ptHT.x, ptCT.y - ptHT.y);
          ctx.rotate((rotAntebrazoTras * Math.PI) / 180);
          ctx.drawImage(imgs.brazo_tras_ant, -ptCT.x, -ptCT.y, 1000, 1600);
          capasDibujadas++;
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
    if (cuerpoImg) {
      drawP(cuerpoImg);
    } else if (imgs.maestro_cuerpo && cfg.modoLienzoCompleto) {
      ctx.save(); ctx.globalAlpha = 0.42; drawP(imgs.maestro_cuerpo); ctx.restore();
    }

        const moldeCab = moldes[cabezaKey] || null;
    const ptCuello = (moldeCab && moldeCab.cuello && typeof moldeCab.cuello.x === 'number') ? moldeCab.cuello : piv.cuello;
    const drawRFacial = function(im, tf) {
      if (!im) return;
      if (!tf) { drawR(im, ptCuello, rotCab); return; }
      ctx.save();
      ctx.translate(ptCuello.x, ptCuello.y);
      ctx.rotate((rotCab * Math.PI) / 180);
      ctx.translate(tf.cxDst - ptCuello.x, tf.cyDst - ptCuello.y);
      ctx.scale(tf.scale, tf.scale);
      ctx.drawImage(im, -tf.cxSrc, -tf.cySrc, 1000, 1600);
      ctx.restore();
      capasDibujadas++;
    };
    drawR(cabezaImg, ptCuello, rotCab);
    drawRFacial(ojosImg, resOjos.transform);
    drawRFacial(bocaImg, resBoca.transform);

    const ptHombro = piv.hombro_delantero;
    const ptCodo = piv.codo_delantero;
    const ptMano = piv.mano_delantera;
    const manoImg = manoKey ? imgs[manoKey] : null;
    if (esOverlayDoble && imgs[brazoDelKey]) {
      drawP(imgs[brazoDelKey]);
    } else if (brazoDelKey === 'articulado' && (tieneArtDel || manoImg || cfg.propImg)) {
      ctx.save();
      ctx.translate(ptHombro.x, ptHombro.y);
      ctx.rotate((rotBrazo * Math.PI) / 180);
      if (imgs.brazo_del_sup) { ctx.drawImage(imgs.brazo_del_sup, -ptHombro.x, -ptHombro.y, 1000, 1600); capasDibujadas++; }
      ctx.translate(ptCodo.x - ptHombro.x, ptCodo.y - ptHombro.y);
      ctx.rotate((rotAntebrazo * Math.PI) / 180);
      if (imgs.brazo_del_ant) { ctx.drawImage(imgs.brazo_del_ant, -ptCodo.x, -ptCodo.y, 1000, 1600); capasDibujadas++; }
      if (manoImg || cfg.propImg) {
        ctx.translate(ptMano.x - ptCodo.x, ptMano.y - ptCodo.y);
        ctx.rotate((rotMano * Math.PI) / 180);
        if (manoImg) { ctx.drawImage(manoImg, -ptMano.x, -ptMano.y, 1000, 1600); capasDibujadas++; }
        if (cfg.propImg) {
          const propSize = Number(cfg.propSize) || 230;
          ctx.drawImage(cfg.propImg, -propSize / 2, -propSize / 2, propSize, propSize);
          capasDibujadas++;
        }
      }
      ctx.restore();
    } else {
      const brazoImg = (brazoDelKey !== 'ninguno') ? (imgs[brazoDelKey] || imgs.brazo_delantero_reposo) : null;
      if (brazoImg || manoImg || cfg.propImg) {
        ctx.save();
        ctx.translate(ptHombro.x, ptHombro.y);
        ctx.rotate((rotBrazo * Math.PI) / 180);
        if (brazoImg) {
          ctx.drawImage(brazoImg, -ptHombro.x, -ptHombro.y, 1000, 1600);
          capasDibujadas++;
        }
        if (manoImg || cfg.propImg) {
          ctx.translate(ptMano.x - ptHombro.x, ptMano.y - ptHombro.y);
          ctx.rotate((rotMano * Math.PI) / 180);
          if (manoImg) { ctx.drawImage(manoImg, -ptMano.x, -ptMano.y, 1000, 1600); capasDibujadas++; }
          if (cfg.propImg) {
            const propSize = Number(cfg.propSize) || 230;
            ctx.drawImage(cfg.propImg, -propSize / 2, -propSize / 2, propSize, propSize);
            capasDibujadas++;
          }
        }
        ctx.restore();
      }
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
export async function componerEscenaPiro(ctx, params) {
  const sc = params.escena;
  const g = params.episodio || {};
  const bib = params.biblioteca || {};
  const esH = Boolean(params.esHorizontal);
  const W = Number(params.ancho) || (esH ? 960 : 540);
  const H = Number(params.alto) || (esH ? 540 : 960);

  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  if (!sc) {
    ctx.fillStyle = '#64748b'; ctx.font = '700 18px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Sin escenas en el timeline', W / 2, H / 2);
    return;
  }

  if (sc.modo === 'plano' && sc.plano_url) {
    const imPlano = await cargarImagenPiro(sc.plano_url);
    if (imPlano) {
      const r = Math.max(W / imPlano.width, H / imPlano.height);
      const dw = imPlano.width * r, dh = imPlano.height * r;
      ctx.drawImage(imPlano, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
  } else {
    const escList = bib.escenarios || [];
    const escObj = escList.find(function(e) { return e.id === (sc.escenario || g.escenario_id); }) || escList[0];
    const zObj = escObj ? ((escObj.zonas || []).find(function(z) { return z.id === (sc.zona || g.zona_id); }) || (escObj.zonas || [])[0]) : null;
    const imFondo = zObj && zObj.fondo ? await cargarImagenPiro(zObj.fondo.url) : null;
    const imFrente = zObj && zObj.frente ? await cargarImagenPiro(zObj.frente.url) : null;

    const zoom = sc.camara === 'zoom_actor' ? 1.18 : (sc.camara === 'plano_general' ? 0.92 : 1.0);
    const panX = esH
      ? (sc.camara === 'izq' ? 75 : (sc.camara === 'der' ? -75 : 0))
      : (sc.camara === 'izq' ? 140 : (sc.camara === 'der' ? -140 : 0));
    const bgSize = 960 * zoom;

    if (imFondo) ctx.drawImage(imFondo, (W - bgSize) / 2 + panX, (H - bgSize) / 2, bgSize, bgSize);

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
        if (prObj && prObj.archivo && prObj.archivo.url) propImg = await cargarImagenPiro(prObj.archivo.url);
      }

      const estaHablando = Boolean(hablanteId && hablanteId !== 'ninguno' && a.id === hablanteId);
      const bocaFinal = estaHablando ? bocaActiva : (a.boca || 'boca_cerrada');

              await dibujarMarionetaPiro(ctx, per, {
          cabeza: a.cabeza || 'cabeza_base',
          cuerpo: a.cuerpo || 'cuerpo_base',
          ojos: a.ojos || 'neutro',
          boca: bocaFinal,
          brazoDel: a.brazo || (propImg ? 'brazo_delantero_prop' : 'brazo_delantero_reposo'),
          brazoTras: a.brazoTras || 'brazo_trasero_reposo',
          mano: a.mano || '',
          rotCab: a.rotCab || 0,
          rotBrazo: a.rotBrazo || 0,
          rotAntebrazo: a.rotAntebrazo || 0,
          rotMano: a.rotMano || 0,
          rotBrazoTras: a.rotBrazoTras || 0,
          propImg: propImg,
        x: xBase + panX * 0.45,
        y: yBase,
        scale: scPer,
        flipX: flip
      });
    }

    if (imFrente) ctx.drawImage(imFrente, (W - bgSize) / 2 + panX, (H - bgSize) / 2, bgSize, bgSize);

    // Ícono FX flotante (si el prop de escena es un fx_*)
    if (sc.prop && String(sc.prop).indexOf('fx_') === 0) {
      const fxObj = propsBib.find(function(x) { return x.id === sc.prop; });
      if (fxObj && fxObj.archivo && fxObj.archivo.url) {
        const imFx = await cargarImagenPiro(fxObj.archivo.url);
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
}
