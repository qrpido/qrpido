/**
 * GEOKATU · Estudio Universal 3.0 — autónomo, local y sin dependencias.
 * Sustituye exclusivamente estudio-imagen-universal.js.
 * API compatible: editarImagen(Blob|File|URL, opciones) -> Promise<{blob,dataUrl,width,height,rol}|null>.
 * Recorte por asas, relaciones reales, zoom/pan, ajustes reversibles y exportación con alfa.
 */
(function (window) {
    'use strict';
    var doc = window.document;
    var root, canvas, ctx, view, stage, cropBox, original, config, resolveActive;
    var ready = false, busy = false, session = 0, panel = 'crop', crop = null, ratio = 0;
    var past = [], future = [], preview = null, raf = 0, gesture = null, points = new Map();
    var zoom = 1, panX = 0, panY = 0, fit = 1, comparing = false;
    var previousFocus, previousOverflow, sourceURL = '', resizeObserver;
    var MAX_HISTORY_BYTES = 48 * 1024 * 1024;
    var labels = { crop: 'Recortar', varita: 'Fondo', color: 'Color', nitidez: 'Detalle', suavizado: 'Bordes', transformar: 'Girar' };
    var icons = { crop:'M6 3v15h15M3 6h15v15', varita:'m4 20 12-12m-9-4 1 3m8-5v3m5 6h-3M3 12h3', color:'M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h3a5 5 0 0 0 0-10z', nitidez:'m12 3 9 18H3zM12 9v6', suavizado:'M12 3C9 8 5 11 5 15a7 7 0 0 0 14 0c0-4-4-7-7-12z', transformar:'M4 10a8 8 0 1 1 1 8M4 3v7h7' };
    function el(id) { return doc.getElementById('gk-est-' + id); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function svg(path) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>'; }
    function button(action, text, extra) { return '<button type="button" data-action="' + action + '" ' + (extra || '') + '>' + text + '</button>'; }
    function slider(id, label, min, max, value) {
        return '<label class="gku-slider"><span>' + label + '</span><input id="gk-est-' + id + '" type="range" min="' + min + '" max="' + max + '" value="' + value + '"><output id="gk-est-value-' + id + '">' + value + '%</output></label>';
    }
    function notify(text) { if (root) el('status').textContent = text; }
    function makeCanvas(w, h) { var c = doc.createElement('canvas'); c.width = w; c.height = h; return c; }
    function snapshot() { return ctx.getImageData(0, 0, canvas.width, canvas.height); }
    function put(data) { canvas.width = data.width; canvas.height = data.height; ctx.putImageData(data, 0, 0); }
    function controls() {
        el('undo').disabled = !ready || busy || (!past.length && !preview);
        el('redo').disabled = !ready || busy || !future.length || !!preview;
        el('save').disabled = !ready || busy;
        el('dimensions').textContent = ready ? canvas.width + ' × ' + canvas.height + ' px' : 'Cargando…';
    }
    function record(data) {
        past.push(data); future = [];
        var bytes = past.reduce(function (sum, s) { return sum + s.data.byteLength; }, 0);
        while (past.length > 1 && (past.length > 12 || bytes > MAX_HISTORY_BYTES)) bytes -= past.shift().data.byteLength;
        controls();
    }
    function resetSliders() {
        ['brightness', 'contrast', 'saturation', 'sharpness'].forEach(function (id) {
            el(id).value = id === 'sharpness' ? 0 : 100;
            el('value-' + id).textContent = el(id).value + '%';
        });
    }
    function cancelPreview() {
        if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
        if (preview) put(preview);
        preview = null; resetSliders(); controls();
    }
    function commitPreview() {
        if (!preview) return;
        if (raf) { window.cancelAnimationFrame(raf); raf = 0; renderPreview(); }
        var before = preview; preview = null; record(before); resetSliders();
    }
    function action(fn, message) {
        if (!ready || busy || comparing) return;
        commitPreview();
        var before = snapshot();
        try { if (fn() === false) return; record(before); if (canvas.width !== before.width || canvas.height !== before.height) { crop = null; resetView(); } else { layout(); controls(); } notify(message || 'Cambio aplicado. Puedes deshacerlo.'); }
        catch (e) { put(before); notify('No se pudo aplicar el cambio: ' + e.message); }
    }
    function init() {
        if (root) return;
        var style = doc.createElement('style'); style.id = 'gk-estudio-universal-css';
        style.textContent =
            '#gk-estudio-universal-root{--accent:#ffb26c;position:fixed;inset:0;z-index:1000100;display:none;flex-direction:column;background:#101216;color:#f4f4f5;font:13px/1.35 system-ui,-apple-system,sans-serif;isolation:isolate;overscroll-behavior:contain;color-scheme:dark;padding-top:env(safe-area-inset-top);box-sizing:border-box}' +
            '#gk-estudio-universal-root *{box-sizing:border-box}#gk-estudio-universal-root button,#gk-estudio-universal-root select{font:inherit;min-width:0;min-height:40px;border:1px solid #343941;border-radius:10px;background:#20252d;color:inherit;padding:7px 10px;cursor:pointer;touch-action:manipulation}#gk-estudio-universal-root button:disabled{opacity:.35;cursor:default}#gk-estudio-universal-root button:focus-visible,#gk-estudio-universal-root input:focus-visible,#gk-estudio-universal-root select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}#gk-estudio-universal-root button[aria-pressed=true]{background:#493122;color:#ffd5af;border-color:#b77f50}#gk-estudio-universal-root svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}#gk-estudio-universal-root .gku-primary{background:#f5b477;color:#23170c;border-color:#f5b477;font-weight:750}' +
            '.gku-top{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #2b3036;flex:none}.gku-heading{flex:1;min-width:0}.gku-heading strong{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gku-heading small{color:#a7b0bb;font-size:10px}.gku-top select{max-width:116px}.gku-actions{display:flex;justify-content:center;gap:7px;padding:6px 12px;flex:none}.gku-actions button{flex:1;max-width:160px;font-size:11px!important;display:flex;justify-content:center;align-items:center;gap:5px}' +
            '#gk-est-viewport{position:relative;flex:1;min-height:90px;overflow:hidden;touch-action:none;background-color:#161a20;background-image:conic-gradient(#232831 25%,transparent 0 50%,#232831 0 75%,transparent 0);background-size:18px 18px}#gk-est-stage{position:absolute;transform-origin:0 0}#gk-est-canvas{display:block;width:100%;height:100%;max-width:none;max-height:none;touch-action:none}#gk-est-crop{position:absolute;border:1px solid white;box-shadow:0 0 0 99999px #000a;touch-action:none;cursor:move}#gk-est-crop:before,#gk-est-crop:after{content:"";position:absolute;pointer-events:none}#gk-est-crop:before{inset:33.333% 0;border-top:1px solid #fffa;border-bottom:1px solid #fffa}#gk-est-crop:after{inset:0 33.333%;border-left:1px solid #fffa;border-right:1px solid #fffa}.gku-handle{position:absolute;width:36px;height:36px;border:0!important;background:transparent!important;padding:0!important;min-height:36px!important;border-radius:0!important;transform:translate(-50%,-50%);z-index:2}.gku-handle:after{content:"";position:absolute;inset:13px;border:2px solid white;background:#343a43;border-radius:2px}.gku-handle[data-h=nw]{left:0;top:0}.gku-handle[data-h=n]{left:50%;top:0}.gku-handle[data-h=ne]{left:100%;top:0}.gku-handle[data-h=e]{left:100%;top:50%}.gku-handle[data-h=se]{left:100%;top:100%}.gku-handle[data-h=s]{left:50%;top:100%}.gku-handle[data-h=sw]{left:0;top:100%}.gku-handle[data-h=w]{left:0;top:50%}' +
            '.gku-zoom{position:absolute;right:9px;bottom:9px;display:flex;gap:4px;z-index:3}.gku-zoom button{background:#101216e8!important;min-width:40px;font-size:12px!important}.gku-status{height:32px;padding:7px 12px;color:#b6bfc9;font-size:11px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:none;background:#15191e}.gku-panel{height:174px;padding:10px 14px;overflow-y:auto;overflow-x:hidden;flex:none;background:#171b21;border-top:1px solid #30353d}.gku-panel>section{max-width:680px;margin:auto}.gku-panel [hidden]{display:none!important}.gku-panel p{font-size:11px;color:#afb9c5;margin:0 0 10px}.gku-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.gku-grid button{font-size:11px!important;padding:5px!important}.gku-row{display:flex;gap:6px;margin-top:8px;align-items:center;flex-wrap:wrap}.gku-row>*{flex:1}.gku-slider{display:grid;grid-template-columns:74px minmax(0,1fr) 42px;gap:8px;align-items:center;min-height:39px;font-size:12px}.gku-slider input{width:100%;min-width:0;accent-color:#f5b477;touch-action:pan-y}.gku-slider output{text-align:right;color:#f5b477;font-variant-numeric:tabular-nums}.gku-check{display:flex;gap:8px;align-items:center;font-size:11px;margin:8px 0}.gku-check input{width:18px;height:18px;accent-color:#f5b477}' +
            '.gku-tools{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:#101216;flex:none;border-top:1px solid #30353d}.gku-tools button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:10px!important;padding:7px 2px!important;min-height:54px!important}.gku-loading{position:absolute;inset:0;display:grid;place-content:center;background:#101216dd;z-index:10;text-align:center}.gku-loading[hidden]{display:none}.gku-compare #gk-est-crop{visibility:hidden}.gku-close{font-size:18px!important}' +
            '@media(max-width:350px){.gku-tools{grid-template-columns:repeat(3,minmax(0,1fr))}.gku-tools button{flex-direction:row;min-height:38px!important}.gku-top{flex-wrap:wrap}.gku-top select{max-width:100px}.gku-panel{height:164px}.gku-slider{grid-template-columns:65px minmax(0,1fr) 35px;gap:5px}}@media(max-height:520px) and (min-width:550px){#gk-estudio-universal-root{padding-right:278px}.gku-panel{position:absolute;right:0;top:0;bottom:80px;width:278px;height:auto;padding-top:18px}.gku-tools{position:absolute;right:0;bottom:0;width:278px;grid-template-columns:repeat(3,minmax(0,1fr))}.gku-tools button{min-height:32px!important;flex-direction:row}.gku-status{height:28px}}@media(prefers-reduced-motion:no-preference){#gk-estudio-universal-root button{transition:background .12s,border-color .12s}}';
        doc.head.appendChild(style);
        root = doc.createElement('div'); root.id = 'gk-estudio-universal-root';
        root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'gk-est-title'); root.tabIndex = -1;
        var handles = ['nw','n','ne','e','se','s','sw','w'].map(function (h) { return '<button type="button" tabindex="-1" class="gku-handle" data-h="' + h + '" aria-label="Ajustar borde ' + h + '"></button>'; }).join('');
        root.innerHTML = '<header class="gku-top"><div class="gku-heading"><strong id="gk-est-title">Estudio GEOKATU</strong><small id="gk-est-dimensions">Cargando…</small></div><select id="gk-est-role" aria-label="Destino de la imagen"><option value="portada">Portada</option><option value="logo">Logo</option><option value="link_pin">Pin mapa</option><option value="logo_nombre">Nombre PNG</option><option value="producto">Producto</option></select>' + button('save','Guardar','id="gk-est-save" class="gku-primary"') + button('close','×','class="gku-close" aria-label="Cancelar edición"') + '</header>' +
            '<div class="gku-actions">' + button('undo','↶ Deshacer','id="gk-est-undo"') + button('redo','↷ Rehacer','id="gk-est-redo"') + button('compare','Ver original','id="gk-est-compare" aria-pressed="false"') + '</div>' +
            '<div id="gk-est-viewport"><div id="gk-est-stage"><canvas id="gk-est-canvas"></canvas></div><div id="gk-est-crop" hidden tabindex="0" role="group" aria-label="Recorte. Flechas: mover un píxel; Mayúsculas: diez píxeles.">' + handles + '</div><div class="gku-zoom">' + button('zoomout','−','aria-label="Alejar"') + button('fit','100%','id="gk-est-zoom" aria-label="Ajustar imagen a pantalla"') + button('zoomin','+','aria-label="Acercar"') + '</div><div class="gku-loading" id="gk-est-loading">Preparando imagen…</div></div>' +
            '<div class="gku-status" id="gk-est-status" role="status" aria-live="polite">Todo se procesa en tu dispositivo.</div>' +
            '<div class="gku-panel"><section data-section="crop"><p>Mueve el marco o ajusta sus asas. Dos dedos para ampliar y desplazar.</p><div class="gku-grid">' + button('ratio','Libre','data-ratio="0" aria-pressed="true"') + button('ratio','1:1','data-ratio="1"') + button('ratio','4:3','data-ratio="1.333333333333"') + button('ratio','16:9','data-ratio="1.777777777778"') + button('ratio','3:2','data-ratio="1.5"') + button('ratio','9:16','data-ratio="0.5625"') + button('ratio','2:1','data-ratio="2"') + button('ratio','3:1','data-ratio="3"') + '</div><div class="gku-row">' + button('whole','Toda la imagen') + button('crop','Aplicar recorte','class="gku-primary"') + '</div></section>' +
            '<section data-section="varita" hidden><p>Toca el fondo que quieras borrar. Transparencia real, sin enviar tu foto.</p>' + slider('tolerance','Tolerancia',1,100,35) + '<label class="gku-check"><input id="gk-est-global" type="checkbox">Borrar ese color en toda la imagen</label><div class="gku-row">' + button('margin','Quitar margen transparente') + '</div></section>' +
            '<section data-section="color" hidden>' + slider('brightness','Brillo',30,180,100) + slider('contrast','Contraste',30,180,100) + slider('saturation','Saturación',0,200,100) + '</section>' +
            '<section data-section="nitidez" hidden><p>Realza los detalles sin modificar la transparencia.</p>' + slider('sharpness','Nitidez',0,100,0) + '<div class="gku-row">' + button('resetpreview','Restablecer ajuste') + button('commit','Aplicar','class="gku-primary"') + '</div></section>' +
            '<section data-section="suavizado" hidden><p>Suaviza el contorno transparente. Empieza con un nivel bajo.</p><div class="gku-grid">' + [1,2,3,4].map(function(n){return button('smooth','Nivel '+n,'data-level="'+n+'"');}).join('') + '</div><div class="gku-row">' + button('margin','Quitar margen') + '</div></section>' +
            '<section data-section="transformar" hidden><p>Orientación, reflejo y salida.</p><div class="gku-grid">' + button('left','↶ 90°') + button('right','↷ 90°') + button('flipx','Espejo ↔') + button('flipy','Espejo ↕') + '</div><div class="gku-row">' + button('original','Restaurar original') + button('download','Descargar WebP') + '</div></section></div>' +
            '<nav class="gku-tools" aria-label="Herramientas de imagen">' + Object.keys(labels).map(function(p){return button('panel',svg(icons[p])+'<span>'+labels[p]+'</span>','data-panel="'+p+'" aria-pressed="false"');}).join('') + '</nav>';
        root.querySelectorAll('button').forEach(function(b){b.dataset.catalogoSvg='true';});
        doc.body.appendChild(root); canvas=el('canvas'); ctx=canvas.getContext('2d',{willReadFrequently:true}); view=el('viewport'); stage=el('stage'); cropBox=el('crop');
        root.addEventListener('click', handleButton);
        root.addEventListener('input', function(e){
            if (!ready || busy) return;
            if (e.target.id === 'gk-est-tolerance') { el('value-tolerance').textContent=e.target.value+'%'; return; }
            if (/gk-est-(brightness|contrast|saturation|sharpness)$/.test(e.target.id)) updatePreview();
        });
        el('role').addEventListener('change', function(){config.rolSugerido=this.value;notify('Destino: '+this.options[this.selectedIndex].text);});
        view.addEventListener('pointerdown', pointerDown); view.addEventListener('pointermove', pointerMove);
        view.addEventListener('pointerup', pointerEnd); view.addEventListener('pointercancel', pointerCancel);
        view.addEventListener('lostpointercapture', function(e){if(points.has(e.pointerId)) pointerCancel(e);});
        view.addEventListener('wheel', function(e){ if(!ready)return;e.preventDefault();setZoom(zoom*(e.deltaY<0?1.15:1/1.15),e.clientX,e.clientY); },{passive:false});
        root.addEventListener('keydown', keyboard);
        window.addEventListener('resize', layout);
        if(window.ResizeObserver){resizeObserver=new window.ResizeObserver(layout);resizeObserver.observe(view);}
    }
    function layout() {
        if (!ready || root.style.display === 'none') return;
        var w=view.clientWidth, h=view.clientHeight;
        fit=Math.min(Math.max(1,w-40)/canvas.width,Math.max(1,h-40)/canvas.height,1);
        var scale=fit*zoom, dw=canvas.width*scale, dh=canvas.height*scale;
        panX=clamp(panX,-Math.max(0,(dw-w)/2+30),Math.max(0,(dw-w)/2+30));
        panY=clamp(panY,-Math.max(0,(dh-h)/2+30),Math.max(0,(dh-h)/2+30));
        stage.style.width=dw+'px';stage.style.height=dh+'px';stage.style.left=((w-dw)/2+panX)+'px';stage.style.top=((h-dh)/2+panY)+'px';
        el('zoom').textContent=Math.round(zoom*100)+'%'; paintCrop();
    }
    function resetView(){zoom=1;panX=0;panY=0;layout();controls();}
    function setZoom(value,cx,cy){
        if(!ready||busy)return;
        var rect=view.getBoundingClientRect(), old=zoom, next=clamp(value,1,8);
        var x=(cx==null?rect.left+rect.width/2:cx)-rect.left-rect.width/2;
        var y=(cy==null?rect.top+rect.height/2:cy)-rect.top-rect.height/2;
        panX=x-(x-panX)*next/old;panY=y-(y-panY)*next/old;zoom=next;layout();
    }
    function fullCrop(){crop={x:0,y:0,w:canvas.width,h:canvas.height};}
    function setRatio(value){
        if(!ready)return;ratio=Number(value)||0;
        var c=crop||{x:0,y:0,w:canvas.width,h:canvas.height};
        var w=c.w,h=c.h;
        if(ratio){w=Math.min(w,h*ratio);h=w/ratio;}
        crop={x:clamp(c.x+(c.w-w)/2,0,canvas.width-w),y:clamp(c.y+(c.h-h)/2,0,canvas.height-h),w:w,h:h};
        root.querySelectorAll('[data-ratio]').forEach(function(b){b.setAttribute('aria-pressed',Math.abs(Number(b.dataset.ratio)-ratio)<0.00001?'true':'false');});paintCrop();
    }
    function paintCrop(){
        cropBox.hidden= !ready || panel!=='crop' || !crop || comparing;
        if(cropBox.hidden)return;
        var s=fit*zoom;
        cropBox.style.left=(parseFloat(stage.style.left)+crop.x*s)+'px';cropBox.style.top=(parseFloat(stage.style.top)+crop.y*s)+'px';
        cropBox.style.width=crop.w*s+'px';cropBox.style.height=crop.h*s+'px';
        notify('Recorte: '+Math.round(crop.w)+' × '+Math.round(crop.h)+' px · Arrastra dentro para mover');
    }
    function imagePoint(e){var r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
    function pair(){var p=Array.from(points.values());return{distance:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2};}
    function pointerDown(e){
        if(!ready||busy||comparing||e.button>0||e.target.closest('.gku-zoom'))return;
        e.preventDefault(); view.setPointerCapture(e.pointerId);points.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(points.size===2){var p=pair();gesture={type:'pinch',pair:p};return;}
        if(points.size>2)return;
        var hit=e.target.closest('[data-h]');
        gesture={type:panel==='crop'&&crop&&(hit||e.target.closest('#gk-est-crop'))?'crop':(panel==='varita'?'tap':'pan'),x:e.clientX,y:e.clientY,panX:panX,panY:panY,point:imagePoint(e),moved:false,handle:hit?hit.dataset.h:'move',crop:crop?Object.assign({},crop):null};
    }
    function resizeCrop(g,dx,dy){
        var c=g.crop,h=g.handle,min=Math.min(12,canvas.width,canvas.height);
        if(h==='move'){crop={x:clamp(c.x+dx,0,canvas.width-c.w),y:clamp(c.y+dy,0,canvas.height-c.h),w:c.w,h:c.h};return;}
        var west=h.indexOf('w')>=0,east=h.indexOf('e')>=0,north=h.indexOf('n')>=0,south=h.indexOf('s')>=0;
        var l=west?clamp(c.x+dx,0,c.x+c.w-min):c.x;
        var r=east?clamp(c.x+c.w+dx,c.x+min,canvas.width):c.x+c.w;
        var t=north?clamp(c.y+dy,0,c.y+c.h-min):c.y;
        var b=south?clamp(c.y+c.h+dy,c.y+min,canvas.height):c.y+c.h;
        if(!ratio){crop={x:l,y:t,w:r-l,h:b-t};return;}
        var ax=west?c.x+c.w:(east?c.x:c.x+c.w/2), ay=north?c.y+c.h:(south?c.y:c.y+c.h/2);
        var nw=(west||east)?r-l:(b-t)*ratio;
        if((west||east)&&(north||south)&&Math.abs(dy)>Math.abs(dx)/ratio)nw=(b-t)*ratio;
        var maxW=west?ax:(east?canvas.width-ax:2*Math.min(ax,canvas.width-ax));
        var maxH=north?ay:(south?canvas.height-ay:2*Math.min(ay,canvas.height-ay));
        nw=clamp(nw,Math.min(Math.max(min,min*ratio),maxW,maxH*ratio),Math.min(maxW,maxH*ratio));
        var nh=nw/ratio;
        crop={x:west?ax-nw:(east?ax:ax-nw/2),y:north?ay-nh:(south?ay:ay-nh/2),w:nw,h:nh};
    }
    function pointerMove(e){
        if(!points.has(e.pointerId)||!gesture)return;
        points.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(gesture.type==='pinch'&&points.size>=2){var p=pair(),prev=gesture.pair;setZoom(zoom*p.distance/Math.max(1,prev.distance),prev.x,prev.y);panX+=p.x-prev.x;panY+=p.y-prev.y;gesture.pair=p;layout();return;}
        var dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
        if(Math.hypot(dx,dy)>5)gesture.moved=true;
        if(gesture.type==='crop'){resizeCrop(gesture,dx/(fit*zoom),dy/(fit*zoom));paintCrop();}
        else if(gesture.type==='pan'||(gesture.type==='tap'&&gesture.moved)){panX=gesture.panX+dx;panY=gesture.panY+dy;layout();}
    }
    function pointerEnd(e){
        if(!points.has(e.pointerId))return;
        var g=gesture;points.delete(e.pointerId);
        if(g&&g.type==='tap'&&!g.moved&&points.size===0)wand(g.point);
        // Un dedo restante después de pellizcar no dispara la varita ni mueve el marco.
        gesture=points.size?{type:'wait'}:null;
        if(view.hasPointerCapture&&view.hasPointerCapture(e.pointerId))view.releasePointerCapture(e.pointerId);
    }
    function pointerCancel(e){points.delete(e.pointerId);gesture=null;}
    function openPanel(id){
        if(!labels[id]||!ready||busy)return;
        compare(false);commitPreview();panel=id;
        root.querySelectorAll('[data-section]').forEach(function(s){s.hidden=s.dataset.section!==id;});
        root.querySelectorAll('[data-panel]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.panel===id?'true':'false');});
        if(id==='crop'&&!crop)fullCrop();paintCrop();
        if(id!=='crop')notify(id==='varita'?'Toca el fondo para borrarlo. Dos dedos para navegar.':'Ajustes locales · Deshacer siempre disponible');
    }
    function updatePreview(){
        if(!ready||busy||comparing)return;
        if(!preview)preview=snapshot();
        ['brightness','contrast','saturation','sharpness'].forEach(function(id){el('value-'+id).textContent=el(id).value+'%';});
        if(raf)window.cancelAnimationFrame(raf);
        raf=window.requestAnimationFrame(function(){raf=0;renderPreview();});controls();
    }
    function renderPreview(){
        if(!preview)return;
        var src=preview.data,out=ctx.createImageData(preview.width,preview.height),dst=out.data;
        var br=Number(el('brightness').value)/100,co=Number(el('contrast').value)/100,sa=Number(el('saturation').value)/100;
        var strength=Number(el('sharpness').value)/100*0.65,W=preview.width,H=preview.height;
        for(var i=0;i<src.length;i+=4){
            var rr=src[i]*br,gg=src[i+1]*br,bb=src[i+2]*br;
            rr=(rr-127.5)*co+127.5;gg=(gg-127.5)*co+127.5;bb=(bb-127.5)*co+127.5;
            var lum=.2126*rr+.7152*gg+.0722*bb;
            dst[i]=lum+(rr-lum)*sa;dst[i+1]=lum+(gg-lum)*sa;dst[i+2]=lum+(bb-lum)*sa;dst[i+3]=src[i+3];
        }
        if(strength){
            var base=new Uint8ClampedArray(dst);
            for(var y=0;y<H;y++)for(var x=0;x<W;x++){
                var k=(y*W+x)*4;if(!base[k+3])continue;
                var up=(Math.max(0,y-1)*W+x)*4,down=(Math.min(H-1,y+1)*W+x)*4,left=(y*W+Math.max(0,x-1))*4,right=(y*W+Math.min(W-1,x+1))*4;
                for(var c=0;c<3;c++){var v=base[k+c];var sum=(base[up+3]?base[up+c]:v)+(base[down+3]?base[down+c]:v)+(base[left+3]?base[left+c]:v)+(base[right+3]?base[right+c]:v);dst[k+c]=v+(4*v-sum)*strength;}
            }
        }
        ctx.putImageData(out,0,0);
    }
    function wand(p){
        if(panel!=='varita'||p.x<0||p.y<0||p.x>=canvas.width||p.y>=canvas.height)return;
        action(function(){
            var W=canvas.width,H=canvas.height,img=snapshot(),d=img.data,start=Math.floor(p.y)*W+Math.floor(p.x),k=start*4;
            if(!d[k+3])return false;
            var r=d[k],g=d[k+1],b=d[k+2],threshold=Math.pow(Number(el('tolerance').value)/100*441.673,2);
            function match(n){var i=n*4;return d[i+3]&&(d[i]-r)*(d[i]-r)+(d[i+1]-g)*(d[i+1]-g)+(d[i+2]-b)*(d[i+2]-b)<=threshold;}
            if(el('global').checked){for(var n=0;n<W*H;n++)if(match(n))d[n*4+3]=0;}
            else{
                var seen=new Uint8Array(W*H),queue=new Int32Array(W*H),head=0,tail=1;queue[0]=start;seen[start]=1;
                while(head<tail){var q=queue[head++],xx=q%W;d[q*4+3]=0;
                    var ns=[xx?q-1:-1,xx<W-1?q+1:-1,q>=W?q-W:-1,q<W*(H-1)?q+W:-1];
                    for(var z=0;z<4;z++){var next=ns[z];if(next>=0&&!seen[next]){seen[next]=1;if(match(next))queue[tail++]=next;}}
                }
            }
            ctx.putImageData(img,0,0);
        },'Fondo eliminado. Deshacer recupera la zona borrada.');
    }
    function applyCrop(){
        if(!crop)return;var c=Object.assign({},crop);
        action(function(){var x=clamp(Math.round(c.x),0,canvas.width-1),y=clamp(Math.round(c.y),0,canvas.height-1),w=clamp(Math.round(c.w),1,canvas.width-x),h=clamp(Math.round(c.h),1,canvas.height-y);if(x===0&&y===0&&w===canvas.width&&h===canvas.height)return false;put(ctx.getImageData(x,y,w,h));},'Recorte aplicado.');
        if(panel==='crop'){fullCrop();paintCrop();}
    }
    function trim(){action(function(){var W=canvas.width,H=canvas.height,d=snapshot().data,l=W,t=H,r=-1,b=-1;for(var y=0;y<H;y++)for(var x=0;x<W;x++)if(d[(y*W+x)*4+3]>10){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y);}if(r<0){notify('La imagen está completamente transparente.');return false;}l=Math.max(0,l-2);t=Math.max(0,t-2);r=Math.min(W-1,r+2);b=Math.min(H-1,b+2);put(ctx.getImageData(l,t,r-l+1,b-t+1));},'Margen transparente retirado.');}
    function smooth(level){action(function(){
        var img=snapshot(),d=img.data,W=img.width,H=img.height,r=clamp(Math.round(level),1,5),diam=2*r+1,tmp=new Float32Array(W*H);
        for(var y=0;y<H;y++){var sum=0;for(var a=-r;a<=r;a++)sum+=d[(y*W+clamp(a,0,W-1))*4+3];for(var x=0;x<W;x++){tmp[y*W+x]=sum/diam;sum+=d[(y*W+Math.min(W-1,x+r+1))*4+3]-d[(y*W+Math.max(0,x-r))*4+3];}}
        for(var xx=0;xx<W;xx++){var total=0;for(var z=-r;z<=r;z++)total+=tmp[clamp(z,0,H-1)*W+xx];for(var yy=0;yy<H;yy++){var k=(yy*W+xx)*4;/* No inventar RGB en píxeles totalmente transparentes. */if(d[k+3])d[k+3]=Math.min(d[k+3],total/diam);total+=tmp[Math.min(H-1,yy+r+1)*W+xx]-tmp[Math.max(0,yy-r)*W+xx];}}
        ctx.putImageData(img,0,0);
    },'Contorno suavizado.');}
    function rotate(degrees){action(function(){var turns=((Math.round(Number(degrees)/90)%4)+4)%4;if(!turns)return false;var temp=makeCanvas(canvas.width,canvas.height);temp.getContext('2d').drawImage(canvas,0,0);canvas.width=turns%2?temp.height:temp.width;canvas.height=turns%2?temp.width:temp.height;ctx.save();ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(turns*Math.PI/2);ctx.drawImage(temp,-temp.width/2,-temp.height/2);ctx.restore();},'Orientación actualizada.');}
    function flip(horizontal){action(function(){var temp=makeCanvas(canvas.width,canvas.height);temp.getContext('2d').drawImage(canvas,0,0);ctx.save();ctx.clearRect(0,0,canvas.width,canvas.height);ctx.translate(horizontal?canvas.width:0,horizontal?0:canvas.height);ctx.scale(horizontal?-1:1,horizontal?1:-1);ctx.drawImage(temp,0,0);ctx.restore();},'Reflejo aplicado.');}
    function undo(){if(!ready||busy)return;compare(false);if(preview){cancelPreview();notify('Ajuste pendiente deshecho.');return;}if(!past.length)return;future.push(snapshot());put(past.pop());crop=null;resetView();if(panel==='crop'){fullCrop();paintCrop();}notify('Cambio deshecho.');}
    function redo(){if(!ready||busy||preview||!future.length)return;compare(false);past.push(snapshot());put(future.pop());crop=null;resetView();if(panel==='crop'){fullCrop();paintCrop();}notify('Cambio rehecho.');}
    var compareCanvas=null;
    function compare(show){
        if(!ready||busy)return;
        if(show===comparing)return;
        if(show){if(raf){window.cancelAnimationFrame(raf);raf=0;renderPreview();}compareCanvas=snapshot();put(original);comparing=true;}
        else{if(compareCanvas)put(compareCanvas);compareCanvas=null;comparing=false;}
        root.classList.toggle('gku-compare',comparing);el('compare').setAttribute('aria-pressed',String(comparing));el('compare').textContent=comparing?'Volver a edición':'Ver original';layout();
    }
    function keyboard(e){
        if(e.key==='Escape'){e.preventDefault();close(null);return;}
        if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();return;}
        if(e.target===cropBox&&/^Arrow/.test(e.key)&&crop){e.preventDefault();var step=e.shiftKey?10:1;crop.x=clamp(crop.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),0,canvas.width-crop.w);crop.y=clamp(crop.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0),0,canvas.height-crop.h);paintCrop();}
        if(e.key==='Tab'){var items=Array.from(root.querySelectorAll('button:not(:disabled),select,input,[tabindex="0"]')).filter(function(n){return n.getClientRects().length;});if(!items.length)return;var first=items[0],last=items[items.length-1];if(e.shiftKey&&(doc.activeElement===first||doc.activeElement===root)){last.focus();e.preventDefault();}else if(!e.shiftKey&&doc.activeElement===last){first.focus();e.preventDefault();}}
    }
    function handleButton(e){
        var b=e.target.closest('[data-action]');if(!b||!root.contains(b))return;var a=b.dataset.action;
        if(a==='close'){close(null);return;}if(!ready||busy)return;
        if(a==='compare'){compare(!comparing);return;}if(comparing)compare(false);
        var actions={save:function(){exportImage(false);},download:function(){exportImage(true);},undo:undo,redo:redo,panel:function(){openPanel(b.dataset.panel);},ratio:function(){setRatio(b.dataset.ratio);},whole:function(){ratio=0;fullCrop();setRatio(0);},crop:applyCrop,margin:trim,smooth:function(){smooth(b.dataset.level);},left:function(){rotate(-90);},right:function(){rotate(90);},flipx:function(){flip(true);},flipy:function(){flip(false);},original:restore,resetpreview:cancelPreview,commit:commitPreview,zoomin:function(){setZoom(zoom*1.25);},zoomout:function(){setZoom(zoom/1.25);},fit:resetView};
        if(actions[a])actions[a]();
    }
    function restore(){if(!ready||busy)return;cancelPreview();action(function(){put(original);},'Original restaurado. Puedes deshacer esta restauración.');}
    function close(result){
        session++;ready=false;busy=false;points.clear();gesture=null;
        if(raf){window.cancelAnimationFrame(raf);raf=0;}
        if(sourceURL){URL.revokeObjectURL(sourceURL);sourceURL='';}
        if(root){root.style.display='none';doc.body.style.overflow=previousOverflow||'';}
        var callback=resolveActive;resolveActive=null;
        past=[];future=[];preview=null;original=null;compareCanvas=null;comparing=false;
        if(canvas){canvas.width=1;canvas.height=1;}
        if(previousFocus&&previousFocus.isConnected)previousFocus.focus();
        if(callback)callback(result);
    }
    function readBlob(blob){return new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=function(){reject(new Error('No se pudo leer la imagen.'));};reader.readAsDataURL(blob);});}
    async function exportImage(download){
        if(!ready||busy)return;compare(false);commitPreview();if(panel==='crop'&&crop)applyCrop();
        busy=true;controls();el('loading').hidden=false;el('loading').textContent='Preparando imagen…';var token=session;
        try{
            var factor=Math.min(1,config.maxAncho/canvas.width,config.maxAlto/canvas.height),out=makeCanvas(Math.max(1,Math.round(canvas.width*factor)),Math.max(1,Math.round(canvas.height*factor)));
            var oc=out.getContext('2d');oc.imageSmoothingEnabled=true;oc.imageSmoothingQuality='high';oc.drawImage(canvas,0,0,out.width,out.height);
            var blob=await new Promise(function(resolve,reject){out.toBlob(function(b){if(b)resolve(b);else reject(new Error('El navegador no pudo codificar la imagen.'));},'image/webp',config.calidad);});
            var dataUrl=await readBlob(blob);if(token!==session)return;
            var result={blob:blob,dataUrl:dataUrl,width:out.width,height:out.height,rol:el('role').hidden?(config.rolSugerido||''):el('role').value};
            if(download){var url=URL.createObjectURL(blob),a=doc.createElement('a');a.href=url;a.download='geokatu_edit_'+Date.now()+(blob.type==='image/webp'?'.webp':'.png');doc.body.appendChild(a);a.click();a.remove();window.setTimeout(function(){URL.revokeObjectURL(url);},1000);notify('Imagen descargada.');}
            else close(result);
        }catch(e){if(token===session)notify('No se pudo guardar: '+e.message);}
        finally{if(token===session){busy=false;el('loading').hidden=true;controls();}}
    }
    function edit(input,options){
        init();if(resolveActive)close(null);
        config=Object.assign({maxAncho:1400,maxAlto:1400,calidad:.88,titulo:'Estudio GEOKATU',rolSugerido:'',mostrarSelectorRol:false,maxPixelesTrabajo:4000000},options||{});
        ['maxAncho','maxAlto'].forEach(function(k){config[k]=clamp(Number(config[k])||1400,1,8192);});config.calidad=clamp(Number.isFinite(Number(config.calidad))?Number(config.calidad):.88,0,1);
        config.maxPixelesTrabajo=clamp(Number(config.maxPixelesTrabajo)||4000000,100000,8000000);
        previousFocus=doc.activeElement;previousOverflow=doc.body.style.overflow;doc.body.style.overflow='hidden';
        root.style.display='flex';root.classList.remove('gku-compare');el('compare').setAttribute('aria-pressed','false');el('compare').textContent='Ver original';
        el('title').textContent=config.titulo;el('role').hidden=!(config.rolSugerido||config.mostrarSelectorRol);el('role').value=config.rolSugerido||'producto';
        el('loading').hidden=false;el('loading').textContent='Preparando imagen…';ready=false;busy=false;crop=null;ratio=0;preview=null;past=[];future=[];resetSliders();controls();root.focus();
        var token=++session;
        return new Promise(function(resolve){
            resolveActive=resolve;var img=new Image(), timeout=window.setTimeout(function(){if(token===session&&!ready){el('loading').hidden=true;notify('La imagen tarda demasiado. Cierra e inténtalo de nuevo.');}},20000);
            img.onload=function(){
                window.clearTimeout(timeout);if(token!==session)return;
                try{
                    var w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;if(!w||!h)throw new Error('Imagen vacía.');
                    var scale=Math.min(1,Math.sqrt(config.maxPixelesTrabajo/(w*h)),8192/w,8192/h);
                    canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));ctx.drawImage(img,0,0,canvas.width,canvas.height);original=snapshot();
                    if(sourceURL){URL.revokeObjectURL(sourceURL);sourceURL='';}
                    ready=true;el('loading').hidden=true;resetView();openPanel('crop');fullCrop();setRatio(0);
                    notify(scale<1?'Vista de trabajo optimizada para memoria. Recorta con las asas.':'Lista. Ajusta el marco o elige una herramienta.');
                }catch(e){el('loading').hidden=true;notify('No se pudo abrir: '+e.message);}
            };
            img.onerror=function(){window.clearTimeout(timeout);if(token!==session)return;el('loading').hidden=true;notify('No se pudo abrir la imagen. Si es una URL, el servidor debe permitir CORS.');};
            if(input instanceof Blob){sourceURL=URL.createObjectURL(input);img.src=sourceURL;}
            else if(typeof input==='string'&&input){if(/^https?:/i.test(input))img.crossOrigin='anonymous';img.src=input;}
            else{window.clearTimeout(timeout);close(null);}
        });
    }
    window.GeokatuEstudio={
        editarImagen:edit,abrirPanel:openPanel,confirmarRecorteManual:applyCrop,
        preencuadrarPlantilla:function(tipo){if(!ready)return;openPanel('crop');fullCrop();setRatio(tipo==='logo'||tipo==='link_pin'?1:tipo==='portada'?16/9:tipo==='logo_nombre'?3:0);},
        suavizarBordes:smooth,autoRecorteTransparente:trim,
        actualizarColorLive:updatePreview,aplicarNitidez:function(val){if(!ready)return;if(panel!=='nitidez')openPanel('nitidez');el('sharpness').value=clamp(Number(val)||0,0,100);updatePreview();},
        rotar:rotate,descargarWebP:function(){return exportImage(true);},deshacer:undo,rehacer:redo,restaurarOriginal:restore,
        cancelar:function(){close(null);}
    };
})(window);
