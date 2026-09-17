/**
 * GEOKATU BILLING GUARD
 * Control preventivo de cuota fiscal y pasarela prepago Wompi
 */
export const BillingGuard = {
    PUB_KEY_WOMPI: 'pub_test_Q5YDA9nmBDCcb4mqzB8S9B69YreS78uG', // Reemplazar por llave de producción al desplegar

    verificarEstadoCuota: function(controlFacturacion, contenedorAlertaId) {
        if (!controlFacturacion) return { bloqueado: false };

        const emitidas = Number(controlFacturacion.facturas_emitidas_mes) || 0;
        const gratis = Number(controlFacturacion.facturas_cupo_gratis) || 1300;
        const saldoPrepago = Number(controlFacturacion.facturas_prepago_saldo) || 0;
        const restantesGratis = Math.max(0, gratis - emitidas);

        const contenedor = document.getElementById(contenedorAlertaId);

        // Caso 1: Saldo prepago comprado activo (Silencio operativo)
        if (saldoPrepago > 0) {
            if (contenedor) {
                contenedor.innerHTML = `<span class="badge-saldo-facturas" style="background: rgba(0,255,100,0.15); color: #00ff64; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 800;">⚡ Saldo: ${saldoPrepago.toLocaleString()} facturas</span>`;
                contenedor.style.display = 'block';
            }
            return { bloqueado: false, saldo: saldoPrepago };
        }

        // Caso 2: Bloqueo Total (1.300 alcanzadas sin saldo)
        if (emitidas >= gratis && saldoPrepago <= 0) {
            this.abrirModalPlanesFacturas(true);
            return { bloqueado: true, saldo: 0 };
        }

        // Caso 3: Zona Roja (1.251 a 1.299 facturas)
        if (emitidas >= 1250) {
            if (contenedor) {
                contenedor.innerHTML = `
                    <div style="background: rgba(255,68,68,0.2); border: 1px solid #ff4444; color: white; padding: 8px 12px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px;">
                        <span>⚠️ Quedan <b>${restantesGratis}</b> facturas libres.</span>
                        <button type="button" onclick="window.BillingGuard.abrirModalPlanesFacturas(false)" style="background: #ff4444; color: white; border: none; border-radius: 8px; padding: 4px 8px; font-weight: bold; cursor: pointer;">Recargar</button>
                    </div>
                `;
                contenedor.style.display = 'block';
            }
            return { bloqueado: false, saldo: restantesGratis };
        }

        // Caso 4: Zona Ámbar (1.000 a 1.250 facturas)
        if (emitidas >= 1000) {
            if (contenedor) {
                contenedor.innerHTML = `
                    <div style="background: rgba(255,107,0,0.15); border: 1px solid var(--naranja); color: white; padding: 8px 12px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px;">
                        <span>🔥 Superaste 1.000 facturas. Restan <b>${restantesGratis}</b> libres.</span>
                        <button type="button" onclick="window.BillingGuard.abrirModalPlanesFacturas(false)" style="background: var(--naranja); color: white; border: none; border-radius: 8px; padding: 4px 8px; font-weight: bold; cursor: pointer;">Ver Planes</button>
                    </div>
                `;
                contenedor.style.display = 'block';
            }
            return { bloqueado: false, saldo: restantesGratis };
        }

        // Zona Verde (1 a 999 facturas)
        if (contenedor) {
            contenedor.innerHTML = `<span style="font-size: 10px; color: #777;">Facturas libres: ${restantesGratis} / ${gratis}</span>`;
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
            btnCerrar.style.display = 'none'; // No se puede cerrar si ya no tiene cupo
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
        const tenant = idNegocio || localStorage.getItem('geokatu_active_uid');
        if (!tenant) return alert("Sesión inválida.");

        if (typeof WidgetCheckout === 'undefined') {
            return alert("Error cargando pasarela de pagos. Verifica tu conexión.");
        }

        const checkout = new WidgetCheckout({
            currency: 'COP',
            amountInCents: valorCop * 100,
            reference: `FACT_PAQ_${tenant}_${cantFacturas}_${Date.now()}`,
            publicKey: this.PUB_KEY_WOMPI
        });

        checkout.open((resultado) => {
            const tx = resultado.transaction;
            if (tx && tx.status === 'APPROVED') {
                alert(`🎉 ¡Pago aprobado! Se han acreditado ${cantFacturas.toLocaleString()} facturas a tu saldo.`);
                this.cerrarModal();
                window.location.reload();
            }
        });
    },

    _inyectarDOMModal: function() {
        const div = document.createElement('div');
        div.id = 'modal-planes-facturas';
        div.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); backdrop-filter:blur(8px); z-index:999999; display:flex; align-items:center; justify-content:center; padding:15px;';
        div.innerHTML = `
            <div style="background: #111116; border: 1px solid var(--naranja); border-radius: 20px; max-width: 440px; width: 100%; padding: 22px; position: relative; box-shadow: 0 15px 40px rgba(0,0,0,0.9); box-sizing: border-box;">
                <button type="button" class="btn-cerrar-modal-billing" onclick="window.BillingGuard.cerrarModal()" style="position: absolute; top: 15px; right: 15px; background: rgba(255,255,255,0.1); border: none; color: white; width: 28px; height: 28px; border-radius: 50%; cursor: pointer;">✕</button>
                <h3 style="color: var(--naranja); margin: 0 0 4px 0; font-size: 16px; text-transform: uppercase;">Recarga de Facturas POS</h3>
                <p style="color: #888; font-size: 11px; margin: 0 0 16px 0;">Sin cláusulas ni suscripciones forzadas. Compra paquetes según tu ritmo de venta.</p>

                <div style="display: grid; grid-template-columns: 1fr; gap: 10px;">
                    <div onclick="window.BillingGuard.comprarPaquete(1500, 29000)" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                        <div>
                            <strong style="color: white; font-size: 13px;">Paquete Básico</strong>
                            <span style="display: block; color: #aaa; font-size: 11px;">1.500 facturas POS</span>
                        </div>
                        <span style="color: #00ff64; font-weight: 900; font-size: 14px;">$29.000</span>
                    </div>

                    <div onclick="window.BillingGuard.comprarPaquete(5000, 59000)" style="background: rgba(255,107,0,0.12); border: 1px solid var(--naranja); border-radius: 12px; padding: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; box-shadow: 0 4px 15px rgba(255,107,0,0.2);">
                        <div>
                            <span style="background: var(--naranja); color: white; font-size: 8px; font-weight: 900; padding: 2px 6px; border-radius: 6px; text-transform: uppercase;">Más Vendido</span>
                            <strong style="color: white; font-size: 13px; display: block; margin-top: 2px;">Paquete Comercio</strong>
                            <span style="display: block; color: #aaa; font-size: 11px;">5.000 facturas POS</span>
                        </div>
                        <span style="color: #00ff64; font-weight: 900; font-size: 14px;">$59.000</span>
                    </div>

                    <div onclick="window.BillingGuard.comprarPaquete(12000, 99000)" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                        <div>
                            <strong style="color: white; font-size: 13px;">Paquete Mayorista</strong>
                            <span style="display: block; color: #aaa; font-size: 11px;">12.000 facturas POS</span>
                        </div>
                        <span style="color: #00ff64; font-weight: 900; font-size: 14px;">$99.000</span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(div);
    }
};

window.BillingGuard = BillingGuard;


