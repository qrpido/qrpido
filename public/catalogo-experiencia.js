/* GEOKATU · Interacciones exclusivas del catálogo. Sin dependencias ni peticiones de red. */
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const paths = {
        plus:'M12 5v14M5 12h14', minus:'M5 12h14', close:'m6 6 12 12M18 6 6 18',
        check:'m5 12 4 4L19 6',
        edit:'m4 16 12-12 4 4L8 20H4v-4M14 6l4 4',
        camera:'M3 6h4l2-3h6l2 3h4v15H3zM8 13a4 4 0 1 0 8 0 4 4 0 0 0-8 0',
        image:'M3 3h18v18H3zM3 17l6-7 5 5 3-3 4 5M15 7h1',
        trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
        cart:'M2 3h3l3 12h11l3-9H6M9 20h1m7 0h1',
        phone:'M7 3H3c0 10 8 18 18 18v-4l-5-2-2 2a15 15 0 0 1-7-7l2-2-2-5',
        mail:'M3 5h18v14H3zM3 6l9 7 9-7',
        web:'M2 12h20M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 0c-6 6-6 14 0 20 6-6 6-14 0-20',
        whatsapp:'M21 11a9 9 0 0 1-13 9l-5 1 1-5A9 9 0 1 1 21 11M8 7c0 5 4 9 8 9l1-3-3-1-1 1-2-2 1-1-1-3H8',
        telegram:'m2 11 20-8-5 18-6-6-4 3v-6l10-6-10 6-5-1',
        instagram:'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm1 10a4 4 0 1 0 8 0 4 4 0 0 0-8 0M17 6h1',
        facebook:'M14 22V12h4l1-4h-5V5h5V2h-5a4 4 0 0 0-4 4v2H7v4h3v10',
        x:'M4 3h4l12 18h-4L4 3zm16 0L4 21',
        linkedin:'M3 8h4v13H3zM4 3h2M11 21V8h4v2c5-5 6 1 6 3v8m-6 0v-8',
        video:'M3 5h18v14H3zM10 8l6 4-6 4V8',
        bag:'M3 7h18v14H3zM8 7V5a4 4 0 0 1 8 0v2',
        link:'m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1',
        pin:'M12 22s8-8 8-14a8 8 0 1 0-16 0c0 6 8 14 8 14zm-3-14a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
        map:'m3 5 6-3 6 3 6-3v17l-6 3-6-3-6 3V5zm6-3v17m6-14v17',
        chevron:'m9 5 7 7-7 7', zoom:'M3 10a7 7 0 1 0 14 0 7 7 0 0 0-14 0m12 5 6 6M6 10h8M10 6v8',
        text:'M3 5h18M12 5v16M8 21h8', clock:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4v6l4 2'
    };
    function icon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor');
        svg.setAttribute('stroke-width','1.8'); svg.setAttribute('stroke-linecap','round'); svg.setAttribute('stroke-linejoin','round');
        svg.setAttribute('aria-hidden','true'); svg.classList.add('gk-icon');
        const p = document.createElementNS(svg.namespaceURI,'path'); p.setAttribute('d',paths[name] || paths.link); svg.append(p); return svg;
    }
    function button(name, label, action, cls) {
        const b = document.createElement('button'); b.type='button'; b.className=cls || 'gk-boton-icono'; b.title=label; b.setAttribute('aria-label',label); b.append(icon(name));
        if(action)b.addEventListener('click',action); return b;
    }
    function texto(tag, value, cls) { const e=document.createElement(tag); e.textContent=value; if(cls)e.className=cls; return e; }
    function luminance(hex) {
        const c=hex.replace('#',''); const full=c.length===3?c.split('').map(x=>x+x).join(''):c;
        if(!/^[a-f0-9]{6}$/i.test(full))return null;
        const a=[0,2,4].map(i=>parseInt(full.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));
        return .2126*a[0]+.7152*a[1]+.0722*a[2];
    }
    function foreground(background) { const l=luminance(background); return l===null?'#ffffff':(l+.05)/.05>=1.05/(l+.05)?'#000000':'#ffffff'; }
    const methods = [
        ['whatsapp','WhatsApp','whatsapp','Número con código de país','phone'],
        ['telegram','Telegram','telegram','Usuario sin @','user','https://t.me/'],
        ['instagram','Instagram','instagram','Usuario sin @','user','https://instagram.com/'],
        ['facebook','Facebook','facebook','Enlace de tu página','url'],
        ['x','X','x','Usuario sin @','user','https://x.com/'],
        ['linkedin','LinkedIn','linkedin','Enlace de tu empresa o perfil','url'],
        ['mercadolibre','Mercado Libre','bag','Enlace de tu tienda','url'],
        ['tiktok','TikTok','video','Usuario sin @','user','https://www.tiktok.com/@'],
        ['youtube','YouTube','video','Enlace de tu canal','url'],
        ['pinterest','Pinterest','image','Enlace de tu perfil','url'],
        ['threads','Threads','link','Enlace de tu perfil','url'],
        ['signal','Signal','phone','Enlace público de contacto','url'],
        ['discord','Discord','link','Enlace de invitación','url'],
        ['twitch','Twitch','video','Enlace de tu canal','url'],
        ['maps','Google Maps','map','Enlace de tu ubicación','url'],
        ['booking','Booking','web','Enlace de tu alojamiento','url'],
        ['tripadvisor','Tripadvisor','web','Enlace de tu establecimiento','url'],
        ['github','GitHub','link','Enlace de tu organización','url'],
        ['telefono','Teléfono','phone','Número con código de país','phone'],
        ['correo','Correo','mail','correo@negocio.com','email'],
        ['web','Página web','web','https://…','url'],
        ['otro','Otro enlace','link','https://…','url']
    ];
    function method(id){return methods.find(x=>x[0]===id);}
    function contactURL(c) {
        const m=method(c.tipo); if(!m)return null;
        const v=String(c.valor||'').trim(); if(!v)return null;
        if(m[4]==='phone') { let n=v.replace(/[\s()+.-]/g,''); if(!/^\d{5,15}$/.test(n))return null; if(n.length===10 && (!api || (api.datos().pais||'COL')==='COL'))n='57'+n;return c.tipo==='whatsapp'?'https://wa.me/'+n:'tel:+'+n; }
        if(m[4]==='email')return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?'mailto:'+v:null;
        if(m[4]==='user') { const u=v.replace(/^@/,'');return /^[a-z0-9_.-]{1,64}$/i.test(u)?m[5]+encodeURIComponent(u):null; }
        try { const u=new URL(v);return ['https:','http:'].includes(u.protocol)?u.href:null; } catch(e){return null;}
    }
    let api, draft=[], originals={}, wheelTimer, resizeTimer;
    function collect(d) {
        const list=Array.isArray(d.contactos_publicos)?d.contactos_publicos.filter(c=>c && method(c.tipo)).map(c=>({tipo:c.tipo,valor:String(c.valor||'')})):[];
        const legacy=[['whatsapp',d.whatsapp||d.whatsApp],['telegram',d.telegram],['instagram',d.instagram]];
        legacy.forEach(([tipo,valor])=>{if(valor&&!list.some(c=>c.tipo===tipo))list.push({tipo,valor:String(valor)});});
        return list;
    }
    function dirty(){ $('estado-edicion-perfil').textContent='Cambios sin guardar'; }
    function syncLegacy() {
        [['whatsapp','input-edit-whatsapp'],['telegram','input-edit-telegram'],['instagram','input-edit-instagram']].forEach(([tipo,id])=>{
            $(id).value=(draft.find(c=>c.tipo===tipo)||{}).valor||'';
        });
    }
    function renderDraft() {
        const host=$('contactos-editables');host.replaceChildren();
        draft.forEach((c,index)=>{
            const m=method(c.tipo),row=document.createElement('div');row.className='metodo-editable';
            const label=document.createElement('label');label.append(icon(m[2]),texto('span',m[1]));
            const input=document.createElement('input');input.className='input-edicion-perfil';input.value=c.valor;input.placeholder=m[3];input.required=true;
            input.type=m[4]==='email'?'email':m[4]==='url'?'url':m[4]==='phone'?'tel':'text';
            input.addEventListener('input',()=>{c.valor=input.value;input.setCustomValidity(contactURL(c)?'':'Revisa el dato de '+m[1]);syncLegacy();dirty();});
            label.append(input);row.append(label,button('trash','Quitar '+m[1],()=>{draft.splice(index,1);renderDraft();syncLegacy();dirty();}));host.append(row);
        });
    }
    function mountContactEditor() {
        const field=document.createElement('fieldset');field.className='editor-contactos';field.append(texto('legend','Añade tus métodos de contacto'));
        const list=document.createElement('div');list.id='contactos-editables';field.append(texto('p','Los métodos que añadas aquí serán públicos.','ayuda-editor'),list);
        const picker=document.createElement('div');picker.id='selector-metodos';picker.hidden=true;
        const search=document.createElement('input');search.type='search';search.placeholder='Buscar un canal…';search.className='input-edicion-perfil';search.setAttribute('aria-label','Buscar método de contacto');
        const options=document.createElement('div');options.className='opciones-metodos';
        methods.forEach(m=>{const b=button(m[2],m[1],()=>{draft.push({tipo:m[0],valor:''});renderDraft();picker.hidden=true;add.setAttribute('aria-expanded','false');list.lastElementChild.querySelector('input').focus();dirty();},'metodo-opcion');b.append(texto('span',m[1]));b.dataset.nombre=m[1].toLowerCase();options.append(b);});
        search.addEventListener('input',()=>options.querySelectorAll('button').forEach(b=>b.hidden=!b.dataset.nombre.includes(search.value.toLowerCase())));
        picker.append(search,options);
        const add=button('plus','Añadir método',()=>{picker.hidden=!picker.hidden;add.setAttribute('aria-expanded',String(!picker.hidden));if(!picker.hidden)search.focus();},'boton-archivo');add.append(texto('span','Añadir método'));add.setAttribute('aria-expanded','false');add.setAttribute('aria-controls','selector-metodos');field.append(add,picker);
        const form=$('form-editar-perfil-negocio');
        // Default phone/email/web remain first-class fields; legacy inputs stay for compatibility.
        const base=document.createElement('div');base.className='contacto-base';
        ['input-edit-pbx','input-edit-correo','input-edit-web'].forEach(id=>base.append($(id).closest('.form-grupo-edicion')));
        base.querySelector('label[for="input-edit-pbx"]').textContent='Teléfono';
        $('input-edit-whatsapp').closest('.form-grupo-edicion').hidden=true;
        $('input-edit-instagram').closest('.form-grupo-edicion').hidden=true;
        $('input-edit-telegram').closest('.editor-dos-columnas').hidden=true;
        form.insertBefore(base,form.querySelector('.editor-apariencia').nextSibling);base.after(field);
    }
    function wheelSelect(index, move) {
        const wheel=$('rueda-cuarzos'),items=[...wheel.children]; index=Math.max(0,Math.min(items.length-1,index));
        const target=items[index];if(!target)return;
        items.forEach((b,i)=>{b.classList.toggle('seleccionado',i===index);b.setAttribute('aria-selected',String(i===index));});
        wheel.setAttribute('aria-activedescendant',target.id);
        const changed=$('edit-cuarzo').value!==target.dataset.value;
        $('edit-cuarzo').value=target.dataset.value;
        window.actualizarPreviewIdentidad();
        if(move)wheel.scrollTo({top:index*44,behavior:'smooth'});
        return changed;
    }
    function mountWheel() {
        const w=$('rueda-cuarzos');w.replaceChildren();
        [...$('edit-cuarzo').options].forEach((op,i)=>{
            const row=document.createElement('div');row.className='cuarzo-opcion';row.role='option';row.id='cuarzo-opcion-'+i;row.dataset.value=op.value;
            const dot=document.createElement('span');dot.className='cuarzo-muestra';dot.style.background=window.obtenerEstiloCuarzo(op.value).bg;row.append(dot,texto('span',op.textContent));row.onclick=()=>{wheelSelect(i,true);dirty();};w.append(row);
        });
        const current=[...w.children].findIndex(x=>x.dataset.value===$('edit-cuarzo').value);
        requestAnimationFrame(()=>{w.scrollTop=Math.max(0,current)*44;wheelSelect(Math.max(0,current),false);});
        w.onscroll=()=>{if(wheelTimer)return;wheelTimer=requestAnimationFrame(()=>{wheelTimer=null;if(wheelSelect(Math.round(w.scrollTop/44),false))dirty();});};
        w.onkeydown=e=>{let i=[...w.children].findIndex(x=>x.getAttribute('aria-selected')==='true');if(e.key==='ArrowDown')i++;else if(e.key==='ArrowUp')i--;else if(e.key==='Home')i=0;else if(e.key==='End')i=w.children.length-1;else return;e.preventDefault();wheelSelect(i,true);dirty();};
    }
    function loopRail(host, nodes) {
        host.onscroll=null;host.replaceChildren();const group=document.createElement('div');group.className='contactos-grupo';nodes.forEach(n=>group.append(n));host.append(group);
        requestAnimationFrame(()=>{
            if(!group.isConnected)return;
            const width=group.getBoundingClientRect().width;
            host.classList.toggle('con-desborde',width>host.clientWidth+1);if(width<=host.clientWidth+1)return;
            const clone=()=>{const c=group.cloneNode(true);c.setAttribute('aria-hidden','true');c.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));c.querySelectorAll('a,button').forEach((n,i)=>{n.tabIndex=-1;n.removeAttribute('onclick');n.addEventListener('click',e=>{e.preventDefault();group.querySelectorAll('a,button')[i].click();});});return c;};
            host.prepend(clone());host.append(clone());host.scrollLeft=width;
            let adjusting=false;host.onscroll=()=>{if(adjusting)return;adjusting=true;if(host.scrollLeft<width*.5)host.scrollLeft+=width;else if(host.scrollLeft>width*1.5)host.scrollLeft-=width;adjusting=false;};
        });
    }
    function contactButtons(d) {
        const list=collect(d).sort((a,b)=>(a.tipo==='whatsapp'?-1:0)-(b.tipo==='whatsapp'?-1:0));
        if(d.pbx)list.push({tipo:'telefono',valor:d.pbx});
        if(d.mostrar_correo_publico===true&&(d.correo||d.email))list.push({tipo:'correo',valor:d.correo||d.email});
        if(d.sitio_web||d.web)list.push({tipo:'web',valor:d.sitio_web||d.web});
        const seen=new Set();return list.filter(c=>{const u=contactURL(c);if(!u||seen.has(u))return false;seen.add(u);return true;}).map(c=>{
            const m=method(c.tipo),a=document.createElement('a');a.className='gk-boton-icono';a.href=contactURL(c);a.title=m[1]+' · '+c.valor;a.setAttribute('aria-label',a.title);a.append(icon(m[2]));if(a.href.startsWith('http')){a.target='_blank';a.rel='noopener noreferrer';}return a;
        });
    }
    function actualizarIdentidad() {
        if(!api)return;const d=api.datos();document.body.dataset.avatarMarco=String(d.avatar_marco!==false);
        document.body.dataset.avatarPosicion=['izquierda','derecha'].includes(d.avatar_posicion)?d.avatar_posicion:'centro';
        const raw=String(d.horario||'').trim();
        const horario=d.es_24_horas?'Horario de Atención: 24 horas':(!raw||/^(no registra|no registrado|sin horario|n\/a|null|undefined)$/i.test(raw)?'':'Horario de Atención: '+raw.replace(/\s*[-–]\s*/g,' a '));
        $('badge-horario-header').textContent=horario;
        $('badge-horario-header').hidden=!horario;
        $('resumen-contacto').replaceChildren(...[horario,d.direccion].filter(Boolean).map(v=>texto('span',v)));
        originals.map.replaceChildren(icon('pin')); originals.map.title='Ver ubicación'; originals.map.setAttribute('aria-label','Ver ubicación');
        originals.edit.replaceChildren(icon(window.modoEdicionActivo?'check':'edit'));
        originals.edit.title=window.modoEdicionActivo?'Terminar edición':'Editar catálogo'; originals.edit.setAttribute('aria-label',originals.edit.title);
        originals.edit.setAttribute('aria-pressed',String(!!window.modoEdicionActivo));
        const root=document.documentElement;let color=getComputedStyle(root).getPropertyValue('--color-terciario').trim();
        if(luminance(color)===null)color='#ff6b00';
        document.body.style.setProperty('--accion-fondo',color);document.body.style.setProperty('--accion-texto',foreground(color));
        // Text surfaces use semantic colours, independent from arbitrary brand accents.
        const top=[originals.map,originals.heart,...contactButtons(d),originals.share].filter(Boolean);
        loopRail($('contactos-portada'),top);loopRail($('contactos-pie'),[...contactButtons(d),button('pin','Ver ubicación',()=>window.viajarAlMapa())]);
        $('avatar-tienda').alt=d.nombre?'Foto de perfil de '+d.nombre:'Foto de perfil';
    }
    function resumenCarrito() {
        if(!api)return;const host=$('lista-resumen');const foco=host.contains(document.activeElement)?document.activeElement.getAttribute('aria-label'):null;host.replaceChildren();let total=0;
        for(const [id,item] of Object.entries(api.carrito())){
            const p=api.productos().find(p=>p.id_prod===id);if(!p)continue;
            const subtotal=item.cant*(Number(p.precio)||0);total+=subtotal;
            const row=document.createElement('article');row.className='carrito-articulo';
            const photo=button('image','Ver fotos de '+p.nombre,()=>galeria(p),'carrito-miniatura');
            if(p.imagen){photo.replaceChildren();const im=document.createElement('img');im.src=p.imagen;im.alt=p.nombre||'Producto';im.onerror=()=>{photo.replaceChildren(icon('image'));};photo.append(im);}
            const info=document.createElement('div');info.className='carrito-info';info.append(texto('strong',p.nombre||'Producto'),texto('span',window.formatearMoneda(p.precio)+' por '+(p.unidad_medida||'unidad'),'carrito-unitario'));
            const qty=document.createElement('div');qty.className='carrito-cantidad';
            const input=document.createElement('input');input.type='number';input.inputMode='decimal';input.min='0';input.step=p.es_pesable?'0.001':'1';input.value=item.cant;input.setAttribute('aria-label','Cantidad de '+p.nombre);
            input.addEventListener('change',()=>{let n=Number(input.value);if(!Number.isFinite(n)||n<0||(!p.es_pesable&&!Number.isInteger(n))){input.value=item.cant;return;}api.cambiar(id,Math.round((n-item.cant)*1000)/1000);resumenCarrito();});
            qty.append(button('minus','Restar unidad',()=>{api.cambiar(id,-Math.min(1,item.cant));},'cantidad-control'),input,button('plus','Sumar unidad',()=>api.cambiar(id,1),'cantidad-control'));
            info.append(qty);const amount=document.createElement('div');amount.className='carrito-importe';amount.append(texto('b',window.formatearMoneda(subtotal)),button('trash','Eliminar '+p.nombre,()=>api.cambiar(id,-item.cant)));
            row.append(photo,info,amount);host.append(row);
        }
        if(!host.children.length)host.append(texto('p','Tu carrito está vacío. Añade algún producto para empezar.','carrito-vacio'));
        $('total-final-checkout').textContent=window.formatearMoneda(total);$('btn-enviar-pedido').disabled=!host.querySelector('.carrito-articulo');
        if(foco){const target=[...host.querySelectorAll('[aria-label]')].find(e=>e.getAttribute('aria-label')===foco);if(target)target.focus({preventScroll:true});}
    }
    let galleryFocus=null;
    function galeria(p, imagenInicial) {
        const urls=[...new Set([p.imagen,...(Array.isArray(p.galeria)?p.galeria:[])].filter(x=>typeof x==='string'&&x))];if(!urls.length)return;
        galleryFocus=document.activeElement;const dialog=$('galeria-catalogo'),track=$('galeria-pistas');track.replaceChildren();$('galeria-titulo').textContent=p.nombre||'Fotos del producto';
        urls.forEach((src,i)=>{const slide=document.createElement('div');slide.className='galeria-diapositiva';const pan=document.createElement('div');pan.className='galeria-pan';const img=document.createElement('img');img.src=src;img.alt=(p.nombre||'Producto')+' · '+(i+1);img.draggable=false;pan.append(img);slide.append(pan);track.append(slide);
            let zoom=1,pointers=new Map(),baseDistance=0,baseZoom=1,startX=0,lastX=0,lastY=0,multi=false;
            const setZoom=z=>{zoom=Math.max(1,Math.min(4,z));img.style.width=(zoom*100)+'%';img.style.height=(zoom*100)+'%';pan.classList.toggle('ampliada',zoom>1);};
            slide.zoomBy=delta=>setZoom(zoom+delta);slide.resetZoom=()=>setZoom(1);
            img.ondblclick=()=>setZoom(zoom>1?1:2);
            pan.addEventListener('pointerdown',e=>{
                pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});pan.setPointerCapture(e.pointerId);
                if(pointers.size===1){startX=lastX=e.clientX;lastY=e.clientY;multi=false;}
                if(pointers.size===2){const a=[...pointers.values()];baseDistance=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);baseZoom=zoom;multi=true;}
            });
            pan.addEventListener('pointermove',e=>{
                if(!pointers.has(e.pointerId))return;
                pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
                if(pointers.size===2){const a=[...pointers.values()];if(baseDistance)setZoom(baseZoom*Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)/baseDistance);}
                else if(zoom>1){pan.scrollLeft-=e.clientX-lastX;pan.scrollTop-=e.clientY-lastY;}
                lastX=e.clientX;lastY=e.clientY;
            });
            pan.addEventListener('pointerup',e=>{
                if(pointers.size===1&&!multi&&zoom===1&&Math.abs(e.clientX-startX)>40)track.scrollBy({left:(e.clientX<startX?1:-1)*track.clientWidth,behavior:'smooth'});
                pointers.delete(e.pointerId);
            });
            pan.addEventListener('pointercancel',e=>pointers.delete(e.pointerId));
        });
        dialog.hidden=false;document.body.classList.add('galeria-abierta');track.scrollLeft=Math.max(0,urls.indexOf(imagenInicial))*track.clientWidth;updateGallery();$('galeria-cerrar').focus();
    }
    function activeSlide(){const t=$('galeria-pistas');return Math.max(0,Math.min(t.children.length-1,Math.round(t.scrollLeft/t.clientWidth)));}
    function updateGallery(){const t=$('galeria-pistas');$('galeria-contador').textContent=(activeSlide()+1)+' / '+t.children.length;}
    function closeGallery(){$('galeria-catalogo').hidden=true;document.body.classList.remove('galeria-abierta');if(galleryFocus&&galleryFocus.isConnected)galleryFocus.focus();}
    function mountGallery(){
        const overlay=document.createElement('section');overlay.id='galeria-catalogo';overlay.hidden=true;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','galeria-titulo');
        const bar=document.createElement('div');bar.className='galeria-barra';bar.append(texto('strong','','galeria-nombre'));bar.firstChild.id='galeria-titulo';const close=button('close','Cerrar galería',closeGallery);close.id='galeria-cerrar';bar.append(close);
        const track=document.createElement('div');track.id='galeria-pistas';track.onscroll=updateGallery;
        const controls=document.createElement('div');controls.className='galeria-controles';
        const prev=button('chevron','Foto anterior',()=>track.scrollBy({left:-track.clientWidth,behavior:'smooth'}));prev.classList.add('anterior');const next=button('chevron','Foto siguiente',()=>track.scrollBy({left:track.clientWidth,behavior:'smooth'}));
        const count=texto('span','');count.id='galeria-contador';count.setAttribute('aria-live','polite');
        controls.append(prev,count,next,button('plus','Ampliar foto',()=>track.children[activeSlide()].zoomBy(.5)),button('minus','Reducir foto',()=>track.children[activeSlide()].zoomBy(-.5)),button('image','Restablecer zoom',()=>track.children[activeSlide()].resetZoom()));
        overlay.append(bar,track,controls,texto('p','Desliza para cambiar de foto. Doble toque o botones para ampliar.','galeria-ayuda'));document.body.append(overlay);
        overlay.addEventListener('keydown',e=>{if(e.key==='Escape')closeGallery();if(e.key==='ArrowRight')next.click();if(e.key==='ArrowLeft')prev.click();if(e.key==='Tab'){const a=[...overlay.querySelectorAll('button')],i=a.indexOf(document.activeElement);e.preventDefault();a[(i+(e.shiftKey?-1:1)+a.length)%a.length].focus();}});
        $('catalogo-contenedor').addEventListener('click',e=>{const im=e.target.closest('.producto-card img');if(!im)return;const p=api.productos().find(p=>p.id_prod===im.closest('.producto-card').dataset.producto);if(p)galeria(p,im.getAttribute('src'));});
    }
    function iniciar(adapters) {
        api=adapters;
        const header=document.querySelector('.header-negocio');
        originals={map:header.querySelector('.btn-radar-volver'),heart:$('btn-favorito-header'),edit:$('btn-modo-edicion'),share:$('btn-compartir')};
        Object.values(originals).forEach(b=>{b.classList.add('gk-boton-icono');b.setAttribute('aria-label',b.title);});
        const rail=document.createElement('nav');rail.id='contactos-portada';rail.className='contactos-carrusel';rail.setAttribute('aria-label','Acciones y contactos del negocio');header.prepend(rail);
        const footer=document.createElement('nav');footer.id='contactos-pie';footer.className='contactos-carrusel';footer.setAttribute('aria-label','Contactos del negocio');document.querySelector('.footer-negocio').prepend(footer);
        const avatar=header.querySelector('.contenedor-avatar-aureo'),row=document.createElement('div');row.className='perfil-resumen';avatar.before(row);row.append(avatar);const meta=document.createElement('div');meta.className='perfil-meta';meta.append(header.querySelector('.contenedor-nicho'),$('badge-horario-header'));row.append(meta);meta.prepend($('contenedor-nombre'));header.append(originals.edit);
        const summary=document.createElement('div');summary.id='resumen-contacto';footer.after(summary);
        const owner=document.querySelector('.barra-dueno-catalogo');owner.replaceChildren();owner.classList.add('panel-editar-negocio');const edit=$('lapiz-nombre');edit.className='editar-datos-negocio';edit.replaceChildren(icon('edit'),texto('span','Editar datos del comercio'));owner.append(edit);const add=button('plus','Agregar artículo',()=>window.abrirModalProductoNuevo(),'agregar-articulo');add.append(texto('span','Agregar artículo'));owner.append(add);
        $('carrito-flotante').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();window.abrirCheckout();}});
        const decorate=(selector,name)=>document.querySelectorAll(selector).forEach(b=>{if(!b.querySelector('svg'))b.prepend(icon(name));});
        decorate('#lapiz-portada,#lapiz-avatar','camera');decorate('.btn-subir-archivo-modal','image');decorate('#btn-eliminar-prod-insitu','trash');decorate('#btn-gps','pin');decorate('#btn-abrir-mapa','map');decorate('.cerrar-sheet,.btn-cerrar-modal','close');
        document.querySelectorAll('.btn-cerrar-modal,.cerrar-sheet').forEach(b=>{b.setAttribute('aria-label','Cerrar');[...b.childNodes].filter(n=>n.nodeType===3).forEach(n=>n.remove());});
        // Uniform upload rows, including the PNG thumbnail and the two actions.
        const png=$('input-edit-nombre-png-url').closest('.form-grupo-edicion');png.classList.add('edicion-nombre-png');
        const actions=document.createElement('div');actions.className='acciones-archivo';png.querySelectorAll('button').forEach(b=>actions.append(b));png.append(actions);
        $('img-preview-nombre-png-modal').parentElement.classList.add('preview-png-transparente');
        const ruedaGrupo=document.querySelector('.selector-cuarzo-grupo');
        const ajustes=ruedaGrupo.parentElement;
        ajustes.before(ruedaGrupo, $('preview-identidad'));
        const nombreEscrito=png.querySelector('button[onclick*=quitarNombrePngCatalogo]');
        if(nombreEscrito){nombreEscrito.querySelector('svg').replaceWith(icon('text'));}
        mountContactEditor();mountGallery();
        // Scoped adaptation of the existing image editor: no shared engine changes.
        if(window.GeokatuEstudio){
            const editar=window.GeokatuEstudio.editarImagen;
            window.GeokatuEstudio.editarImagen=function(){
                const result=editar.apply(this,arguments);
                const studio=$('gk-estudio-universal-root');
                if(studio)studio.querySelectorAll('button:not([data-catalogo-svg])').forEach(b=>{
                    b.dataset.catalogoSvg='true';
                    const label=b.textContent.replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F\u200D]/gu,'').trim();
                    const type=b.id==='gk-est-btn-cerrar'?'close':b.dataset.panel==='nitidez'?'zoom':b.dataset.panel==='color'?'image':'edit';
                    b.replaceChildren(icon(type),document.createTextNode(label));b.setAttribute('aria-label',label||'Cerrar');
                });
                return result;
            };
        }
        // Keep sheets inside the visible area when the phone keyboard appears.
        const viewport=window.visualViewport;
        const medir=()=>document.documentElement.style.setProperty('--catalogo-alto-visible',(viewport?viewport.height:window.innerHeight)+'px');
        medir();if(viewport)viewport.addEventListener('resize',medir);window.addEventListener('resize',medir);

        window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(actualizarIdentidad,150);});
        // Only decorate product edit controls generated after filtering/pagination.
        new MutationObserver(()=>document.querySelectorAll('.lapiz-editar-prod:not([data-svg])').forEach(b=>{b.dataset.svg='true';b.replaceChildren(icon('edit'));b.setAttribute('role','button');b.tabIndex=0;b.setAttribute('aria-label','Editar artículo');b.onkeydown=e=>{if(e.key==='Enter')b.click();};})).observe($('catalogo-contenedor'),{childList:true,subtree:true});
    }
    window.CatalogoUI={iniciar,actualizarIdentidad,resumenCarrito,galeria,foreground,contactURL,
        editarPerfil(){draft=collect(api.datos());renderDraft();syncLegacy();$('selector-metodos').hidden=true;mountWheel();},
        leerContactos(){for(const c of draft)if(!contactURL(c)){const e=new Error('Revisa el dato de '+method(c.tipo)[1]);e.userMessage=e.message;throw e;}syncLegacy();return draft.map(c=>({tipo:c.tipo,valor:c.valor.trim()}));}
    };
})();
