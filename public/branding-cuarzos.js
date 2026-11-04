/* Identidad compartida: oficina y catálogo. Sin red ni fuentes externas. */
window.CATALOGO_CUARZOS_GEOKATU = [
    { id: 'carbon', nombre: 'Ónix Carbón', dot: '#181820', bg: 'linear-gradient(145deg, rgba(28,28,36,0.92), rgba(12,12,16,0.95))', border: 'rgba(255,255,255,0.16)', text: '#ffffff', claro: false },
    { id: 'clasico', nombre: 'Cuarzo Clásico', dot: '#f8fafc', bg: 'linear-gradient(145deg, rgba(255,255,255,0.92), rgba(236,240,246,0.95))', border: 'rgba(0,0,0,0.18)', text: '#0f172a', claro: true },
    { id: 'pantera', nombre: 'Pantera Rosa', dot: '#ff69b4', bg: 'linear-gradient(145deg, rgba(255,105,180,0.32), rgba(46,14,34,0.90))', border: 'rgba(255,130,195,0.50)', text: '#ffffff', claro: false },
    { id: 'celeste', nombre: 'Azul Cielo', dot: '#38bdf8', bg: 'linear-gradient(145deg, rgba(56,189,248,0.32), rgba(12,34,58,0.90))', border: 'rgba(56,189,248,0.50)', text: '#ffffff', claro: false },
    { id: 'ambar', nombre: 'Ámbar Geokatu', dot: '#ff6b00', bg: 'linear-gradient(145deg, rgba(255,107,0,0.32), rgba(46,20,6,0.90))', border: 'rgba(255,140,0,0.50)', text: '#ffffff', claro: false },
    { id: 'esmeralda', nombre: 'Esmeralda', dot: '#10b981', bg: 'linear-gradient(145deg, rgba(16,185,129,0.32), rgba(8,40,30,0.90))', border: 'rgba(52,211,153,0.50)', text: '#ffffff', claro: false },
    { id: 'topacio', nombre: 'Topacio Real', dot: '#facc15', bg: 'linear-gradient(145deg, rgba(250,204,21,0.30), rgba(48,38,8,0.90))', border: 'rgba(250,204,21,0.50)', text: '#ffffff', claro: false },
    { id: 'rubi', nombre: 'Rubí Carmesí', dot: '#f43f5e', bg: 'linear-gradient(145deg, rgba(244,63,94,0.32), rgba(48,10,20,0.90))', border: 'rgba(251,113,133,0.50)', text: '#ffffff', claro: false },
    { id: 'amatista', nombre: 'Amatista', dot: '#a855f7', bg: 'linear-gradient(145deg, rgba(168,85,247,0.32), rgba(32,12,52,0.90))', border: 'rgba(192,132,252,0.50)', text: '#ffffff', claro: false }
];

window.obtenerEstiloCuarzo = function(temaRaw) {
    var t = String(temaRaw || 'carbon').trim();
    if (t.indexOf('custom:') === 0) {
        var hex = t.replace('custom:', '').trim();
        if (!/^#[0-9a-f]{6}$/i.test(hex)) hex = '#ff6b00';
        var clean = hex.replace('#', '');
        var r = parseInt(clean.substring(0, 2), 16);
        var g = parseInt(clean.substring(2, 4), 16);
        var b = parseInt(clean.substring(4, 6), 16);
        return {
            id: t,
            nombre: 'Cuarzo Propio',
            dot: hex,
            bg: 'linear-gradient(145deg, rgba(' + r + ',' + g + ',' + b + ',0.34), rgba(' + Math.round(r * 0.16) + ',' + Math.round(g * 0.16) + ',' + Math.round(b * 0.16) + ',0.92))',
            border: 'rgba(' + r + ',' + g + ',' + b + ',0.55)',
            text: '#ffffff',
            claro: false
        };
    }
    var encontrado = window.CATALOGO_CUARZOS_GEOKATU.find(function(x) { return x.id === t; });
    return encontrado || window.CATALOGO_CUARZOS_GEOKATU[0];
};

window.GeokatuBranding = {
    aplicar: function(root, datos) {
        var tema = window.obtenerEstiloCuarzo(datos.tema_popup);
        root.style.setProperty('--catalogo-fondo', tema.bg);
        root.style.setProperty('--catalogo-texto', tema.text);
        root.style.setProperty('--catalogo-suave', tema.claro ? '#526078' : '#b7becb');
        root.style.setProperty('--catalogo-superficie', tema.claro ? '#ffffff' : 'rgba(20,22,29,0.94)');
        root.style.setProperty('--catalogo-borde', tema.claro ? '#d5dbe5' : 'rgba(255,255,255,0.13)');
        root.dataset.temaClaro = String(tema.claro);
        root.dataset.placaNombre = ['clara','oscura'].includes(datos.placa_nombre) ? datos.placa_nombre : 'ninguna';
        root.style.setProperty('--placa-fondo', datos.placa_nombre === 'clara' ? '#ffffff' : datos.placa_nombre === 'oscura' ? '#14161d' : 'transparent');
        root.style.setProperty('--placa-padding', ['clara','oscura'].includes(datos.placa_nombre) ? '8px 13px' : '0px');
        var posicion = Number(datos.portada_posicion);
        root.style.setProperty('--portada-posicion', (Number.isFinite(posicion) ? Math.max(0, Math.min(100, posicion)) : 50) + '%');
    }
};
