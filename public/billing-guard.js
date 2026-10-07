/**
 * GEOKATU BILLING GUARD
 * Control preventivo de cuota fiscal y pasarela prepago Wompi
 * Arquitectura Glassmorphism sobria sin diálogos nativos ni emojis
 */
export const BillingGuard = {
    PUB_KEY_WOMPI: 'pub_test_Q5YDA9nmBDCcb4mqzB8S9B69YreS78uG',

    // Inyección autónoma de notificaciones in-app
    _notificar: function(mensaje, esError = false) {
        let toast = document.getElementById('toast-billing-guard');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-billing-guard';
            toast.style.cssText = 'position: fixed; bottom: 25px; left: 50%; transform: translateX(-50%) translateY(20px); background: rgba(18, 18, 24, 0.95); backdrop-filter: blur(12px); border-radius: 12px; padding: 10px 18px; font-size: 11.5px; font-weight: 700; color: #ffffff; z-index: 1000000; box-shadow: 0 8px 25px rgba(0,0,0,0.8); transition: transform 0.25s ease, opacity 0.25s ease; opacity: 0; pointer-events: none; text-align: center; max-width: 90%; box-sizing: border-box;';
            document.body.appendChild(toast);
        }

        toast.style.borderColor = esError ? '#ff4444' : 'var(--naranja, #ff6b00)';
        toast.style.borderWidth = '1px';
        toast.style.borderStyle = 'solid';
        toast.textContent = mensaje;
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';

        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
        }, 3500);
    },

    verificarEstadoCuota: function(controlFacturacion, contenedorAlertaId) {
        const ctrl = controlFacturacion || { facturas_emitidas_mes: 0, facturas_cupo_gratis: 1300, facturas_prepago_saldo: 0 };

        const emitidas = Number(ctrl.facturas_emitidas_mes) || 0;
        const gratis = Number(ctrl.facturas_cupo_gratis) || 1300;
        const saldoPrepago = Number(ctrl.facturas_prepago_saldo) || 0;
        const restantesGratis = Math.max(0, gratis - emitidas);

        const contenedor = document.getElementById(contenedorAlertaId);

        // Caso 1: Saldo prepago activo
        if (saldoPrepago > 0) {
            if (contenedor) {
                contenedor.innerHTML = `<span class="badge-saldo-facturas" style="background: rgba(0,255,100,0.15); color: #00ff64; border: 1px solid rgba(0,255,100,0.3); padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 800; font-family: monospace;">SALDO DISPONIBLE: ${saldoPrepago.toLocaleString()} facturas</span>`;
                contenedor.style.display = 'block';
            }
            return { bloqueado: false, saldo: saldoPrepago };
        }

        // Caso 2: Bloqueo Total por agotamiento de cuota
        if (emitidas >= gratis && saldoPrepago <= 0) {
            this.abrirModalPlanesFacturas(true);
            return { bloqueado: true, saldo: 0 };
        }

        // Caso 3: Zona Crítica (Restan menos de 50 facturas)
        if (emitidas >= 1250) {
            if (contenedor) {
                contenedor.innerHTML = `
                    <div style="background: rgba(255,68,68,0.18); border: 1px solid #ff4444; color: white; padding: 8px 12px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px;">
                        <span>Atencion: Restan <b>${restantesGratis}</b> facturas del cupo libre.</span>
                        <button type="button" onclick="window.BillingGuard.abrirModalPlanesFacturas(false)" style="background: #ff4444; color: white; border: none; border-radius: 8px; padding: 5px 10px; font-weight: bold; cursor: pointer; text-transform: uppercase; font-size: 10px;">Recargar</button>
                    </div>
                `;
                contenedor.style.display = 'block';
            }
            return { bloqueado: false, saldo: restantesGratis };
        }

        // Caso 4: Zona Preventiva (Superadas las 1.000 facturas)
        if (emitidas >= 1000) {
            if (contenedor) {
                contenedor.innerHTML = `
                    <div style="background: rgba(255,107,0,0.15); border: 1px solid var(--naranja, #ff6b00); color: white; padding: 8px 12px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px;">
                        <span>Umbral superado: Restan <b>${restantesGratis}</b> facturas libres.</span>
                        <button type="button" onclick="window.BillingGuard.abrirModalPlanesFacturas(false)" style="background: var(--naranja, #ff6b00); color: white; border: none; border-radius: 8px; padding: 5px 10px; font-weight: bold; cursor: pointer; text-transform: uppercase; font-size: 10px;">Ver Planes</button>
                    </div>
                `;
                contenedor.style.display = 'block';
            }
            return { bloqueado: false, saldo: restantesGratis };
        }

        // Zona Normal
        if (contenedor) {
            contenedor.innerHTML = `<span style="font-size: 10px; color: #777; font-family: monospace;">Facturas disponibles: ${restantesGratis} / ${gratis}</span>`;
            contenedor.style.display = 'block';
        }
        return { bloqueado: false, saldo: restantesGratis };
    },

    abrirModalPlanesFacturas: function(forzadoBloqueo = false) {
        let modal = document.getElementById('modal-planes-facturas');
        if (!modal) {
            this._inyectarDOMModal();
            modal = document.getElementById('modal-planes-facturas');
        }

        const btnCerrar = modal.querySelector('.btn-cerrar-modal-billing');
        if (forzadoBloqueo && btnCerrar) {
            btnCerrar.style.display = 'none';
        } else if (btnCerrar) {
            btnCerrar.style.display = 'block';
        }

        modal.style.display = 'flex';
    },

    cerrarModal: function() {
        const modal = document.getElementById('modal-planes-facturas');
        if (modal) modal.style.display = 'none';
    },

   comprarPaquete: function(cantFacturas, valorCop, idNegocio) {
        const tenant = idNegocio || window.idNegocioLogueado || localStorage.getItem('geokatu_active_uid');
        if (!tenant) return this._notificar("Error de sesion: Terminal no autenticada.", true);

        const paisComercio = localStorage.getItem(`geokatu_pais_${tenant}`) || window.datosTienda?.pais || "COL";
        if (paisComercio === 'VEN') {
            return this._notificar("Para recargas de cupo en Venezuela, contacta directamente a soporte administrativo.", false);
        }

        if (typeof WidgetCheckout === 'undefined') {
            return this._notificar("Pasarela no disponible fuera de linea.", true);
        }


        const checkout = new WidgetCheckout({
            currency: 'COP',
            amountInCents: valorCop * 100,
            reference: `FACT_PAQ_${tenant}_${cantFacturas}_${Date.now()}`,
            publicKey: BillingGuard.PUB_KEY_WOMPI
        });

        checkout.open(async (resultado) => {
            const tx = resultado.transaction;
            if (tx && tx.status === 'APPROVED') {
                try {
                    if (window.GeokatuDB && window.GeokatuDB.AdminService) {
                        const ctrlActual = window.datosTienda?.facturacion_control || {};
                        const saldoPrevio = Number(ctrlActual.facturas_prepago_saldo || 0);
                        
                        await window.GeokatuDB.AdminService.actualizarNegocio(tenant, {
                            facturacion_control: {
                                ...ctrlActual,
                                facturas_prepago_saldo: saldoPrevio + cantFacturas,
                                ultimo_pago_ref: tx.id || `TX_${Date.now()}`,
                                fecha_ultimo_pago: new Date().toISOString()
                            }
                        });
                    }
                    BillingGuard._notificar(`Acreditacion exitosa: ${cantFacturas.toLocaleString()} facturas activadas.`);
                    BillingGuard.cerrarModal();
                    setTimeout(() => window.location.reload(), 1200);
                } catch (errSync) {
                    console.error("[BillingGuard] Error en asiento de cuota:", errSync);
                    BillingGuard._notificar("Pago recibido. Contacta soporte para la conciliacion manual.", true);
                }
            }
        });
    },

    _inyectarDOMModal: function() {
        const div = document.createElement('div');
        div.id = 'modal-planes-facturas';
        div.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); z-index:999999; display:flex; align-items:center; justify-content:center; padding:15px; box-sizing:border-box;';
        div.innerHTML = `
            <div style="background: #141418; border: 1px solid var(--naranja, #ff6b00); border-radius: 20px; max-width: 440px; width: 100%; padding: 22px; position: relative; box-shadow: 0 15px 40px rgba(0,0,0,0.9); box-sizing: border-box;">
                <button type="button" class="btn-cerrar-modal-billing" onclick="window.BillingGuard.cerrarModal()" style="position: absolute; top: 15px; right: 15px; background: rgba(255,255,255,0.08); border: none; color: white; width: 28px; height: 28px; border-radius: 50%; cursor: pointer;">✕</button>
                <h3 style="color: var(--naranja, #ff6b00); margin: 0 0 4px 0; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px;">Recarga de Cuota POS</h3>
                <p style="color: #888; font-size: 11px; margin: 0 0 16px 0;">Planes prepago directos sin suscripciones recurrentes.</p>

                <div style="display: grid; grid-template-columns: 1fr; gap: 10px;">
                    <div onclick="window.BillingGuard.comprarPaquete(1500, 29000)" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                        <div>
                            <strong style="color: white; font-size: 13px;">Paquete Basico</strong>
                            <span style="display: block; color: #aaa; font-size: 11px; font-family: monospace;">1.500 facturas POS</span>
                        </div>
                        <span style="color: #00ff64; font-weight: 900; font-size: 14px; font-family: monospace;">$ 29.000</span>
                    </div>

                    <div onclick="window.BillingGuard.comprarPaquete(5000, 59000)" style="background: rgba(255,107,0,0.12); border: 1px solid var(--naranja, #ff6b00); border-radius: 12px; padding: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                        <div>
                            <span style="background: var(--naranja, #ff6b00); color: white; font-size: 8.5px; font-weight: 900; padding: 2px 6px; border-radius: 6px; text-transform: uppercase;">Recomendado</span>
                            <strong style="color: white; font-size: 13px; display: block; margin-top: 2px;">Paquete Comercial</strong>
                            <span style="display: block; color: #aaa; font-size: 11px; font-family: monospace;">5.000 facturas POS</span>
                        </div>
                        <span style="color: #00ff64; font-weight: 900; font-size: 14px; font-family: monospace;">$ 59.000</span>
                    </div>

                    <div onclick="window.BillingGuard.comprarPaquete(12000, 99000)" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                        <div>
                            <strong style="color: white; font-size: 13px;">Paquete Mayorista</strong>
                            <span style="display: block; color: #aaa; font-size: 11px; font-family: monospace;">12.000 facturas POS</span>
                        </div>
                        <span style="color: #00ff64; font-weight: 900; font-size: 14px; font-family: monospace;">$ 99.000</span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(div);
    }
};

window.BillingGuard = BillingGuard;


