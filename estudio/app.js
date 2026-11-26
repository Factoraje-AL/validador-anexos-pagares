/* Interfaz del llenado de Datos. La lectura de los documentos la hace la función "estudio-leer" de Supabase (IA);
   las comprobaciones y el Excel los hace motor.js en este navegador. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const M = window.Motor;
  const AUTH = { url: 'https://hwuxlnhwyewrheveazvy.supabase.co', key: 'sb_publishable_wbZAFoV5kE8_9wtOScZwgA_X-mFuqe3' };   // llave pública; la de la IA vive solo en Supabase
  // En vista previa y pruebas locales no hay cuenta ni IA: el sitio queda abierto y se puede cargar un ejemplo ficticio.
  const LOCAL = /claude|anthropic|^localhost$|^127\.0\.0\.1$/i.test(location.hostname);
  const MAX_PAGINAS = 80, MAX_DETALLE = 14;
  let sb = null;
  const state = { archivos: [], paginas: [], estudio: null, actual: 0, plantilla: null, seq: 0, forzar: false };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parseNum = s => { const n = Number(String(s).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
  const msg = (id, text, cls) => { const e = $(id); e.textContent = text || ''; e.className = 'msg grow' + (cls ? ' ' + cls : ''); };
  const loadScript = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('No cargó ' + src)); document.head.appendChild(s); });

  /* ---------- 1. documentos ---------- */
  function chips() {
    $('chips').innerHTML = state.archivos.map((f, i) => `<span class="chip"><span>${esc(f.name)}</span><button type="button" data-i="${i}" aria-label="Quitar ${esc(f.name)}">×</button></span>`).join('');
    $('leer').disabled = !state.archivos.length;
  }
  function addFiles(list) {
    for (const f of list) if (/pdf$|^image\//i.test(f.type) || /\.pdf$/i.test(f.name)) state.archivos.push(f);
    chips(); msg('msg1', '');
  }
  $('files').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  $('chips').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) { state.archivos.splice(+b.dataset.i, 1); chips(); } });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));

  const progreso = p => { $('bar').hidden = p == null; if (p != null) $('bar').firstElementChild.style.width = Math.round(p * 100) + '%'; };
  function aJpeg(canvas, ancho, calidad) {
    const k = Math.min(1, ancho / canvas.width), c = document.createElement('canvas');
    c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', calidad);
  }
  /* Convierte cada página en: texto (si el PDF es digital), una miniatura para ubicar los estados y una imagen grande para leer cifras. */
  async function paginar() {
    const out = [];
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '../lib/pdf.worker.min.js';
    for (const f of state.archivos) {
      if (/^image\//.test(f.type)) {
        const img = await createImageBitmap(f), c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
        out.push({ archivo: f.name, n: 1, texto: '', mini: aJpeg(c, 560, .6), grande: aJpeg(c, 1700, .78) });
        continue;
      }
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
      for (let n = 1; n <= pdf.numPages; n++) {
        if (out.length >= MAX_PAGINAS) throw new Error('Son más de ' + MAX_PAGINAS + ' páginas. Sube solo los estados financieros y sus relaciones analíticas.');
        const page = await pdf.getPage(n), base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 1700 / Math.max(base.width, base.height) });
        const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const tc = await page.getTextContent();
        let texto = '', y = null;
        for (const it of tc.items) { if (y != null && Math.abs(it.transform[5] - y) > 2) texto += '\n'; texto += it.str + ' '; y = it.transform[5]; }
        out.push({ archivo: f.name, n, texto: texto.trim(), mini: aJpeg(c, 560, .6), grande: aJpeg(c, 1700, .78) });
        progreso(.05 + .35 * out.length / Math.max(out.length + 1, pdf.numPages));
      }
    }
    return out;
  }
  const b64 = d => d.slice(d.indexOf(',') + 1);
  async function ia(body) {
    if (!sb) throw new Error('La lectura con IA no está disponible en la vista previa. Usa "Cargar ejemplo ficticio" para ver el flujo.');
    const { data, error } = await sb.functions.invoke('estudio-leer', { body });
    if (error) {
      let detalle = error.message || '';
      try { const j = await error.context.json(); if (j && j.error) detalle = j.error; } catch (e) { /* sin detalle */ }
      throw new Error(detalle || 'No respondió el servicio de lectura.');
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }
  $('leer').addEventListener('click', async () => {
    $('leer').disabled = true; msg('msg1', 'Preparando las páginas…'); progreso(.03);
    try {
      state.paginas = await paginar();
      let idx = state.paginas.map((_, i) => i);
      if (idx.length > 6) {                                   // documentos largos: primero se ubican los estados con miniaturas
        msg('msg1', 'Ubicando el balance y el estado de resultados entre ' + idx.length + ' páginas…'); progreso(.45);
        const u = await ia({ accion: 'ubicar', paginas: state.paginas.map((p, i) => ({ i, texto: p.texto.slice(0, 500), img: b64(p.mini) })) });
        idx = (u.paginas || []).map(Number).filter(i => state.paginas[i]).slice(0, MAX_DETALLE);
        if (!idx.length) throw new Error('No encontré un balance general ni un estado de resultados en los archivos.');
      }
      msg('msg1', 'Leyendo cuentas e importes de ' + idx.length + ' página' + (idx.length > 1 ? 's' : '') + '…'); progreso(.65);
      const r = await ia({ accion: 'extraer', catalogo: M.CATALOGO.map(c => ({ fila: c.fila, renglon: c.seccion + ' / ' + c.etiqueta })),
        paginas: idx.map(i => ({ i, texto: state.paginas[i].texto.slice(0, 6000), img: b64(state.paginas[i].grande) })) });
      await cargarEstudio(r);
      msg('msg1', 'Listo: ' + state.estudio.periodos.length + ' periodo(s) leídos. Revisa las cuentas abajo.', 'good');
    } catch (e) { msg('msg1', e.message || String(e), 'bad'); }
    progreso(null); $('leer').disabled = !state.archivos.length;
  });

  /* ---------- memoria del cliente y reglamento ---------- */
  async function consultar(tabla, filtro) {
    if (!sb) return [];
    try { let q = sb.from(tabla).select('*'); if (filtro) q = q.eq(filtro[0], filtro[1]); const { data, error } = await q; return error ? [] : (data || []); } catch (e) { return []; }
  }
  /* Orden de autoridad: lo que un analista ya confirmó para este cliente > el reglamento de la casa > la propuesta de la IA. */
  async function aplicarCriterios(est) {
    const cliente = M.clave(est.empresa);
    const [mem, reglas] = await Promise.all([cliente ? consultar('estudio_memoria', ['cliente', cliente]) : [], consultar('estudio_criterios')]);
    const m = new Map(mem.map(r => [r.cuenta, r])), g = new Map(reglas.map(r => [r.cuenta, r]));
    for (const p of est.periodos) for (const c of p.cuentas) {
      const k = M.clave(c.nombre), a = m.get(k), b = g.get(k);
      if (a) Object.assign(c, { fila: a.fila, resta: !!a.resta, origen: 'memoria', confianza: 'alta', motivo: 'Confirmado antes para este cliente' });
      else if (b) Object.assign(c, { fila: b.fila, origen: 'regla', confianza: 'alta', motivo: b.nota || 'Reglamento de la casa' });
    }
  }
  async function cargarEstudio(r) {
    const periodos = (r.periodos || []).filter(p => p && p.fecha_cierre).sort((a, b) => a.fecha_cierre.localeCompare(b.fecha_cierre)).slice(-4);
    if (!periodos.length) throw new Error('No se pudo leer ningún periodo.');
    for (const p of periodos) {
      p.etiqueta = p.etiqueta || p.fecha_cierre.slice(0, 7);
      p.meses = Number(p.meses) || Number(p.fecha_cierre.slice(5, 7));
      p.totales = p.totales || {};
      p.cuentas = (p.cuentas || []).map(c => ({ id: ++state.seq, nombre: String(c.nombre || '').trim(), importe: Math.abs(Number(c.importe) || 0), resta: !!c.resta || Number(c.importe) < 0,
        fila: M.FILAS.has(Number(c.fila)) ? Number(c.fila) : null, estado: c.estado === 'resultados' ? 'resultados' : 'balance', origen: 'ia',
        confianza: ['alta', 'media', 'baja'].includes(c.confianza) ? c.confianza : 'media', motivo: c.motivo || '', pagina: c.pagina, confirmado: false }));
    }
    state.estudio = { empresa: r.empresa || '', periodos }; state.actual = periodos.length - 1;
    await aplicarCriterios(state.estudio);
    $('empresa').value = state.estudio.empresa;
    $('paso2').hidden = $('paso3').hidden = false; pintar();
    $('paso2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 2. revisión ---------- */
  const OPCIONES = (() => {
    const g = {}; for (const c of M.CATALOGO) (g[c.seccion + ' · ' + c.grupo] = g[c.seccion + ' · ' + c.grupo] || []).push(c);
    return '<option value="">Elige el renglón…</option>' + Object.keys(g).map(k => `<optgroup label="${esc(k)}">${g[k].map(c => `<option value="${c.fila}">${esc(c.etiqueta)}</option>`).join('')}</optgroup>`).join('');
  })();
  const enDuda = c => Number(c.importe) !== 0 && (c.fila == null || (c.origen === 'ia' && c.confianza === 'baja' && !c.confirmado));
  function revisar(p) {
    const cs = M.comprobar(p), dudas = p.cuentas.filter(c => c.fila != null && enDuda(c));
    cs.splice(1, 0, { id: 'dudas', titulo: 'Dudas resueltas', ok: !dudas.length, detalle: dudas.length ? dudas.length + ' cuenta(s) esperan tu confirmación' : 'Listo' });
    return cs;
  }
  /* Las preguntas (cuentas sin renglón o en duda) siempre bloquean. Un estado del cliente que no cuadra se puede generar
     si el analista lo pide: la diferencia queda visible en las celdas de cuadre de la propia hoja Datos. */
  const ARITMETICA = id => id === 'balance' || id === 'resultados' || id.startsWith('vs_');
  const fallas = () => state.estudio ? state.estudio.periodos.flatMap(p => revisar(p).filter(c => !c.ok).map(c => c.id)) : ['sin'];
  const todoOk = () => { const f = fallas(); return !f.length || (state.forzar && f.every(ARITMETICA)); };
  function decidir(claveCuenta, fila, etiqueta) {
    for (const q of state.estudio.periodos) for (const o of q.cuentas) if (M.clave(o.nombre) === claveCuenta) Object.assign(o, { fila, origen: 'tu', confirmado: true, motivo: etiqueta || '' });
  }
  function pintarPreguntas() {
    const g = new Map();
    for (const p of state.estudio.periodos) for (const c of p.cuentas) if (enDuda(c)) {
      const k = M.clave(c.nombre); if (!g.has(k)) g.set(k, { k, nombre: c.nombre, motivo: c.motivo, fila: c.fila, pagina: c.pagina, importes: [] });
      g.get(k).importes.push(p.etiqueta + ': ' + money(c.importe));
    }
    $('preguntas').innerHTML = g.size ? [...g.values()].map(q => `<div class="q" data-k="${esc(q.k)}"><b>¿Dónde va "${esc(q.nombre)}"?</b>
        <small>${esc(q.importes.join(' · '))}</small>${q.motivo ? `<small>${esc(q.motivo)}</small>` : ''}
        <select>${OPCIONES}</select>
        <div class="row">${q.fila != null ? '<button class="primary" data-a="ok" type="button">Confirmar la propuesta</button>' : ''}${state.paginas[q.pagina] ? `<button data-a="ver" data-p="${q.pagina}" type="button">Ver página</button>` : ''}</div></div>`).join('')
      : '<div class="qok">Sin preguntas pendientes: todas las cuentas tienen renglón.</div>';
    for (const d of $('preguntas').querySelectorAll('.q')) { const q = g.get(d.dataset.k); d.querySelector('select').value = q.fila == null ? '' : String(q.fila); }
  }
  $('preguntas').addEventListener('change', e => { const d = e.target.closest('.q'); if (d && e.target.value) { decidir(d.dataset.k, Number(e.target.value)); pintar(); } });
  $('preguntas').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b) return; const d = b.closest('.q');
    if (b.dataset.a === 'ok') { decidir(d.dataset.k, Number(d.querySelector('select').value)); pintar(); }
    else { const pg = state.paginas[+b.dataset.p]; $('visor-t').textContent = pg.archivo + ' · página ' + pg.n; $('visor-img').src = pg.grande; $('visor').showModal(); }
  });
  $('forzar').addEventListener('change', e => { state.forzar = e.target.checked; pintarChecks(); });
  const TAGS = { memoria: ['mem', 'Memoria del cliente'], regla: ['regla', 'Reglamento'], tu: ['tu', 'Elegido por ti'] };
  function pintar() {
    const est = state.estudio, p = est.periodos[state.actual];
    $('tabs').innerHTML = est.periodos.map((q, i) => `<button class="tab" role="tab" type="button" data-i="${i}" aria-selected="${i === state.actual}"><i class="dot ${revisar(q).every(c => c.ok) ? 'ok' : ''}"></i>${esc(q.etiqueta)}</button>`).join('');
    const t = p.totales;
    $('pmeta').innerHTML = `<label>Fecha de cierre <input type="date" data-m="fecha_cierre" value="${esc(p.fecha_cierre)}"></label>
      <label>Meses del periodo <input type="number" min="1" max="12" data-m="meses" value="${esc(p.meses)}"></label>
      ${[['activo', 'Total activo del estado'], ['pasivo', 'Total pasivo del estado'], ['capital', 'Capital del estado'], ['utilidad_neta', 'Utilidad neta del estado']].map(([k, l]) =>
        `<label>${l} <input inputmode="decimal" data-t="${k}" value="${t[k] == null ? '' : esc(t[k])}"></label>`).join('')}`;
    let html = '';
    for (const [estado, titulo] of [['balance', 'Balance general'], ['resultados', 'Estado de resultados']]) {
      const cs = p.cuentas.filter(c => c.estado === estado); if (!cs.length) continue;
      html += `<tr class="sec"><td colspan="4">${titulo}</td></tr>` + cs.map(c => {
        const tag = enDuda(c) ? ['duda', c.fila == null ? 'Sin renglón' : 'Confirma'] : (TAGS[c.origen] || ['', 'IA']);
        return `<tr data-id="${c.id}" class="${enDuda(c) ? 'duda' : ''}">
          <td><input class="name" data-f="nombre" value="${esc(c.nombre)}" style="width:100%;border-color:transparent;background:none;padding:2px 0"><span class="why">${esc(c.motivo)}</span></td>
          <td class="n">${c.resta ? '<span class="neg" title="Se resta dentro de su renglón">resta</span>' : ''}<input inputmode="decimal" data-f="importe" value="${money(c.importe)}"></td>
          <td><select data-f="fila">${OPCIONES}</select></td>
          <td class="act"><span class="tag ${tag[0]}">${tag[1]}</span>
            ${enDuda(c) && c.fila != null ? '<button class="pg" data-a="ok" type="button">Confirmar</button>' : ''}
            ${state.paginas[c.pagina] ? '<button class="pg" data-a="ver" type="button">Ver página</button>' : ''}
            <button class="pg" data-a="resta" type="button" title="Sumar o restar dentro del renglón">±</button><button class="pg" data-a="del" type="button" aria-label="Quitar cuenta">×</button></td></tr>`;
      }).join('');
    }
    $('rows').innerHTML = html;
    for (const tr of $('rows').querySelectorAll('tr[data-id]')) { const c = p.cuentas.find(x => x.id === +tr.dataset.id); tr.querySelector('select').value = c.fila == null ? '' : String(c.fila); }
    pintarPreguntas(); pintarChecks();
  }
  function pintarChecks() {
    const est = state.estudio, p = est.periodos[state.actual];
    $('checks').innerHTML = revisar(p).map(c => `<div class="check ${c.ok ? 'ok' : 'no'}"><b>${esc(c.titulo)}</b><small>${esc(c.detalle)}</small></div>`).join('') +
      M.avisos(est.periodos).map(a => `<div class="aviso">${esc(a)}</div>`).join('');
    est.periodos.forEach((q, i) => { const d = $('tabs').children[i]; if (d) d.querySelector('.dot').className = 'dot ' + (revisar(q).every(c => c.ok) ? 'ok' : ''); });
    const f = fallas(), soloAritmetica = f.length > 0 && f.every(ARITMETICA);
    $('forzarrow').hidden = !soloAritmetica; if (!soloAritmetica && state.forzar) { state.forzar = false; $('forzar').checked = false; }
    if (soloAritmetica) $('todas').open = true;
    const ok = todoOk(); $('generar').disabled = !ok;
    if (!ok) msg('msg3', soloAritmetica ? 'Los estados no cuadran: revisa los importes en rojo o marca la casilla para generar así.' : 'Falta responder las preguntas de la revisión.'); else if (/^(Falta|Los estados)/.test($('msg3').textContent)) msg('msg3', '');
  }
  $('tabs').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { state.actual = +b.dataset.i; pintar(); } });
  $('empresa').addEventListener('change', async () => { state.estudio.empresa = $('empresa').value.trim(); await aplicarCriterios(state.estudio); pintar(); });
  $('pmeta').addEventListener('change', e => {
    const p = state.estudio.periodos[state.actual], i = e.target;
    if (i.dataset.m) p[i.dataset.m] = i.dataset.m === 'meses' ? Number(i.value) : i.value;
    if (i.dataset.t) p.totales[i.dataset.t] = i.value.trim() === '' ? null : parseNum(i.value);
    pintarChecks();
  });
  $('rows').addEventListener('change', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const p = state.estudio.periodos[state.actual], c = p.cuentas.find(x => x.id === +tr.dataset.id), f = e.target.dataset.f;
    if (f === 'fila') {
      c.fila = e.target.value ? Number(e.target.value) : null; c.origen = 'tu'; c.confirmado = true; c.motivo = '';
      // la misma cuenta en los otros periodos toma la misma decisión, salvo que ya la hayas elegido a mano
      for (const q of state.estudio.periodos) for (const o of q.cuentas) if (o !== c && o.origen !== 'tu' && M.clave(o.nombre) === M.clave(c.nombre)) Object.assign(o, { fila: c.fila, origen: 'tu', confirmado: true, motivo: 'Igual que en ' + p.etiqueta });
      pintar();
    } else if (f === 'importe') { c.importe = Math.abs(parseNum(e.target.value)); e.target.value = money(c.importe); pintarChecks(); }
    else if (f === 'nombre') c.nombre = e.target.value.trim();
  });
  $('rows').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const p = state.estudio.periodos[state.actual], id = +b.closest('tr').dataset.id, c = p.cuentas.find(x => x.id === id);
    if (b.dataset.a === 'ok') { c.confirmado = true; pintar(); }
    else if (b.dataset.a === 'resta') { c.resta = !c.resta; pintar(); }
    else if (b.dataset.a === 'del') { p.cuentas = p.cuentas.filter(x => x.id !== id); pintar(); }
    else if (b.dataset.a === 'ver') { const pg = state.paginas[c.pagina]; $('visor-t').textContent = pg.archivo + ' · página ' + pg.n; $('visor-img').src = pg.grande; $('visor').showModal(); }
  });
  $('add').addEventListener('click', () => {
    const p = state.estudio.periodos[state.actual];
    p.cuentas.push({ id: ++state.seq, nombre: 'Cuenta nueva', importe: 0, resta: false, fila: null, estado: 'balance', origen: 'tu', confianza: 'alta', motivo: 'Agregada a mano', confirmado: true }); pintar();
  });

  /* ---------- 3. Excel ---------- */
  async function plantilla() {
    if (state.plantilla) return state.plantilla;
    if (sb) {
      const { data, error } = await sb.storage.from('estudio').download('plantilla.xlsx');
      if (!error && data) return (state.plantilla = await data.arrayBuffer());
    }
    $('tplrow').hidden = false;
    throw new Error('Elige la plantilla en blanco del Estudio (.xlsx) y vuelve a presionar Descargar.');
  }
  $('tpl').addEventListener('change', async e => { const f = e.target.files[0]; if (f) { state.plantilla = await f.arrayBuffer(); msg('msg3', 'Plantilla cargada.', 'good'); } });
  async function recordar(est) {
    const cliente = M.clave(est.empresa); if (!sb || !cliente) return;
    const filas = new Map();
    for (const p of est.periodos) for (const c of p.cuentas) if (c.fila != null && M.clave(c.nombre)) filas.set(M.clave(c.nombre), { cliente, cuenta: M.clave(c.nombre), fila: c.fila, resta: !!c.resta });
    try { await sb.from('estudio_memoria').upsert([...filas.values()], { onConflict: 'cliente,cuenta' }); } catch (e) { /* la memoria es una comodidad: si falla, el estudio ya se generó */ }
  }
  $('generar').addEventListener('click', async () => {
    if (!todoOk()) return;
    $('generar').disabled = true; msg('msg3', 'Generando el archivo…');
    try {
      const zip = await window.JSZip.loadAsync((await plantilla()).slice(0));
      const bytes = await M.llenar(zip, state.estudio);
      const a = document.createElement('a'), nombre = (state.estudio.empresa || 'CLIENTE').toUpperCase().replace(/[\\/:*?"<>|]+/g, ' ').trim();
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = 'ESTUDIO ' + nombre + '.xlsx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      await recordar(state.estudio);
      msg('msg3', 'Descargado: ' + a.download + '. Ábrelo en Excel; al abrir recalcula todas las hojas.', 'good');
    } catch (e) { msg('msg3', e.message || String(e), 'bad'); }
    $('generar').disabled = !todoOk();
  });

  /* ---------- ejemplo ficticio (solo en vista previa) ---------- */
  function ejemplo() {
    const c = (nombre, importe, fila, estado, extra) => Object.assign({ nombre, importe, fila, estado: estado || 'balance', confianza: 'alta', motivo: '' }, extra || {});
    const periodo = (fecha, meses, k, ult) => ({ etiqueta: fecha.slice(0, 4) + (meses < 12 ? ' (parcial)' : ''), fecha_cierre: fecha, meses,
      totales: { activo: 9300000 * k, pasivo: 5100000 * k, capital: 4200000 * k, utilidad_neta: 900000 * k },
      cuentas: [c('Bancos', 800000 * k, 19), c('Clientes', 3200000 * k, 22), c('Inventarios', 2500000 * k, 31), c('IVA acreditable', 400000 * k, 39),
        c('Deudores diversos', 300000 * k, 43), c('Maquinaria y equipo', 2600000 * k, 61), c('Equipo de cómputo', 300000 * k, 62), c('Depreciación acumulada', 900000 * k, 64),
        c('Depósitos en garantía', 100000 * k, 79), c('Proveedores', 2100000 * k, 93), c('Acreedores diversos', 600000 * k, ult ? null : 94, 'balance', ult ? { motivo: 'Incluye tarjetas de crédito según la relación analítica' } : null),
        c('Impuestos por pagar', 400000 * k, 95, 'balance', { confianza: ult ? 'baja' : 'alta', motivo: ult ? 'El nombre no dice si es ISR o IVA' : '' }), c('Préstamos bancarios LP', 2000000 * k, 107),
        c('Capital social', 500000 * k, 119), c('Resultado de ejercicios anteriores', 2800000 * k, 124), c('Resultado del ejercicio', 900000 * k, 125),
        c('Ventas', 14000000 * k, 134, 'resultados'), c('Devoluciones sobre ventas', 200000 * k, 135, 'resultados'), c('Costo de ventas', 9000000 * k, 140, 'resultados'),
        c('Gastos de administración', 2400000 * k, 146, 'resultados'), c('Gastos de venta', 900000 * k, 145, 'resultados'), c('Gastos financieros', 250000 * k, 156, 'resultados'),
        c('ISR', 350000 * k, 159, 'resultados')] });
    return { empresa: 'Comercializadora Ejemplo SA de CV', periodos: [periodo('2024-12-31', 12, 1), periodo('2025-12-31', 12, 1.2), periodo('2026-07-31', 7, .7, true)] };
  }
  $('demo').addEventListener('click', async () => { await cargarEstudio(ejemplo()); msg('msg1', 'Ejemplo ficticio cargado: no son datos de un cliente.', 'good'); });

  /* ---------- acceso ---------- */
  function gate(on) { document.body.classList.toggle('gated', on); $('gate').hidden = !on; }
  $('gate-form').addEventListener('submit', async e => {
    e.preventDefault(); $('g-err').textContent = ''; $('g-go').disabled = true;
    let r; try { r = await sb.auth.signInWithPassword({ email: $('g-email').value.trim(), password: $('g-pass').value }); } catch (err) { r = { error: err }; }
    $('g-go').disabled = false;
    if (r.error) { $('g-err').textContent = /invalid login/i.test(r.error.message || '') ? 'Correo o contraseña incorrectos.' : (r.error.message || 'No se pudo entrar.'); return; }
    $('g-pass').value = ''; gate(false); $('signout').hidden = false;
  });
  $('signout').addEventListener('click', async () => { try { await sb.auth.signOut(); } catch (e) { /* sin sesión */ } location.reload(); });
  (async function start() {
    if (LOCAL) { $('demo').hidden = false; return; }
    gate(true);
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js');
      sb = window.supabase.createClient(AUTH.url, AUTH.key);
      const { data } = await sb.auth.getSession();
      if (data && data.session) { gate(false); $('signout').hidden = false; }
      sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') gate(true); });
    } catch (e) { $('g-err').textContent = 'No se pudo conectar con el servicio de acceso. Revisa tu internet y recarga la página.'; }
  })();
})();
