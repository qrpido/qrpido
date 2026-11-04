/* Estados reales del arranque. El temporizador informa demora, nunca inventa progreso. */
(function () {
    let mapaListo=false, directorioListo=false, iniciado=Date.now();
    const label=()=>document.getElementById('txt-estado-carga');
    const estado=(mensaje)=>{const el=label();if(el)el.textContent=mensaje;};
    function liberar() {
        if (!mapaListo || !directorioListo) return;
        const panel=document.getElementById('pantalla-carga');if(panel)panel.style.display='none';
        clearInterval(espera);
    }
    const espera=setInterval(()=>{
        if(Date.now()-iniciado<12000)return;
        estado(navigator.onLine?'La carga está tardando. Puedes reintentar o continuar con lo disponible.':'Sin conexión. Solo estarán disponibles las zonas y comercios descargados.');
        const acciones=document.getElementById('acciones-carga');if(acciones)acciones.hidden=false;
    },3000);
    window.GeokatuArranque={
        estado,
        mapa(){mapaListo=true;estado('Mapa preparado. Cargando elementos comerciales…');liberar();},
        directorio(cantidad){directorioListo=true;estado(cantidad+' comercios disponibles. Preparando mapa…');liberar();},
        error(){estado('No pudimos completar la carga. Reintenta o continúa con lo disponible.');const e=document.getElementById('acciones-carga');if(e)e.hidden=false;},
        continuar(){const e=document.getElementById('pantalla-carga');if(e)e.style.display='none';clearInterval(espera);}
    };
})();
