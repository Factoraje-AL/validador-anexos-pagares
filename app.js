/* Interfaz del validador. Toda la lógica de reglas vive en engine.js. */
(function () {
  'use strict';
  const V = window.VAL, $ = id => document.getElementById(id);
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'validador-factoraje-catalogo-v1';
  const IDLE = 'Suelta aquí uno o varios archivos, o haz clic. PDF, Word, Excel, foto o texto.';

  const ANEXO_FIELDS = [
    ['fechaInicio', 'Fecha de inicio de disposición', 'date'], ['fechaMax', 'Fecha Máxima de Pago', 'date'], ['plazo', 'Plazo (días)', 'num'],
    ['valorNominal', 'Valor Nominal (moneda original)', 'money'], ['tipoCambio', 'Tipo de cambio (vacío si es en pesos)', 'num'], ['valorNominalTotal', 'Valor Nominal Total en Pesos', 'money'],
    ['aforoPct', '% de aforo', 'num'], ['aforo', 'Aforo ($)', 'money'], ['precioBase', 'Precio Base', 'money'],
    ['tasaPct', 'Tasa de Descuento (% mensual)', 'num'], ['descuento', 'Descuento', 'money'], ['ivaDescuento', 'IVA del Descuento', 'money'],
    ['comision', 'Comisión por Disposición ($)', 'money'], ['ivaComision', 'IVA de la Comisión', 'money'],
    ['precioDerechos', 'Precio de los Derechos de Crédito', 'money'], ['pagoRealizar', 'Pago a realizar en la Fecha Máxima', 'money'],
    ['fechaContratoApendice', 'Fecha del contrato citada en el Apéndice', 'date'], ['numOS', 'Obligados solidarios que aparecen (cuántos)', 'num'],
    ['facturas', 'Importes de las facturas del Apéndice (uno por línea)', 'area']
  ];
  const PAGARE_FIELDS = [['pagareCifra', 'Cifra del Pagaré (en número)', 'money'], ['pagareFecha', 'Fecha del Pagaré', 'date'], ['pagareVence', 'Fecha de vencimiento', 'date'], ['numAvales', 'Avales que trae el Pagaré (cuántos)', 'num']];
  const allFields = () => ANEXO_FIELDS.concat(PAGARE_FIELDS);

  /* anexos / pagares: [{ name, text, how }] · pairs: [{ a, p, ci, clash, fields, r }] · tab: 'resumen' o índice de pairs */
  const state = { cat: null, catInfo: '', demo: false, anexos: [], pagares: [], pairs: [], tab: 0, dataTouched: false, saved: [], fichas: {}, baseText: '', savedMsg: '', savedQ: '', pick: null, editing: null, fichaShown: null, factText: '' };

  /* ---------- campos (solo lectura) ---------- */
  function buildFields(host, defs) {
    host.innerHTML = defs.map(([k, label, type]) => type === 'area'
      ? `<label class="f wide">${esc(label)}<textarea id="f_${k}" readonly tabindex="-1"></textarea></label>`
      : `<label class="f">${esc(label)}<input id="f_${k}" type="text" readonly tabindex="-1"></label>`).join('');
  }
  function showFields(f) {
    allFields().forEach(([k, , type]) => {
      const v = f ? f[k] : undefined;
      $('f_' + k).value = v === null || v === undefined || v === '' ? '' : type === 'money' ? V.money(v).replace('$', '') : type === 'date' ? V.fmtDate(v) : v;
    });
  }

  /* ---------- catálogo ---------- */
  function loadCatalog(text, info, save) {
    const cat = V.parseCatalog(text);
    if (!cat.clientes.length) { $('catStatus').className = 'status bad'; $('catStatus').textContent = 'Ese archivo no trae fichas con el formato del catálogo ("## Cliente: ...").'; return false; }
    state.baseText = text; state.catInfo = info; applyCatalog();
    if (save) { try { localStorage.setItem(KEY, JSON.stringify({ text, info })); } catch (e) { /* sin almacenamiento: se pide de nuevo la próxima vez */ } }
    $('catStatus').className = 'status good';
    $('catStatus').textContent = `${cat.clientes.length} fichas cargadas · ${info}`;
    return true;
  }

  /* ---------- lectura de archivos (cualquier formato) ---------- */
  const scripts = {};
  const loadScript = src => scripts[src] || (scripts[src] = new Promise((ok, no) => {
    const el = document.createElement('script'); el.src = src; el.onload = ok;
    el.onerror = () => { delete scripts[src]; no(new Error('No cargó ' + src)); };
    document.head.appendChild(el);
  }));
  const abs = rel => new URL(rel, document.baseURI).href;
  let ocrWorker = null;
  async function ocr(image) {
    await loadScript('lib/ocr/tesseract.min.js');
    if (!ocrWorker) ocrWorker = await window.Tesseract.createWorker('spa', 1, { workerPath: abs('lib/ocr/ocr-worker.js'), corePath: abs('lib/ocr/'), langPath: abs('lib/ocr'), gzip: false, cacheMethod: 'none', workerBlobURL: false });
    return (await ocrWorker.recognize(image)).data.text;
  }
  const extOf = name => (name.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
  /* Devuelve { text, how } — how: 'texto' | 'ocr' */
  async function readAny(file, say) {
    const ext = extOf(file.name), type = file.type || '';
    if (ext === 'pdf' || type === 'application/pdf') {
      if (!window.pdfjsLib) throw new Error('No cargó el lector de PDF.');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      let text = '';
      for (let p = 1; p <= pdf.numPages; p++) {
        const tc = await (await pdf.getPage(p)).getTextContent();
        text += tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
      }
      if (text.replace(/\s/g, '').length >= 40) return { text, how: 'texto' };
      text = '';                                         // PDF escaneado: se lee la imagen de cada página
      for (let p = 1; p <= pdf.numPages; p++) {
        say(`${file.name}: es un escaneo, leyendo página ${p} de ${pdf.numPages}…`);
        const page = await pdf.getPage(p), vp = page.getViewport({ scale: 2 });
        const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        text += await ocr(cv) + '\n';
      }
      return { text, how: 'ocr' };
    }
    if (ext === 'docx') {
      await loadScript('lib/mammoth.browser.min.js');
      return { text: (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value, how: 'texto' };
    }
    if (['xlsx', 'xlsm', 'xls', 'ods'].includes(ext)) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      return { text: wb.SheetNames.map(n => window.XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: '  ', blankrows: false })).join('\n'), how: 'texto' };
    }
    if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(ext)) {
      say(`${file.name}: es una imagen, leyendo el texto…`);
      return { text: await ocr(file), how: 'ocr' };
    }
    if (ext === 'doc') throw new Error('El formato .doc antiguo no se puede leer. Guárdalo como .docx o PDF.');
    let text = await file.text();
    if ((text.slice(0, 4000).match(/[\u0000-\u0008�]/g) || []).length > 20) throw new Error(`No se puede leer un archivo .${ext || 'sin extensión'}. Guárdalo como PDF.`);
    if (ext === 'html' || ext === 'htm') text = new DOMParser().parseFromString(text, 'text/html').body.textContent || '';
    if (ext === 'rtf') text = text.replace(/\\'[0-9a-f]{2}/gi, '').replace(/\{\\\*[^{}]*\}/g, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
    return { text, how: 'texto' };
  }

  /* ---------- carga de documentos (varios a la vez) ---------- */
  const LIST = { Anexo: 'anexos', Pagare: 'pagares' }, WORD = { Anexo: ['Anexo', 'Anexos'], Pagare: ['Pagaré', 'Pagarés'] };
  function boxStatus(which, problems) {
    const docs = state[LIST[which]], st = $('st' + which);
    $('drop' + which).classList.toggle('done', docs.length > 0);
    $('del' + which).hidden = !docs.length;
    const ocr = docs.some(d => d.how === 'ocr');
    st.className = 'status ' + (problems && problems.length ? 'bad' : docs.length ? 'good' : '');
    st.textContent = (docs.length ? `${docs.length} ${WORD[which][docs.length > 1 ? 1 : 0]} cargado${docs.length > 1 ? 's' : ''}` + (ocr ? ' · alguno se leyó de imagen (OCR)' : '') : IDLE)
      + (problems && problems.length ? ' · No se cargó: ' + problems.join('; ') : '');
    const host = $('list' + which);
    host.innerHTML = docs.map((d, i) => `<span class="chip" title="${esc(d.name)}"><span>${esc(d.name)}</span><button type="button" data-i="${i}" aria-label="Quitar ${esc(d.name)}">×</button></span>`).join('');
    host.querySelectorAll('button').forEach(b => b.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (state.demo) leaveDemo(); else { state[LIST[which]].splice(+b.dataset.i, 1); boxStatus(which); }
      rebuild();
    }));
    host.onclick = e => { e.preventDefault(); e.stopPropagation(); };   // tocar una ficha no abre el selector de archivos
  }
  async function handleFiles(files, which) {
    files = Array.from(files || []); if (!files.length) return;
    if (state.demo) leaveDemo();
    const st = $('st' + which), problems = [], dudas = [];
    const say = t => { st.className = 'status'; st.textContent = t; };
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      say(`Leyendo ${i + 1} de ${files.length}: ${file.name}…`);
      try {
        const r = await readAny(file, say);
        if (r.text.replace(/\s/g, '').length < 40) throw new Error('no se encontró texto');
        if (/^##\s*Cliente:/m.test(r.text)) throw new Error('es el catálogo; cárgalo en la pestaña Catálogo');
        // primer paso: que cada documento esté en su caja
        const kind = V.docKind(r.text);
        if (kind && kind !== which) throw new Error(kind === 'Pagare' ? 'es un Pagaré: súbelo en la caja de Pagarés (Paso 2)' : 'es un Anexo: súbelo en la caja de Anexos (Paso 1)');
        if (!kind) dudas.push(file.name);
        const list = state[LIST[which]], doc = { name: file.name, text: r.text, how: r.how };
        const at = list.findIndex(d => d.name === file.name);
        if (at >= 0) list[at] = doc; else list.push(doc);          // mismo nombre = versión corregida, reemplaza
      } catch (e) { problems.push(`${file.name} (${e && e.message ? e.message : 'formato no soportado'})`); }
    }
    boxStatus(which, problems);
    if (dudas.length) $('st' + which).textContent += ` · No se pudo confirmar que ${dudas.length > 1 ? 'sean' : 'sea'} ${WORD[which][dudas.length > 1 ? 1 : 0]}: ${dudas.join(', ')}. Revisa que ${dudas.length > 1 ? 'estén' : 'esté'} en la caja correcta.`;
    rebuild();
  }
  function wireDrop(which) {
    const box = $('drop' + which), inp = $('file' + which);
    inp.addEventListener('change', () => { handleFiles(inp.files, which).then(() => { inp.value = ''; }); });
    ['dragenter', 'dragover'].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); box.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); box.classList.remove('over'); }));
    box.addEventListener('drop', e => { handleFiles(e.dataTransfer && e.dataTransfer.files, which); });
  }
  function wireDelete(which) {
    $('del' + which).addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();                     // el botón vive dentro de la caja: no debe abrir el selector de archivos
      if (state.demo) leaveDemo(); else { state[LIST[which]] = []; $('file' + which).value = ''; boxStatus(which); }
      rebuild();
    });
  }
  // soltar fuera de las cajas no debe abrir el archivo en el navegador
  ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => e.preventDefault()));

  /* ---------- emparejar cada Anexo con su Pagaré ---------- */
  const numFromName = n => { const m = n.replace(/\.[a-z0-9]+$/i, '').match(/(\d+)\D*$/); return m ? +m[1] : null; };
  function rebuild() {
    const cat = state.cat;
    const A = state.anexos.map(d => { const m = d.text.match(/A\s?N\s?E\s?X\s?O\s+A?\s*No\.?\s*(\d+)/i); return { d, ci: cat ? V.detectClient(cat, d.text) : -1, ex: V.extractFields(d.text, ''), num: m ? +m[1] : numFromName(d.name) }; });
    const P = state.pagares.map(d => ({ d, ci: cat ? V.detectClient(cat, d.text) : -1, ex: V.extractFields('', d.text), num: numFromName(d.name) }));
    const cand = [];
    A.forEach((a, i) => P.forEach((p, j) => {
      let s = 0;
      if (a.ci >= 0 && a.ci === p.ci) s += 4; else if (a.ci >= 0 && p.ci >= 0) s -= 3;
      if (a.num !== null && a.num === p.num) s += 3;
      if (a.ex.precioBase !== undefined && p.ex.pagareCifra !== undefined && Math.abs(a.ex.precioBase - p.ex.pagareCifra) < 0.01) s += 3;
      if (a.ex.fechaMax && a.ex.fechaMax === p.ex.pagareVence) s += 1;
      if (s >= 3 || (A.length === 1 && P.length === 1)) cand.push({ i, j, s });
    }));
    cand.sort((x, y) => y.s - x.s);
    const usedA = new Set(), usedP = new Set(), pairs = [];
    const mk = (a, p) => {
      const ci = a && a.ci >= 0 ? a.ci : p ? p.ci : -1;
      return { a: a ? a.d : null, p: p ? p.d : null, ci, num: a ? a.num : p.num, fields: Object.assign({}, a ? a.ex : {}, p ? p.ex : {}),
        clash: a && p && a.ci >= 0 && p.ci >= 0 && a.ci !== p.ci ? `El Anexo es de ${cat.clientes[a.ci].nombre} y el Pagaré parece de ${cat.clientes[p.ci].nombre}.` : '' };
    };
    cand.forEach(c => { if (usedA.has(c.i) || usedP.has(c.j)) return; usedA.add(c.i); usedP.add(c.j); pairs.push(mk(A[c.i], P[c.j])); });
    A.forEach((a, i) => { if (!usedA.has(i)) pairs.push(mk(a, null)); });
    P.forEach((p, j) => { if (!usedP.has(j)) pairs.push(mk(null, p)); });
    const nm = x => x.ci >= 0 ? cat.clientes[x.ci].nombre : 'zzz';
    pairs.sort((x, y) => nm(x).localeCompare(nm(y)) || (x.num || 0) - (y.num || 0));
    state.pairs = pairs;
    state.tab = pairs.length > 1 ? 'resumen' : 0;
    compute(); render();
  }
  function compute() {
    state.pairs.forEach(x => {
      x.r = state.cat && x.ci >= 0 ? V.validate({ cliente: state.cat.clientes[x.ci], factorante: state.cat.factorante, fechaFirma: $('fechaFirma').value, anexoText: x.a ? x.a.text.trim() : '', pagareText: x.p ? x.p.text.trim() : '', campos: x.fields }) : null;
    });
  }
  const shortName = n => n.replace(/,?\s+S\.?\s?(A\.?(\s?P\.?\s?I\.?)?|\s?DE\s+R\.?\s?L\.?)\s+DE\s+C\.?\s?V\.?$/i, '').replace(/\s+LLC$/i, '');
  const pairLabel = x => (x.ci >= 0 ? shortName(state.cat.clientes[x.ci].nombre) : 'Cliente no reconocido') + (x.num !== null && x.num !== undefined ? ' · ' + x.num : '');
  const TONE = { 'correcto': 'ok', 'confirmar': 'warn', 'incompleto': 'idle', 'no-firmable': 'bad' };
  const verdictText = r => ({
    'correcto': 'Todo coincide. Listo para firma.',
    'confirmar': `Sin errores. ${r.reviews} punto${r.reviews > 1 ? 's' : ''} por confirmar.`,
    'incompleto': `Sin errores hasta ahora. ${r.pending} punto${r.pending > 1 ? 's' : ''} sin revisar.`,
    'no-firmable': `${r.checks.some(k => k.campo === 'Contrato vigente a la fecha de inicio' && k.status === 'error') ? 'Contrato vencido, no firmar.' : 'No firmar.'} ${r.errors} error${r.errors > 1 ? 'es' : ''} material${r.errors > 1 ? 'es' : ''}.`
  }[r.veredicto]);

  /* ---------- ficha ---------- */
  function renderFicha(c) {
    $('fichaEmpty').hidden = !!c; $('fichaTitle').textContent = c ? c.nombre : 'Ficha de referencia';
    if (!c) { $('fichaMeta').textContent = ''; $('fichaBody').innerHTML = ''; $('fichaRules').innerHTML = ''; return; }
    $('fichaMeta').textContent = `Ficha extraída ${c.fechaExtraccion || 's/f'} · tasas vigentes al ${c.tasasVigente || 's/f'}`;
    const tasas = [30, 60, 90, 120].map(p => `${p} d: ${c.tasas[p] === null || c.tasas[p] === undefined ? 'no autorizado' : c.tasas[p].toFixed(2) + '%'}`).join(' · ');
    const cu = c.cuenta || {};
    $('fichaBody').innerHTML = [
      ['Contrato', `<b>${esc(c.contrato)}</b>firmado el ${esc(V.fmtDate(c.fechaContrato))}<span>${c.vencimientoContrato ? 'Vence el ' + esc(V.fmtDate(c.vencimientoContrato)) + (c.vencimientoCalculado ? ' (12 meses después de la firma)' : '') : 'Sin fecha de vencimiento'}</span>`],
      ['Factorado', `<b>${esc(c.nombre)}</b>${esc(c.rfc ? 'RFC ' + c.rfc : 'Sin RFC mexicano')}<span>${esc(c.domicilio)}</span>`],
      ...c.os.map(o => [`Obligado solidario · ${o.tipo === 'PM' ? 'persona moral' : 'persona física'}`, `<b>${esc(o.nombre)}</b><span>${esc(o.domicilio)}</span>${o.nota ? '<span class="status">' + esc(o.nota) + '</span>' : ''}`]),
      ['Firmantes del cliente', `<b>${esc(c.firmantes.join(' y '))}</b>`],
      ['Depositario', `<b>${esc((c.depositarios || []).join(' y ') || 'No viene en la ficha')}</b>`],
      ['Tasa de descuento', `<b>${esc(tasas)}</b>`],
      ['Cuenta del factorado', `<b>${esc(cu.banco || 'No aplica')}</b>Cuenta ${esc(cu.numero || '—')} · Sucursal ${esc(cu.sucursal || '—')}<span>CLABE ${esc(cu.clabe || '—')}</span>`]
    ].map(([t, h]) => `<div class="mini"><h3>${esc(t)}</h3>${h}</div>`).join('');
    const rules = c.reglas.concat(c.notaAvales);
    $('fichaRules').innerHTML = rules.length ? `<h3>Reglas especiales de este cliente (revísalas a mano)</h3><ul class="rules">${rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : '';
  }

  /* ---------- reporte ---------- */
  const PILL = { ok: '✓ OK', minor: '✓ OK · formato', review: '⚠ Revisar', error: '✗ Error', pending: '… Sin revisar', na: 'No aplica' };
  const docName = { anexo: 'Anexo', pagare: 'Pagaré', interno: 'Cuentas del Anexo' };
  function table(rows) {
    if (!rows.length) return '<div class="empty">Sin puntos en esta sección.</div>';
    return `<div class="tablebox"><table><thead><tr><th>Campo</th><th>Valor esperado (fuente)</th><th>Encontrado</th><th>Estatus</th></tr></thead><tbody>${rows.map(k =>
      `<tr class="s-${k.status}"><td class="c1">${esc(k.campo)}</td><td>${esc(k.esperado)}<span class="src">${esc(k.fuente)}</span></td><td>${esc(k.encontrado) || '—'}${k.nota ? `<span class="note">${esc(k.nota)}</span>` : ''}</td><td class="c4"><span class="pill p-${k.status}">${PILL[k.status]}</span></td></tr>`).join('')}</tbody></table></div>`;
  }
  const filesLine = x => `Anexo: ${x.a ? esc(x.a.name) : '<b class="tone-bad">falta</b>'} · Pagaré: ${x.p ? esc(x.p.name) : '<b class="tone-bad">falta</b>'}`;
  function renderTabs() {
    const host = $('dtabs'), n = state.pairs.length;
    host.hidden = n < 2;
    if (n < 2) { host.innerHTML = ''; return; }
    const btn = (key, label, tone, pct) => `<button type="button" class="dtab" data-tab="${key}"${String(state.tab) === String(key) ? ' aria-current="true"' : ''}>${tone ? `<i class="dot tone-${tone}"></i>` : ''}${esc(label)}${pct !== undefined ? ` <span>${pct}%</span>` : ''}</button>`;
    host.innerHTML = btn('resumen', `Resumen (${n})`) + state.pairs.map((x, i) => btn(i, pairLabel(x), x.r ? TONE[x.r.veredicto] : 'idle', x.r ? x.r.pct : undefined)).join('');
    host.querySelectorAll('.dtab').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab === 'resumen' ? 'resumen' : +b.dataset.tab; render(); }));
  }
  function render() {
    const body = $('reportBody'), detail = $('detailBody'), pairs = state.pairs;
    $('needCat').hidden = !!state.cat;
    renderTabs();
    const cur = state.tab === 'resumen' ? null : pairs[state.tab] || null;
    const c = cur && cur.ci >= 0 && state.cat ? state.cat.clientes[cur.ci] : null;
    // caja de cliente y pestaña Ficha
    const first = pairs.find(x => x.ci >= 0), fc = c || (first && state.cat ? state.cat.clientes[first.ci] : null);
    const picked = state.pick && state.cat ? state.cat.clientes.find(k => nkey(k.nombre) === nkey(state.pick)) : null;
    state.fichaShown = state.pick ? picked || null : fc;
    renderFicha(state.fichaShown);
    $('fichaEdit').hidden = !state.fichaShown;
    if (state.fichaShown && state.fichaShown.compartida) $('fichaMeta').textContent += ' · ficha compartida (editada aquí)';
    if (state.pick && !picked) { $('fichaTitle').textContent = state.pick; $('fichaEmpty').textContent = state.cat ? 'Este cliente está guardado, pero el catálogo cargado en esta computadora no trae su ficha. Carga el catálogo actualizado en la pestaña Catálogo.' : 'Carga el catálogo de fichas en esta computadora para ver la ficha de este cliente.'; }
    else $('fichaEmpty').textContent = 'Valida una disposición o elige un cliente guardado para ver su ficha.';
    $('savedDrop').hidden = !state.pick;
    const canSave = !!c, isSaved = canSave && state.saved.some(n => nkey(n) === nkey(c.nombre));
    $('saveCli').hidden = !canSave; $('saveCli').disabled = isSaved; $('saveCli').textContent = isSaved ? 'Cliente guardado' : 'Guardar cliente';
    if (!canSave) $('saveCliMsg').textContent = '';
    renderSaved();
    $('cliente').textContent = !pairs.length ? '—' : cur ? (c ? c.nombre : 'No reconocido') : `${pairs.length} disposiciones`;
    $('clienteHint').textContent = !state.cat ? 'Carga el catálogo de fichas.' : !pairs.length ? 'Se toma del Anexo y del Pagaré.' : cur ? (c ? 'Contrato ' + c.contrato + ' · tomado de los documentos.' : 'Ningún cliente del catálogo aparece en estos documentos.') : 'Cada una en su pestaña.';
    const folds = on => { $('dataBox').hidden = !on; $('detailBox').hidden = !on; };
    if (!pairs.length) { folds(false); detail.innerHTML = ''; showFields(null); body.innerHTML = `<div class="empty">${state.cat ? 'Suelta los Anexos y los Pagarés para ver el resultado. Puedes soltar varios a la vez.' : 'Carga el catálogo de fichas para empezar.'}</div>`; return; }

    if (!cur) {                                                     // ---- Resumen
      folds(false);
      const done = pairs.filter(x => x.r), bad = done.filter(x => x.r.veredicto === 'no-firmable').length, ok = done.filter(x => x.r.veredicto === 'correcto').length;
      body.innerHTML = `<div class="verdict ${bad ? 'tone-bad' : 'tone-ok'}">${pairs.length} disposiciones: ${ok} lista${ok === 1 ? '' : 's'} para firma, ${bad} con errores${pairs.length - ok - bad ? `, ${pairs.length - ok - bad} por revisar` : ''}.</div>
        <div class="issues">${pairs.map((x, i) => {
          const tone = x.r ? TONE[x.r.veredicto] : 'idle';
          return `<button type="button" class="sumrow issue ${tone === 'bad' ? '' : tone === 'warn' ? 'review' : tone === 'ok' ? 'okrow' : 'pending'}" data-tab="${i}">
            <span class="sumpct tone-${tone}">${x.r ? x.r.pct + '%' : '—'}</span>
            <span class="sumtxt"><span class="t">${esc(pairLabel(x))}</span><span class="tone-${tone}">${x.r ? esc(verdictText(x.r)) : 'Ningún cliente del catálogo aparece en estos documentos.'}</span><span class="status">${filesLine(x)}</span></span></button>`;
        }).join('')}</div>`;
      body.querySelectorAll('.sumrow').forEach(b => b.addEventListener('click', () => { state.tab = +b.dataset.tab; render(); }));
      return;
    }
    showFields(cur.fields);
    if (!cur.r) { folds(false); detail.innerHTML = ''; body.innerHTML = `<div class="verdict tone-idle">Cliente no reconocido.</div><div>Ningún cliente del catálogo aparece en estos documentos. Revisa que el catálogo esté actualizado.</div><div class="status">${filesLine(cur)}</div>`; return; }
    folds(true);
    const r = cur.r, tone = TONE[r.veredicto], C = 2 * Math.PI * 62;
    const by = d => r.checks.filter(k => k.doc === d);
    const card = k => `<div class="issue ${k.status}"><div class="where">${docName[k.doc]}</div><div class="t">${esc(k.campo)}</div>${k.status === 'pending' ? `<div class="status">${esc(k.nota)}</div>`
      : `<div class="cmp"><div><span>Debe decir</span>${esc(k.esperado) || '—'}</div><div><span>Dice</span>${esc(k.encontrado) || '—'}</div></div>${k.nota ? `<div class="status">${esc(k.nota)}</div>` : ''}`}</div>`;
    const group = (label, st) => { const x = r.checks.filter(k => k.status === st); return x.length ? `<h3>${label}</h3><div class="issues">${x.map(card).join('')}</div>` : ''; };
    body.innerHTML = `
      <div class="hero">
        <div class="ring" role="img" aria-label="${r.pct}% correcto">
          <svg viewBox="0 0 150 150"><circle cx="75" cy="75" r="62" fill="none" stroke="var(--line)" stroke-width="11"/><circle class="v" cx="75" cy="75" r="62" fill="none" stroke="var(--${tone})" stroke-width="11" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - r.pct / 100)}"/></svg>
          <div class="pct">${r.pct}%</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
          <div class="verdict tone-${tone}">${esc(verdictText(r))}</div>
          <div>${r.pct}% correcto: coinciden ${r.correctos} de ${r.evaluados} puntos.</div>
          <div class="status">${esc(c.nombre)} · contrato ${esc(c.contrato)} · ${filesLine(cur)}</div>
        </div>
      </div>
      ${cur.clash ? `<div class="issue"><div class="where">Documentos</div><div class="t">El Anexo y el Pagaré no son del mismo cliente</div><div class="status">${esc(cur.clash)}</div></div>` : ''}
      ${group('Corregir antes de firmar', 'error')}${group('Confirmar a ojo', 'review')}${group('No se pudo revisar', 'pending')}`;
    detail.innerHTML = `<h3>Anexo</h3>${table(by('anexo'))}<h3>Pagaré</h3>${table(by('pagare'))}<h3>Cuentas del Anexo</h3>${table(by('interno'))}`;
    if (r.pending && !state.dataTouched) $('dataBox').open = true;
  }
  function reportOf(x) {
    const L = [], c = state.cat.clientes[x.ci], r = x.r;
    L.push(`VALIDACIÓN — ${pairLabel(x)} · ${c.nombre} · contrato ${c.contrato} · firma ${V.fmtDate(V.parseDate($('fechaFirma').value))}`);
    L.push(`Archivos: Anexo ${x.a ? x.a.name : 'falta'} · Pagaré ${x.p ? x.p.name : 'falta'}`);
    L.push(`Resultado: ${r.pct}% correcto (${r.correctos} de ${r.evaluados}) · ${r.errors} errores materiales · ${r.reviews} por confirmar · ${r.pending} sin revisar`);
    [['anexo', 'ANEXO'], ['pagare', 'PAGARÉ'], ['interno', 'VERIFICACIONES INTERNAS']].forEach(([d, t]) => {
      L.push('', t);
      r.checks.filter(k => k.doc === d).forEach(k => L.push(`${PILL[k.status]} | ${k.campo} | esperado: ${k.esperado} | encontrado: ${k.encontrado || '—'}${k.nota ? ' | ' + k.nota : ''}`));
    });
    return L.join('\n');
  }
  function reportText() {
    const xs = (state.tab === 'resumen' ? state.pairs : [state.pairs[state.tab]]).filter(x => x && x.r);
    return xs.map(reportOf).join('\n\n==============================\n\n');
  }

  /* ---------- ejemplo ficticio ---------- */
  const DEMO_CAT = `## Datos constantes del Factorante
- **Factorante:** ACTIVE LEASING, S.A. DE C.V.
- **Apoderado habitual (firmante):** Apoderado de Ejemplo Uno
- **Cuenta del Factorante** (beneficiario del Pagaré): BANCO · cta. **1234567-8** · CLABE **072180001234567890**

## Cliente: PAPELERA DEMO DEL VALLE, S.A. DE C.V.
- **Fecha de extracción de la ficha:** 01/11/2026
- **Número de contrato:** 00999/005
- **Fecha de firma del contrato:** 3 de marzo de 2026
### Tasa de descuento (estructura de periodos)
- **Vigente al:** 01/11/2026
- 30 días → **2.10%**
- 60 días → **2.15%**
- 90 días → **2.20%**
- 120 días → **no autorizado** para este cliente
### Factorado / Obligado Solidario Uno
- Razón social: **PAPELERA DEMO DEL VALLE, S.A. DE C.V.**
- RFC: **PDV010101AA1**
- Domicilio: Av. Ficticia Ext. 100, Int. 2, Col. Ejemplo, Toluca, Estado de México, C.P. 50000
### Obligados Solidarios
- **Persona moral:** **ENVASES DEMO, S.A. DE C.V.** — RFC **EDE020202BB2** — Calle Inventada 45, Col. Muestra, Toluca, Estado de México, C.P. 50010
- **Persona física:** **MARIANA EJEMPLO RUIZ** — RFC **EERM800101CC3** — Cerrada del Ensayo 128, Col. Prueba, Metepec, Estado de México, C.P. 52140
### Firmantes autorizados del cliente
- MARIANA EJEMPLO RUIZ (Representante Legal)
### Cuenta del factorado (ejemplo)
- Banco: **BBVA**
- No. de cuenta: **0100000001**
- Sucursal: **1234 Centro Pyme Ejemplo**
- CLABE: **012180001000000019**
`;
  const DEMO_ANEXO = `ANEXO No. 7 (EJEMPLO FICTICIO) del Contrato de Factoraje número 00999/005
Factorado: PAPELERA DEMO DEL VALLE, S.A. DE C.V.
Fecha de inicio de disposición: 02/11/2026
Fecha Máxima de Pago: 17/12/2026
Plazo: 45 días
Valor Nominal Total: $500,000.00
Aforo 10% $50,000.00
Precio Base: $450,000.00
Tasa de Descuento: 2.15%
Descuento: $14,512.50
IVA del Descuento: $2,322.00
Precio de los Derechos de Crédito: $433,165.50
Pago a realizar en la Fecha Máxima de Pago: $450,000.00
Cuenta del Factorado: Banco BBVA, No. de Cuenta 0100000001, Sucursal 1234 Centro Pyme Ejemplo, CLABE 012180001000000019
APÉNDICE. Conforme a la cláusula Trigésima Tercera del Contrato de Factoraje de fecha el día 4 de marzo de 2026.
Firmas: MARIANA EJEMPLO RUIZ, por el Factorado. Apoderado de Ejemplo Uno, por ACTIVE LEASING, S.A. DE C.V.
"OBLIGADO SOLIDARIO" ENVASES DEMO, S.A. DE C.V.
"OBLIGADO SOLIDARIO" MARIANA EJEMPLO RUIZ
TABLA DE FACTURAS
F-101 $250,000.00
F-102 $250,000.00`;
  const DEMO_PAGARE = `PAGARÉ (EJEMPLO FICTICIO) Bueno por $450,000.00
Este Pagaré se suscribe en Toluca, Estado de México, el día 2 de noviembre de 2026.
PAPELERA DEMO DEL VALLE, S.A. DE C.V. promete pagar incondicionalmente a la orden de ACTIVE LEASING, S.A. DE C.V. la cantidad de $450,000.00 (CUATROCIENTOS CINCUENTA MIL PESOS 00/100 M.N.), mediante depósito a la cuenta 1234567-8, CLABE 072180001234567890.
Suscriptor: PAPELERA DEMO DEL VALLE, S.A. DE C.V., representada por MARIANA EJEMPLO RUIZ. Domicilio: Avenida Ficticia número 100, interior 2, Colonia Ejemplo, Toluca, Estado de México, C.P. 50000.
"Aval" ENVASES DEMO, S.A. DE C.V. Domicilio: Calle Inventada 45, Colonia Muestra, Toluca, Estado de México, C.P. 50010.
"Aval" MARIANA EJEMPLO RUIZ. Domicilio: Cerrada del Ensayo 218, Colonia Prueba, Metepec, Estado de México, C.P. 52140.`;
  function loadDemo() {
    state.demo = true; $('demoBanner').hidden = false;
    loadCatalog(DEMO_CAT, 'catálogo de ejemplo (ficticio)', false);
    state.anexos = [{ name: 'Anexo de ejemplo (ficticio)', text: DEMO_ANEXO, how: 'texto' }];
    state.pagares = [{ name: 'Pagaré de ejemplo (ficticio)', text: DEMO_PAGARE, how: 'texto' }];
    $('fechaFirma').value = '2026-11-02';
    boxStatus('Anexo'); boxStatus('Pagare'); rebuild();
  }
  function resetDocs() {
    state.anexos = []; state.pagares = [];
    ['Anexo', 'Pagare'].forEach(w => { $('file' + w).value = ''; boxStatus(w); });
    $('fechaFirma').value = '';
  }
  function leaveDemo() {
    if (!state.demo) return;
    state.demo = false; $('demoBanner').hidden = true;
    resetDocs();
    if (state.cat && /ficticio/.test(state.catInfo)) { state.baseText = ''; applyCatalog(); $('catStatus').className = 'status'; $('catStatus').textContent = 'Sin catálogo cargado.'; }
  }

  /* ---------- pestañas ---------- */
  /* ---------- clientes guardados y fichas compartidas (iguales en todas las computadoras) ----------
     Tabla "clientes_guardados" de Supabase: una fila por cliente con su nombre y, si se editó o se dio de alta
     aquí, el texto de su ficha. Una ficha compartida sustituye SOLO a la de ese cliente; las demás no cambian.
     Si la fila no trae ficha, se usa la del catálogo cargado en cada computadora (empatada por nombre).
     En vista previa (sin Supabase) todo esto se guarda solo en este navegador. */
  const TBL = 'clientes_guardados', LSK = 'validador-clientes-guardados-v1';
  const nkey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const lsGet = () => { try { return (JSON.parse(localStorage.getItem(LSK) || '[]') || []).map(r => typeof r === 'string' ? { nombre: r, ficha: null } : r); } catch (e) { return []; } };
  const lsSet = a => { try { localStorage.setItem(LSK, JSON.stringify(a)); } catch (e) { /* sin almacenamiento */ } };
  const store = {
    async list() {
      if (!authOn) return lsGet();
      const { data, error } = await sb.from(TBL).select('nombre, ficha').order('nombre');
      if (error) throw error;
      return data;
    },
    // guarda (o actualiza) un cliente; "antes" es el nombre con el que ya estaba guardado, si lo estaba
    async save(nombre, ficha, antes) {
      if (!authOn) {
        const a = lsGet().filter(r => nkey(r.nombre) !== nkey(antes || nombre) && nkey(r.nombre) !== nkey(nombre));
        const old = lsGet().find(r => nkey(r.nombre) === nkey(antes || nombre));
        a.push({ nombre, ficha: ficha === undefined ? (old ? old.ficha : null) : ficha }); lsSet(a); return;
      }
      const row = { nombre }; if (ficha !== undefined) { row.ficha = ficha; row.actualizado_el = new Date().toISOString(); }
      const r = antes ? await sb.from(TBL).update(row).eq('nombre', antes).select('nombre') : await sb.from(TBL).insert(row).select('nombre');
      if (r.error && !(r.error.code === '23505' && ficha === undefined)) throw r.error;   // 23505 = ya estaba guardado
      if (!r.error && antes && !(r.data || []).length) throw { code: 'sin-cambio', message: 'sin cambio' };
    },
    async addMany(rows) {
      if (!rows.length) return;
      if (!authOn) { lsSet(lsGet().concat(rows)); return; }
      const { error } = await sb.from(TBL).insert(rows.map(r => ({ nombre: r.nombre, ficha: r.ficha, actualizado_el: new Date().toISOString() })));
      if (error) throw error;
    },
    async remove(nombre) {
      if (!authOn) { lsSet(lsGet().filter(r => nkey(r.nombre) !== nkey(nombre))); return; }
      const { error } = await sb.from(TBL).delete().eq('nombre', nombre);
      if (error) throw error;
    }
  };
  const storeMsg = e => {
    const m = ((e && (e.code + ' ' + e.message)) || '').toLowerCase();
    if (/42p01|pgrst205|pgrst204|42703|could not find the|does not exist/.test(m)) return 'Los clientes guardados todavía no están activados en la base de datos.';
    if (/42501|row-level security|permission denied|sin-cambio/.test(m)) return 'Tu cuenta no tiene permiso para guardar clientes.';
    if (/23505/.test(m)) return 'Ya hay un cliente guardado con ese nombre.';
    if (/fetch|network/.test(m)) return 'Sin conexión: no se pudo conectar con los clientes guardados.';
    return 'No se pudo conectar con los clientes guardados.';
  };
  const storeReady = () => !authOn || (sb && !document.body.classList.contains('gated'));
  const savedName = n => state.saved.find(x => nkey(x) === nkey(n)) || null;
  const firstClient = text => (V.parseCatalog(text || '').clientes || [])[0] || null;
  const FKEY = '__FACTORANTE__';                                     // fila aparte con los "Datos constantes del Factorante"
  const factBlock = text => { const p = String(text || '').replace(/\r/g, '').split(/^## /m).find(x => /^Datos constantes/i.test(x)); return p ? '## ' + p.trim() + '\n' : ''; };
  /* Al cargar un catálogo, cada ficha se guarda para todas las computadoras. No pisa las fichas que ya estaban guardadas
     (esas se cambian con Editar); solo agrega las nuevas y completa las que estaban guardadas solo con el nombre. */
  async function shareCatalog(text) {
    if (!storeReady()) return '';
    try {
      const rows = await store.list(), by = {}; rows.forEach(r => { by[nkey(r.nombre)] = r; });
      const nuevos = [], completar = []; let ya = 0;
      V.parseCatalog(text).clientes.forEach(c => {
        const r = by[nkey(c.nombre)];
        if (!r) { if (!nuevos.some(x => nkey(x.nombre) === nkey(c.nombre))) nuevos.push({ nombre: c.nombre, ficha: fichaText(c) }); }
        else if (!r.ficha) completar.push([r.nombre, c]); else ya++;
      });
      const fb = factBlock(text);
      if (fb && !rows.some(r => r.nombre === FKEY)) nuevos.push({ nombre: FKEY, ficha: fb });
      await store.addMany(nuevos);
      for (const [nombre, c] of completar) await store.save(nombre, fichaText(c), nombre);
      await refreshSaved();
      const n = nuevos.filter(x => x.nombre !== FKEY).length + completar.length;
      return ` · ${n} ficha${n === 1 ? '' : 's'} guardada${n === 1 ? '' : 's'} para todas las computadoras` + (ya ? ` (${ya} ya estaba${ya === 1 ? '' : 'n'} guardada${ya === 1 ? '' : 's'} y no se ${ya === 1 ? 'cambió' : 'cambiaron'}; edítala${ya === 1 ? '' : 's'} en Ficha)` : '');
    } catch (e) { return ' · No se guardaron para las demás computadoras: ' + storeMsg(e); }
  }
  /* Catálogo en uso = catálogo cargado en esta computadora + fichas compartidas (cada una sustituye solo a su cliente). */
  function applyCatalog() {
    const base = state.baseText || '';
    const cat = V.parseCatalog(!factBlock(base) && state.factText ? state.factText + '\n' + base : base);
    Object.keys(state.fichas).forEach(k => {
      const c = firstClient(state.fichas[k]); if (!c) return;
      c.compartida = true;
      const at = cat.clientes.findIndex(x => nkey(x.nombre) === k || nkey(x.nombre) === nkey(c.nombre));
      if (at >= 0) cat.clientes[at] = c; else cat.clientes.push(c);
    });
    state.cat = cat.clientes.length ? cat : null;
  }
  async function refreshSaved() {
    if (!storeReady()) return;
    try {
      const rows = await store.list();
      state.factText = (rows.find(r => r.nombre === FKEY) || {}).ficha || '';
      const cli = rows.filter(r => r.nombre !== FKEY);
      state.saved = cli.map(r => r.nombre).sort((a, b) => a.localeCompare(b, 'es'));
      state.fichas = {}; cli.forEach(r => { if (r.ficha) state.fichas[nkey(r.nombre)] = r.ficha; });
      state.savedMsg = '';
    } catch (e) { state.savedMsg = storeMsg(e); }
    applyCatalog(); rebuild();
  }
  function renderSaved() {
    const q = nkey(state.savedQ), all = state.saved, list = q ? all.filter(n => nkey(n).includes(q)) : all;
    $('savedMeta').textContent = state.savedMsg || (all.length ? `${all.length} guardado${all.length > 1 ? 's' : ''}` + (authOn ? ' · se ven en todas las computadoras' : ' · vista previa: solo en este navegador') : '');
    $('savedMeta').className = 'status' + (state.savedMsg ? ' bad' : '');
    const has = n => !!(state.cat && state.cat.clientes.some(k => nkey(k.nombre) === nkey(n)));
    $('savedList').innerHTML = list.map((n, i) => `<button type="button" class="saved" data-i="${i}" aria-current="${state.pick && nkey(state.pick) === nkey(n)}">${esc(n)}<span>${state.fichas[nkey(n)] ? 'Ficha compartida · ver' : has(n) ? 'Ver ficha' : 'Sin ficha en esta computadora'}</span></button>`).join('')
      || `<div class="empty">${state.savedMsg ? '' : all.length ? 'Ningún cliente guardado coincide con la búsqueda.' : 'Todavía no hay fichas guardadas. Carga el catálogo en la pestaña Catálogo o usa Nuevo cliente.'}</div>`;
    $('savedList').querySelectorAll('button.saved').forEach(b => b.addEventListener('click', () => { state.pick = list[+b.dataset.i]; closeEditor(); render(); }));
  }
  $('savedForm').addEventListener('submit', e => { e.preventDefault(); state.savedQ = $('savedQ').value; renderSaved(); });
  $('savedQ').addEventListener('input', () => { state.savedQ = $('savedQ').value; renderSaved(); });
  $('saveCli').addEventListener('click', async () => {
    const cur = state.tab === 'resumen' ? null : state.pairs[state.tab], c = cur && cur.ci >= 0 && state.cat ? state.cat.clientes[cur.ci] : null;
    if (!c) return;
    const msg = $('saveCliMsg'); msg.className = 'status'; msg.textContent = 'Guardando…'; $('saveCli').disabled = true;
    try { await store.save(c.nombre); await refreshSaved(); msg.className = 'status good'; msg.textContent = 'Guardado en Ficha.'; }
    catch (e) { $('saveCli').disabled = false; msg.className = 'status bad'; msg.textContent = storeMsg(e); }
  });
  $('savedDrop').addEventListener('click', async () => {
    const n = state.pick; if (!n) return;
    try { await store.remove(n); state.pick = null; closeEditor(); await refreshSaved(); } catch (e) { state.savedMsg = storeMsg(e); render(); }
  });

  /* ---------- editar la ficha de un solo cliente / dar de alta un cliente nuevo ---------- */
  const NEW_FICHA = `## Cliente: NOMBRE DEL CLIENTE, S.A. DE C.V.
- **Fecha de extracción de la ficha:** 01/01/2026
- **Número de contrato:** 00000/000
- **Fecha de firma del contrato:** 1 de enero de 2026
- **Depositario:** NOMBRE DEL DEPOSITARIO
### Tasa de descuento (estructura de periodos)
- **Vigente al:** 01/01/2026
- 30 días → **0.00%**
- 60 días → **0.00%**
- 90 días → **0.00%**
- 120 días → **no autorizado** para este cliente
### Factorado / Obligado Solidario Uno
- Razón social: **NOMBRE DEL CLIENTE, S.A. DE C.V.**
- RFC: **XXX000000XX0**
- Domicilio: Calle, número, colonia, municipio, estado, C.P. 00000
### Obligados Solidarios
- **Persona física:** **NOMBRE COMPLETO** — RFC **XXXX000000XX0** — Calle, número, colonia, municipio, estado, C.P. 00000
### Firmantes autorizados del cliente
- NOMBRE COMPLETO (Representante Legal)
### Cuenta del factorado
- Banco: **BANCO**
- No. de cuenta: **0000000000**
- Sucursal: **0000 Nombre de la sucursal**
- CLABE: **000000000000000000**
`;
  const fichaText = c => '## ' + String(c.raw || '').replace(/^##\s*/, '').trim() + '\n';
  function closeEditor() { state.editing = null; $('edBox').hidden = true; $('edMsg').textContent = ''; }
  function openEditor(c) {
    state.editing = { antes: c ? savedName(c.nombre) : null, nuevo: !c };
    $('edTitle').textContent = c ? 'Editar la ficha de ' + c.nombre : 'Nuevo cliente';
    $('edText').value = c ? fichaText(c) : NEW_FICHA;
    $('edBox').hidden = false; $('edMsg').className = 'status'; $('edMsg').textContent = '';
    edPreview(); $('edText').focus();
  }
  function edPreview() {
    const c = firstClient($('edText').value), el = $('edSee');
    if (!c) { el.className = 'status bad'; el.textContent = 'Todavía no se reconoce como ficha. Debe empezar con "## Cliente: NOMBRE" y traer el número de contrato o los obligados solidarios, igual que en el catálogo.'; return null; }
    const cu = c.cuenta || {}, falta = [];
    if (!c.contrato) falta.push('número de contrato'); if (!c.fechaContrato) falta.push('fecha de firma del contrato');
    if (!c.domicilio) falta.push('domicilio'); if (!c.firmantes.length) falta.push('firmantes'); if (!(c.depositarios || []).length) falta.push('depositario'); if (!cu.clabe) falta.push('CLABE');
    el.className = 'status' + (falta.length ? '' : ' good');
    el.textContent = `Se reconoce: ${c.nombre} · contrato ${c.contrato || '—'} · ${c.os.length} obligado${c.os.length === 1 ? '' : 's'} solidario${c.os.length === 1 ? '' : 's'} · ${c.firmantes.length} firmante${c.firmantes.length === 1 ? '' : 's'} · depositario ${(c.depositarios || []).join(' y ') || '—'} · CLABE ${cu.clabe || '—'}.` + (falta.length ? ' No se encontró: ' + falta.join(', ') + '.' : '');
    return c;
  }
  $('edText').addEventListener('input', edPreview);
  $('fichaEdit').addEventListener('click', () => { if (state.fichaShown) openEditor(state.fichaShown); });
  $('fichaNew').addEventListener('click', () => openEditor(null));
  $('edCancel').addEventListener('click', closeEditor);
  $('edFile').addEventListener('change', async () => {
    const f = $('edFile').files[0]; if (!f) return;
    const msg = $('edMsg'); msg.className = 'status';
    try {
      const r = await readAny(f, t => { msg.textContent = t; });
      if (r.text.replace(/\s/g, '').length < 20) throw new Error('no se encontró texto');
      $('edText').value = r.text.trim() + '\n'; msg.textContent = `Se cargó el texto de ${f.name}${r.how === 'ocr' ? ' (leído de imagen; revísalo)' : ''}. Revisa que quede con el formato de la ficha antes de guardar.`;
    } catch (e) { msg.className = 'status bad'; msg.textContent = `No se pudo leer ${f.name} (${e && e.message ? e.message : 'formato no soportado'}).`; }
    $('edFile').value = ''; edPreview();
  });
  $('edSave').addEventListener('click', async () => {
    const c = edPreview(), msg = $('edMsg'); if (!c || !state.editing) return;
    const antes = state.editing.antes;
    if (!antes && savedName(c.nombre)) { msg.className = 'status bad'; msg.textContent = 'Ya hay un cliente guardado con ese nombre. Ábrelo y edítalo.'; return; }
    msg.className = 'status'; msg.textContent = 'Guardando…'; $('edSave').disabled = true;
    try { await store.save(c.nombre, $('edText').value.trim() + '\n', antes); state.pick = c.nombre; closeEditor(); await refreshSaved(); }
    catch (e) { msg.className = 'status bad'; msg.textContent = storeMsg(e); }
    $('edSave').disabled = false;
  });

  const VIEWS = ['validar', 'ficha', 'catalogo'];
  function show(v) {
    if (!VIEWS.includes(v)) v = 'validar';
    VIEWS.forEach(x => { $('view-' + x).hidden = x !== v; });
    document.querySelectorAll('.navbtn').forEach(b => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  }
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.view; show(b.dataset.view); }));
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1));
  $('dataBox').addEventListener('click', e => { if (e.target.closest('summary')) state.dataTouched = true; });

  /* ---------- portada: primero el video del logo, después el título ---------- */
  (function intro() {
    const hero = $('phero'), v = $('intro');
    let shown = false;
    const showTitle = () => { if (!shown) { shown = true; hero.classList.add('done'); } };
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return showTitle();
    v.addEventListener('ended', showTitle);
    v.addEventListener('error', showTitle);
    const p = v.play(); if (p && p.catch) p.catch(showTitle);
    setTimeout(showTitle, 6000);               // por si el video no arranca
  })();

  /* ---------- acceso con cuenta (Supabase Auth) ----------
     Pon aquí la URL del proyecto y la llave pública (anon). Mientras estén vacías, el validador queda abierto
     y la pantalla de acceso solo se puede ver como vista previa en  #login . */
  const AUTH = { url: 'https://hwuxlnhwyewrheveazvy.supabase.co', key: 'sb_publishable_wbZAFoV5kE8_9wtOScZwgA_X-mFuqe3' };   // llave pública (publishable), nunca la secreta
  // En la vista previa de Claude y en pruebas locales no hay conexión con Supabase: ahí el validador queda abierto.
  const OPEN_HOST = /claude|anthropic|^localhost$|^127\.0\.0\.1$/i.test(location.hostname);
  const authOn = !!(AUTH.url && AUTH.key) && !OPEN_HOST;
  let sb = null, signup = false;
  function gate(on) {
    document.body.classList.toggle('gated', on);
    $('gate').hidden = !on; $('gatebg').hidden = !on;
    const v = $('gate-video');
    if (on) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } else v.pause();
  }
  function gateText() {
    $('g-go').textContent = signup ? 'Crear cuenta' : 'Entrar';
    $('g-switch-q').textContent = signup ? '¿Ya tienes cuenta?' : '¿Primera vez?';
    $('g-toggle').textContent = signup ? 'Entrar' : 'Crear cuenta';
    $('g-pass').autocomplete = signup ? 'new-password' : 'current-password';
  }
  function gateMsg(text, info, bad) {
    document.querySelectorAll('#gate-form input').forEach(i => i.classList.remove('bad'));
    const e = $('g-err'); e.classList.toggle('info', !!info); e.textContent = text || '';
    (bad || []).forEach(id => $(id).classList.add('bad'));
  }
  function authMsg(m) {
    const x = (m || '').toLowerCase();
    if (x.includes('invalid login')) return ['Correo o contraseña incorrectos. Revísalos e inténtalo de nuevo.', ['g-email', 'g-pass']];
    if (x.includes('not confirmed')) return ['Aún no confirmas tu correo. Abre el enlace que te enviamos y luego entra.', ['g-email']];
    if (x.includes('already registered')) return ['Ese correo ya tiene cuenta. Entra con tu contraseña.', ['g-email']];
    if (x.includes('signups not allowed') || x.includes('signup is disabled')) return ['No se pueden crear cuentas aquí. Pide al administrador que te dé de alta.', []];
    if (x.includes('password')) return ['La contraseña no es válida: usa al menos 6 caracteres.', ['g-pass']];
    if (x.includes('email') && x.includes('valid')) return ['Ese correo no parece válido.', ['g-email']];
    if (x.includes('rate limit') || x.includes('too many')) return ['Demasiados intentos. Espera un momento e inténtalo de nuevo.', []];
    if (x.includes('fetch') || x.includes('network')) return ['No hay conexión. Revisa tu internet e inténtalo de nuevo.', []];
    return [m || 'No se pudo entrar.', []];
  }
  $('g-eye').addEventListener('click', () => { const i = $('g-pass'), on = i.type === 'password'; i.type = on ? 'text' : 'password'; $('g-eye').setAttribute('aria-pressed', on); $('g-eye').setAttribute('aria-label', on ? 'Ocultar contraseña' : 'Mostrar contraseña'); i.focus(); });
  $('g-toggle').addEventListener('click', () => { signup = !signup; gateText(); gateMsg(''); });
  document.querySelectorAll('#gate-form input').forEach(i => i.addEventListener('input', () => { if (!$('g-err').classList.contains('info')) gateMsg(''); }));
  $('gate-form').addEventListener('submit', async e => {
    e.preventDefault(); gateMsg('');
    const email = $('g-email').value.trim(), password = $('g-pass').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return gateMsg('Escribe tu correo.', false, ['g-email']);
    if (password.length < 6) return gateMsg('Escribe tu contraseña (mínimo 6 caracteres).', false, ['g-pass']);
    if (!authOn) return gateMsg('Vista previa: el acceso con cuenta todavía no está conectado, así que nadie puede entrar ni crear cuentas desde aquí.', true);
    $('g-go').disabled = true;
    let r;
    try { r = signup ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }) : await sb.auth.signInWithPassword({ email, password }); }
    catch (err) { r = { error: err }; }
    $('g-go').disabled = false;
    if (r.error) { const [t, bad] = authMsg(r.error.message); return gateMsg(t, false, bad); }
    if (signup && !(r.data && r.data.session)) return gateMsg('Revisa tu correo para confirmar la cuenta y luego entra.', true);
    $('g-pass').value = ''; enter();
  });
  function enter() { gate(false); $('signout').hidden = !authOn; refreshSaved(); }
  $('signout').addEventListener('click', async () => { try { await sb.auth.signOut(); } catch (e) { /* sin sesión */ } location.reload(); });
  async function startAuth() {
    gateText();
    if (!authOn) {                                                 // sin configurar: solo vista previa
      const preview = () => { const on = location.hash === '#login'; gate(on); if (on) { $('g-fine').innerHTML = 'Vista previa del acceso. <button type="button" id="g-back">Volver al validador</button>'; $('g-back').onclick = () => { location.hash = 'validar'; }; } };
      window.addEventListener('hashchange', preview); preview(); return;
    }
    gate(true);                                                    // configurado: cerrado hasta confirmar la sesión
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js');
      sb = window.supabase.createClient(AUTH.url, AUTH.key);
      const { data } = await sb.auth.getSession();
      if (data && data.session) enter();
      sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') gate(true); });
    } catch (e) { gateMsg('No se pudo conectar con el servicio de acceso. Revisa tu internet y recarga la página.'); }
  }

  /* ---------- arranque ---------- */
  buildFields($('fAnexo'), ANEXO_FIELDS); buildFields($('fPagare'), PAGARE_FIELDS);
  wireDrop('Anexo'); wireDrop('Pagare'); wireDelete('Anexo'); wireDelete('Pagare');
  $('fechaFirma').addEventListener('input', () => { compute(); render(); });
  $('catFile').addEventListener('change', async () => {
    const f = $('catFile').files[0]; if (!f) return;
    const text = await f.text();
    if (state.demo) leaveDemo();
    if (loadCatalog(text, `${f.name} · cargado el ${new Date().toLocaleDateString('es-MX')}`, true)) {
      rebuild();
      const base = $('catStatus').textContent; $('catStatus').textContent = base + ' · guardando las fichas para todas las computadoras…';
      $('catStatus').textContent = base + await shareCatalog(text);
      location.hash = 'ficha'; show('ficha');
    }
    $('catFile').value = '';
  });
  $('catForget').addEventListener('click', () => {
    try { localStorage.removeItem(KEY); } catch (e) { /* nada que borrar */ }
    state.demo = false; $('demoBanner').hidden = true;
    state.baseText = ''; applyCatalog(); $('catStatus').className = 'status'; $('catStatus').textContent = 'Sin catálogo cargado.'; rebuild();
  });
  $('clearDemo').addEventListener('click', () => { leaveDemo(); rebuild(); });
  $('reset').addEventListener('click', () => { if (state.demo) leaveDemo(); else resetDocs(); rebuild(); });
  $('copy').addEventListener('click', async () => {
    const b = $('copy');
    const xs = (state.tab === 'resumen' ? state.pairs : [state.pairs[state.tab]]).filter(x => x && x.r);
    if (!xs.length) return;
    b.disabled = true; b.textContent = 'Generando PDF…';
    try {
      await loadScript('lib/jspdf.umd.min.js'); await loadScript('lib/jspdf.plugin.autotable.min.js');
      const firma = $('fechaFirma').value ? V.fmtDate(V.parseDate($('fechaFirma').value)) : '';
      const items = xs.map(x => { const c = state.cat.clientes[x.ci]; return { titulo: pairLabel(x), cliente: c.nombre, contrato: c.contrato, firma, anexo: x.a ? x.a.name : '', pagare: x.p ? x.p.name : '', r: x.r }; });
      const pdf = window.VALPDF.build(window.jspdf.jsPDF, items, new Date().toLocaleDateString('es-MX'));
      const name = (xs.length === 1 ? 'Validacion ' + pairLabel(xs[0]) : 'Validacion ' + xs.length + ' disposiciones').replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
      pdf.save(name + '.pdf');
      b.textContent = 'Descargado';
    } catch (e) { b.textContent = 'No se pudo generar el PDF'; }
    b.disabled = false;
    setTimeout(() => { b.textContent = 'Descargar'; }, 1800);
  });

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
  // Sin catálogo guardado se empieza en blanco (ya no se carga el ejemplo ficticio, que confundía:
  // al quitar un documento del ejemplo desaparecía también su catálogo de ejemplo).
  if (saved && saved.text) loadCatalog(saved.text, saved.info || 'guardado en este navegador', false);
  boxStatus('Anexo'); boxStatus('Pagare'); rebuild();
  startAuth();
  if (!authOn) refreshSaved();
  // al abrir la pestaña Ficha o volver a la ventana se vuelven a traer, para ver lo que guardaron en otras computadoras
  const maybeRefresh = () => { if (location.hash === '#ficha') refreshSaved(); };
  window.addEventListener('hashchange', maybeRefresh);
  window.addEventListener('focus', maybeRefresh);
})();
