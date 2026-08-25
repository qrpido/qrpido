// profiler.js - Micro-Profiler Modular (Plug & Play)
const profilerHTML = `
<div id="perf-bubble" style="position:fixed; top:20%; right:5px; z-index:999999; width:45px; height:45px; background:rgba(10,10,12,0.85); backdrop-filter:blur(10px); border:2px solid #00ff64; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 15px rgba(0,255,100,0.3); cursor:pointer; touch-action:none; font-size:20px; transition: left 0.3s ease-out, top 0.3s ease-out;">📊</div>
<div id="perf-panel" style="position:fixed; top:50%; left:50%; transform:translate(-50%, -50%) scale(0.8); z-index:999998; background:rgba(10,10,15,0.95); color:#00ff64; padding:15px; border-radius:20px; font-family:monospace; font-size:12px; border:1px solid #00ff64; box-shadow: 0 15px 40px rgba(0,0,0,0.8); opacity:0; pointer-events:none; transition: 0.3s cubic-bezier(0.25, 1, 0.5, 1);">
<b style="color:white; display:block; text-align:center; letter-spacing:1px; font-family:sans-serif;">PERFORMANCE</b><hr style="border-color:#00ff64; margin:10px 0; opacity:0.3;">
⏱️ FPS: <span id="m-fps">--</span><br>💾 RAM: <span id="m-ram">--</span><br>📦 DOM: <span id="m-dom">--</span> nodos<br>
<button id="btn-bajar-data" style="background:#00ff64; color:#000; border:none; padding:10px; margin-top:12px; width:100%; font-weight:900; border-radius:8px; cursor:pointer;">BAJAR DATA</button>
</div>`;
document.body.insertAdjacentHTML('beforeend', profilerHTML);

document.getElementById('btn-bajar-data').onclick = () => {
    const logData = window.qrpidoLog ? window.qrpidoLog.join('\n') : "Sin datos";
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([logData], { type: 'text/plain' }));
    a.download = `AUDITORIA_GEOKATU_${new Date().getTime()}.txt`; a.click();
};

let fCount = 0, lastFTime = performance.now();
function auditarHardware() {
    fCount++; let now = performance.now();
    if (now >= lastFTime + 1000) {
        let fps = Math.round((fCount * 1000) / (now - lastFTime));
        let dom = document.getElementsByTagName('*').length;
        let ram = window.performance && performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) : "N/A";
        if(window.qrpidoLog) window.qrpidoLog.push(`[${(now - (window.tiempoArranque||0)).toFixed(0)}ms] 📊 FPS: ${fps} | RAM: ${ram}MB | DOM: ${dom}`);
        document.getElementById('m-fps').innerText = fps;
        document.getElementById('m-ram').innerText = ram + 'MB';
        document.getElementById('m-dom').innerText = dom;
        fCount = 0; lastFTime = now;
    }
    requestAnimationFrame(auditarHardware);
}
requestAnimationFrame(auditarHardware);

const bubble = document.getElementById('perf-bubble'), panel = document.getElementById('perf-panel');
let bDrag = false, bSX, bSY, bIX, bIY, bRaf;
bubble.addEventListener('touchstart', (e) => {
    bDrag = false; bSX = e.touches[0].clientX; bSY = e.touches[0].clientY;
    const r = bubble.getBoundingClientRect(); bIX = r.left; bIY = r.top; bubble.style.transition = 'none';
}, {passive: true});
bubble.addEventListener('touchmove', (e) => {
    const dx = e.touches[0].clientX - bSX, dy = e.touches[0].clientY - bSY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        bDrag = true; if(bRaf) cancelAnimationFrame(bRaf);
        bRaf = requestAnimationFrame(() => {
            bubble.style.left = Math.max(0, Math.min(bIX + dx, window.innerWidth - 45)) + 'px';
            bubble.style.top = Math.max(0, Math.min(bIY + dy, window.innerHeight - 45)) + 'px';
        });
    }
}, {passive: true});
bubble.addEventListener('touchend', () => {
    if (!bDrag) {
        if (navigator.vibrate) navigator.vibrate(20);
        const isOpen = panel.style.opacity === '1';
        panel.style.opacity = isOpen ? '0' : '1';
        panel.style.pointerEvents = isOpen ? 'none' : 'all';
        panel.style.transform = isOpen ? 'translate(-50%, -50%) scale(0.8)' : 'translate(-50%, -50%) scale(1)';
    } else {
        bubble.style.transition = 'left 0.3s cubic-bezier(0.25, 1, 0.5, 1), top 0.3s ease-out';
        bubble.style.left = (bubble.getBoundingClientRect().left + 22.5 > window.innerWidth / 2) ? (window.innerWidth - 50) + 'px' : '5px';
    }
});