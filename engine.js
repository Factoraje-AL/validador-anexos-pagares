/* Motor de validación de Anexos y Pagarés — 100% determinista, sin IA.
   Todo es comparación de datos contra la ficha del catálogo + aritmética. */
(function (root) {
  'use strict';

  /* ---------- utilidades de texto ---------- */
  const flatChar = c => c.normalize('NFD')[0];
  const flat = s => Array.from(s || '', flatChar).join('').toUpperCase();   // sin acentos, mismo largo aprox.
  const collapse = s => (s || '').replace(/\s+/g, ' ').trim();
  const fold = s => collapse(s).toUpperCase();
  const stripMd = s => (s || '').replace(/\*\*/g, '').trim();

  const ABBR = {
    AV: 'AVENIDA', AVE: 'AVENIDA', COL: 'COLONIA', INT: 'INTERIOR', EXT: 'EXTERIOR',
    BLVD: 'BOULEVARD', BLVR: 'BOULEVARD', BULEVAR: 'BOULEVARD', CD: 'CIUDAD', EDO: 'ESTADO',
    SUC: 'SUCURSAL', MZ: 'MANZANA', MZA: 'MANZANA', LT: 'LOTE', DEPTO: 'DEPARTAMENTO', DEP: 'DEPARTAMENTO',
    EDIF: 'EDIFICIO', C: 'CALLE', PROL: 'PROLONGACION', CARR: 'CARRETERA', FRACC: 'FRACCIONAMIENTO',
    PTE: 'PONIENTE', OTE: 'ORIENTE', NTE: 'NORTE', MEX: 'MEXICO', UNO: 'UN', VEINTIUNO: 'VEINTIUN'
  };
  const SIGLAS = ['SA', 'CV', 'RL', 'SAPI', 'SAB', 'SC', 'AC', 'SRL', 'LLC'];
  const DROP = new Set(['NO', 'NUM', 'NUMERO', 'CP']);
  const GENERIC = new Set(['DE', 'LA', 'EL', 'LOS', 'LAS', 'DEL', 'Y', 'EN', 'A', 'CALLE', 'AVENIDA', 'COLONIA',
    'EXTERIOR', 'INTERIOR', 'ALCALDIA', 'MUNICIPIO', 'DELEGACION', 'CODIGO', 'POSTAL', 'SN', 'S', 'N', 'PISO',
    'SUCURSAL', 'CON', 'DOMICILIO', 'ESTADO']);

  /* Convierte texto en tokens canónicos, guardando la posición en el texto original. */
  function tokenize(raw) {
    raw = raw || '';
    const out = [];
    const re = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]+/g;
    let m, prev = null;
    while ((m = re.exec(raw))) {
      let t = flat(m[0]);
      const s = m.index, e = s + m[0].length;
      // une siglas: "S.A." -> "SA", "C.V." -> "CV", "R & A" -> "RA"
      const gap = prev ? raw.slice(prev.e, s) : '';
      if (prev && /^[A-Z]$/.test(t) && /^[A-Z]{1,3}$/.test(prev.t) && prev.sig && gap.length <= 3 && !/[\n,;]/.test(gap) &&
          (!/\s/.test(gap) || gap === ' & ' || SIGLAS.some(x => x.startsWith(prev.t + t)))) {
        prev.t += t; prev.e = e; continue;
      }
      prev = { t, s, e, sig: /^[A-Z]$/.test(t) };
      out.push(prev);
    }
    const res = [];
    for (const k of out) {
      let t = ABBR[k.t] || k.t;
      if (t === 'CDMX') { ['CIUDAD', 'DE', 'MEXICO'].forEach(x => res.push({ t: x, s: k.s, e: k.e })); continue; }
      if (DROP.has(t)) continue;
      if (/^\d+$/.test(t)) t = t.replace(/^0+(?=\d)/, '');
      res.push({ t, s: k.s, e: k.e });
    }
    return res;
  }
  function makeDoc(raw) {
    // une palabras cortadas con guion al final del renglón: "seis-\ncientos" -> "seiscientos"
    raw = (raw || '').replace(/([a-záéíóúñü])[-­‐‑]\s+(?=[a-záéíóúñü])/g, '$1');
    return { raw, tokens: tokenize(raw), digits: raw.replace(/(\d)[\s\-](?=\d)/g, '$1') };
  }
  const snippet = (doc, i, j) => {
    const end = doc.tokens[j].e + (doc.raw[doc.tokens[j].e] === '.' ? 1 : 0);
    const s = collapse(doc.raw.slice(doc.tokens[i].s, end));
    return s.length > 170 ? s.slice(0, 170) + '…' : s;
  };

  /* Busca los tokens esperados contiguos y en orden. */
  function findContiguous(doc, exp) {
    const T = doc.tokens, n = exp.length;
    if (!n) return -1;
    for (let i = 0; i + n <= T.length; i++) {
      let k = 0;
      while (k < n && T[i + k].t === exp[k]) k++;
      if (k === n) return i;
    }
    return -1;
  }
  /* Mejor ventana del documento que contiene el mayor número de tokens esperados. */
  function findWindow(doc, expSet) {
    const T = doc.tokens, n = expSet.size, L = n * 2 + 8;
    let best = { score: 0, i: -1, last: -1, seen: new Set(), span: 1e9 };
    for (let i = 0; i < T.length; i++) {
      if (!expSet.has(T[i].t)) continue;
      const seen = new Set(); let last = i;
      for (let j = i; j < Math.min(i + L, T.length); j++) {
        if (expSet.has(T[j].t) && !seen.has(T[j].t)) { seen.add(T[j].t); last = j; }
      }
      if (seen.size > best.score || (seen.size === best.score && last - i < best.span)) {
        best = { score: seen.size, i, last, seen, span: last - i };
      }
    }
    return best;
  }

  /* ---------- comparadores (devuelven {status, encontrado, nota}) ---------- */
  // status: ok | minor | review | error | pending | na
  function checkName(doc, name) {
    const exp = tokenize(name).map(k => k.t);
    const T = doc.tokens, eq = x => fold(x).replace(/[.,]+$/, '') === fold(name).replace(/[.,]+$/, '');
    let first = null;
    for (let i = 0; i + exp.length <= T.length; i++) {
      let k = 0; while (k < exp.length && T[i + k].t === exp[k]) k++;
      if (k < exp.length) continue;
      const found = snippet(doc, i, i + exp.length - 1);
      if (eq(found)) return { status: 'ok', encontrado: found };
      if (first === null) first = found;
    }
    if (first !== null) return { status: 'minor', encontrado: first, nota: 'Difiere solo en formato (acentos, puntuación o abreviaturas).' };
    const w = findWindow(doc, new Set(exp));
    const ratio = w.score / new Set(exp).size;
    if (w.i >= 0 && ratio >= 0.5) {
      const a = Math.max(0, w.i - 2), b = Math.min(doc.tokens.length - 1, w.last + 2);
      return { status: 'error', encontrado: snippet(doc, a, b), nota: 'El nombre no coincide exactamente. Lo más parecido en el documento se muestra en "Encontrado".' };
    }
    const hits = w.i >= 0 ? [...w.seen] : [];
    return { status: 'error', encontrado: '— no aparece —', nota: hits.length
      ? `Motivo: del nombre de la ficha solo se encontró ${hits.join(', ')} (${hits.length} de ${new Set(exp).size} palabras); el resto no está en el documento.`
      : 'Motivo: ninguna palabra del nombre de la ficha está en el documento. Revisa que sea el cliente correcto.' };
  }
  function checkAddress(doc, addr, opts) {
    opts = opts || {};
    const exp = new Set(tokenize(addr).map(k => k.t).filter(t => !GENERIC.has(t)));
    if (!exp.size) return { status: 'na', encontrado: '', nota: 'La ficha no trae este dato.' };
    const w = findWindow(doc, exp);
    if (w.i < 0 || w.score / exp.size < 0.34) return { status: 'error', encontrado: '— no aparece —', nota: `Motivo: solo ${w.i < 0 ? 0 : w.score} de ${exp.size} datos del domicilio de la ficha están en el documento, así que no se reconoce como el mismo domicilio.` };
    const missing = [...exp].filter(t => !w.seen.has(t));
    const a = Math.max(0, w.i - (missing.length ? 3 : 0)), b = Math.min(doc.tokens.length - 1, w.last + (missing.length ? 3 : 0));
    const found = snippet(doc, a, b);
    if (!missing.length) return { status: 'ok', encontrado: found };
    const numMissing = missing.filter(t => /\d/.test(t));
    const nota = 'No se localizó: ' + missing.join(', ') + '.';
    if (opts.soft) return { status: w.score / exp.size >= 0.5 ? 'review' : 'error', encontrado: found, nota };
    if (numMissing.length || missing.length > Math.max(1, Math.floor(exp.size * 0.2))) return { status: 'error', encontrado: found, nota };
    return { status: 'review', encontrado: found, nota };
  }
  const onlyDigits = s => (s || '').replace(/\D/g, '');
  function checkDigits(doc, value) {
    const d = onlyDigits(value);
    if (!d) return { status: 'na', encontrado: '', nota: 'La ficha no trae este dato.' };
    if (doc.digits.includes(d)) return { status: 'ok', encontrado: value };
    const d2 = d.replace(/^0+/, '');
    if (d2.length >= 6 && doc.digits.includes(d2)) return { status: 'minor', encontrado: d2, nota: 'Aparece sin los ceros iniciales.' };
    // ¿hay un número parecido? (mismo largo y 1–2 dígitos distintos, o un dígito de más/de menos)
    let near = null;
    for (const m of doc.digits.match(/\d{6,}/g) || []) {
      if (Math.abs(m.length - d.length) > 1) continue;
      const dist = m.length === d.length ? [...m].filter((c, i) => c !== d[i]).length : lev(m, d);
      if (dist <= 2 && (!near || dist < near.dist)) near = { m, dist, same: m.length === d.length };
    }
    if (near) return { status: 'error', encontrado: near.m, nota: near.same
      ? `El documento trae un número parecido con ${near.dist} dígito${near.dist > 1 ? 's' : ''} distinto${near.dist > 1 ? 's' : ''} al de la ficha (${d}).`
      : `El documento trae un número parecido, pero con ${near.m.length > d.length ? 'un dígito de más' : 'un dígito de menos'} respecto a la ficha (${d}).` };
    return { status: 'error', encontrado: '— no aparece —', nota: `Motivo: ningún número del documento se parece al de la ficha (${d}).` };
  }

  /* ---------- números, fechas ---------- */
  function num(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v).replace(/[$,%\s]|USD|MXN|M\.?N\.?/gi, '');
    if (s === '') return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }
  const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const money = n => n === null || n === undefined ? '—' : '$' + r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const DATE_RE = /(\d{1,2})\s*(?:DE\s+)?(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s*(?:DE|DEL)?\s*(\d{4})|(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/;
  function parseDate(s) {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = flat(s).match(DATE_RE);
    if (!m) return null;
    if (m[1]) { let i = MESES.indexOf(m[2]); if (i < 0) i = 8; return iso(m[3], i + 1, +m[1]); }
    return iso(m[6], +m[5], +m[4]);
  }
  const fmtDate = d => { if (!d) return '—'; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
  const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

  /* ---------- cifra en letra ---------- */
  const U = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
    'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUN', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO',
    'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
  function w999(n) {
    if (n === 100) return 'CIEN';
    const p = [];
    if (n >= 100) { p.push(C[Math.floor(n / 100)]); n %= 100; }
    if (n >= 30) { p.push(D[Math.floor(n / 10)] + (n % 10 ? ' Y ' + U[n % 10] : '')); }
    else if (n > 0) p.push(U[n]);
    return p.join(' ');
  }
  function numToWords(n) {
    n = Math.floor(n);
    if (n === 0) return 'CERO';
    const mill = Math.floor(n / 1e6), mil = Math.floor(n % 1e6 / 1e3), rest = n % 1e3, p = [];
    if (mill) p.push(mill === 1 ? 'UN MILLON' : w999(mill) + ' MILLONES');
    if (mil) p.push(mil === 1 ? 'MIL' : w999(mil) + ' MIL');
    if (rest) p.push(w999(rest));
    return p.join(' ');
  }
  /* --- explicación de por qué no coincide la cifra en letra --- */
  const WVAL = (() => {
    const v = { CIEN: 100, UNO: 1 };
    U.forEach((w, n) => { if (w) v[w] = n; });
    D.forEach((w, n) => { if (w) v[w] = n * 10; });
    C.forEach((w, n) => { if (w) v[w] = n * 100; });
    return v;
  })();
  // Lee una cifra escrita en letra; null si alguna palabra no es un número.
  function wordsToNum(toks) {
    let total = 0, sub = 0, cur = 0, any = false;
    for (const t of toks) {
      if (t === 'Y') continue;
      if (t === 'MIL') { sub += (cur || 1) * 1000; cur = 0; }
      else if (t === 'MILLON' || t === 'MILLONES') { total += (sub + cur || 1) * 1e6; sub = 0; cur = 0; }
      else if (WVAL[t] !== undefined) cur += WVAL[t];
      else return null;
      any = true;
    }
    return any ? total + sub + cur : null;
  }
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  // Diferencias entre lo que dice (a) y lo que debe decir (b), por tramos.
  function diffRuns(a, b) {
    const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const runs = []; let i = 0, j = 0, cur = null;
    const flush = () => { if (cur) { runs.push(cur); cur = null; } };
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; }
      else { cur = cur || { dice: [], debe: [] }; if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) cur.dice.push(a[i++]); else cur.debe.push(b[j++]); }
    }
    flush();
    return runs;
  }
  function explainLetra(doc, exp, cifra) {
    const T = doc.tokens, base = `La cifra en letra no coincide con la cifra en número (${money(cifra)}). `;
    const w = findWindow(doc, new Set(exp.filter(t => t !== 'Y')));
    if (w.i < 0 || w.score < 2) return { encontrado: '— no aparece —', nota: base + 'Motivo: no se encontró ninguna cantidad escrita con letra en el Pagaré.' };
    // inicio: si hay un paréntesis justo antes, la cifra en letra empieza ahí
    let a = w.i;
    const par = doc.raw.lastIndexOf('(', T[a].s);
    if (par >= 0 && T[a].s - par < 40) while (a > 0 && T[a - 1].s > par) a--;
    // fin: hasta antes de "PESOS" (o hasta la última palabra reconocida)
    let b = w.last;
    for (let k = a; k < Math.min(T.length, a + exp.length + 10); k++) if (/^(PESOS?|DOLARES|USD)$/.test(T[k].t)) { b = k - 1; break; }
    if (b < a) b = w.last;
    const dice = T.slice(a, b + 1).map(k => k.t);
    const encontrado = snippet(doc, a, Math.min(T.length - 1, b + 3));
    const q = x => '«' + x.join(' ') + '»';
    const motivos = diffRuns(dice, exp).map(r => {
      if (r.dice.length && r.debe.length) {
        if (r.dice.join('') === r.debe.join('')) return `palabras mal separadas: dice ${q(r.dice)} y debe decir ${q(r.debe)}`;
        if (lev(r.dice.join(' '), r.debe.join(' ')) <= 2) return `error de ortografía: dice ${q(r.dice)} y debe decir ${q(r.debe)}`;
        return `dice ${q(r.dice)} y debe decir ${q(r.debe)}`;
      }
      return r.debe.length ? `falta ${q(r.debe)}` : `sobra ${q(r.dice)}`;
    });
    const n = wordsToNum(dice);
    let extra = '';
    if (n !== null && n !== Math.floor(r2(cifra))) extra = ` La letra dice ${money(n).replace(/\.00$/, '')}, que es otra cantidad.`;
    else if (n !== null) extra = ' La cantidad es la misma, pero no está escrita en la forma estándar.';
    return { encontrado, nota: base + 'Motivo: ' + (motivos.length ? motivos.join('; ') : 'la redacción no es la esperada') + '.' + extra };
  }
  function checkLetra(doc, cifra) {
    const ent = Math.floor(r2(cifra)), cents = String(Math.round((r2(cifra) - ent) * 100)).padStart(2, '0');
    const words = numToWords(ent);
    const esperado = `${words} PESOS ${cents}/100 M.N.`;
    const variants = [words, words.replace(/^MIL\b/, 'UN MIL'), words.replace(/ MILLONES? MIL\b/, m => m.replace(' MIL', ' UN MIL'))];
    let i = -1, used = null;
    for (const v of variants) { const exp = tokenize(v).map(k => k.t); i = findContiguous(doc, exp); if (i >= 0) { used = exp; break; } }
    if (i < 0) return Object.assign({ status: 'error', esperado }, explainLetra(doc, tokenize(words).map(k => k.t), cifra));
    const tail = doc.tokens.slice(i + used.length, i + used.length + 4).map(k => k.t);
    const found = snippet(doc, i, Math.min(doc.tokens.length - 1, i + used.length + 3));
    const centsOk = tail.includes(String(+cents)) && tail.includes('100');
    if (!centsOk) return { status: 'error', esperado, encontrado: found, nota: `Los centavos en letra no son ${cents}/100.` };
    return { status: 'ok', esperado, encontrado: found };
  }

  /* ---------- catálogo ---------- */
  function parseCatalog(md) {
    md = (md || '').replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '');
    const cat = { factorante: { nombre: 'ACTIVE LEASING, S.A. DE C.V.', apoderado: '', cuenta: '', clabe: '', banco: '' }, clientes: [] };
    for (const part of md.split(/^## /m)) {
      if (/^Datos constantes/i.test(part)) {
        let m;
        if ((m = part.match(/\*\*Factorante:\*\*\s*(.+)/))) cat.factorante.nombre = stripMd(m[1]);
        if ((m = part.match(/\*\*Apoderado[^*]*:\*\*\s*(.+)/))) cat.factorante.apoderado = stripMd(m[1]);
        if ((m = part.match(/cta\.\s*\*\*([^*]+)\*\*/i))) cat.factorante.cuenta = m[1];
        if ((m = part.match(/CLABE\s*\*\*(\d{18})\*\*/))) cat.factorante.clabe = m[1];
        if ((m = part.match(/\):\s*([A-ZÁÉÍÓÚÑa-z]+)\s*·\s*cta/))) cat.factorante.banco = m[1];
      } else if (/^Cliente:/i.test(part)) {
        const c = parseClient(part);
        if (c) cat.clientes.push(c);
      }
    }
    return cat;
  }
  // nombre(s) de depositario escritos en un renglón de la ficha (sin RFC, domicilio ni notas entre paréntesis)
  function depName(line) {
    const t = stripMd(String(line || '').replace(/^\**(Nombre|Depositarios?|Persona (moral|f[ií]sica)[^:*]*)\**\s*:\**\s*/i, '').split(' — ')[0].replace(/\([^)]*\)/g, ''));
    if (!t || /^(ninguno|no aplica|n\/a|—|-)\b/i.test(t) || /^(RFC|Domicilio)\b/i.test(t)) return [];
    return t.split(/\s*;\s*|\s+\/\s+| y (?=[A-ZÁÉÍÓÚÑ])/).map(x => x.replace(/[.,;]+$/, '').trim()).filter(Boolean);
  }
  /* El Anexo debe nombrar como Depositario a la persona de la ficha ("..., como Depositario" / "en su calidad de Depositario"). */
  function depositariosIn(doc) {
    const T = doc.tokens, out = [];
    for (let i = 0; i < T.length; i++) {
      if (T[i].t !== 'DEPOSITARIO' && T[i].t !== 'DEPOSITARIOS') continue;
      let e = i - 1;
      if (e >= 0 && T[e].t === 'COMO') e--;
      else if (e >= 3 && T[e].t === 'DE' && T[e - 1].t === 'CALIDAD' && T[e - 2].t === 'SU' && T[e - 3].t === 'EN') e -= 4;
      else continue;                                               // "Depositario" suelto (rótulo de firma, cláusula): no nombra a nadie
      if (e < 0) continue;
      // el nombre va desde el separador anterior (coma, punto y coma, " y ") hasta aquí
      let a = e;
      while (a > 0 && e - a < 9 && T[a - 1].t !== 'Y' && !/[,;:]/.test(doc.raw.slice(T[a - 1].e, T[a].s)) && !/^(SOLIDARIOS?|FACTORADO|FACTORANTE|UNO)$/.test(T[a - 1].t)) a--;
      out.push({ a, e, toks: T.slice(a, e + 1).map(k => k.t), texto: snippet(doc, a, e).replace(/[,;]+$/, '') });
    }
    return out;
  }
  // Acepta uno o varios depositarios de la ficha: cada persona que el Anexo nombre "como Depositario" debe ser alguno de ellos.
  function checkDepositario(doc, names) {
    names = [].concat(names || []).filter(Boolean);
    const exps = names.map(n => tokenize(n).map(k => k.t).join(' ')), found = depositariosIn(doc);
    if (!found.length) return { status: 'error', encontrado: '— no aparece —', nota: 'Motivo: el Anexo no nombra a nadie "como Depositario".' };
    const ok = f => exps.includes(f.toks.join(' '));
    const uniq = xs => [...new Set(xs)];
    if (found.every(ok)) return { status: 'ok', encontrado: uniq(found.map(f => f.texto)).join(' · ') };
    const bad = found.find(f => !ok(f)), lista = names.length > 1 ? 'ninguno de los depositarios de la ficha' : 'el de la ficha';
    const cerca = exps.some(e => lev(bad.toks.join(' '), e) <= 3);
    const nota = cerca ? `El nombre del Depositario se parece al de la ficha pero está escrito distinto (posible error de ortografía): dice «${bad.texto}».`
      : found.some(ok) ? `El Anexo nombra al Depositario ${found.length} veces y en una dice «${bad.texto}», que no es ${lista}.`
      : `El Anexo nombra como Depositario a «${bad.texto}», que no es ${lista}.`;
    return { status: 'error', encontrado: uniq(found.map(f => f.texto)).join(' · '), nota };
  }
  function parseClient(part) {
    const secs = part.split(/^### /m);
    const head = secs[0];
    const c = {
      nombre: stripMd(head.split('\n')[0].replace(/^Cliente:\s*/i, '')), raw: part, contrato: '', fechaContrato: null, fechaExtraccion: '',
      tasas: {}, tasasVigente: '', rfc: '', domicilio: '', os: [], firmantes: [], cuenta: {}, reglas: [], notaAvales: [], depositarios: []
    };
    let m;
    if ((m = head.match(/\*\*Número de contrato:\*\*\s*(\S+)/))) c.contrato = m[1];
    if ((m = head.match(/\*\*Fecha de firma del contrato:\*\*\s*(.+)/))) c.fechaContrato = parseDate(m[1]);
    if ((m = head.match(/\*\*Fecha de extracción de la ficha:\*\*\s*(.+)/))) c.fechaExtraccion = stripMd(m[1]);
    for (const sec of secs.slice(1)) {
      const nl = sec.indexOf('\n'), title = sec.slice(0, nl < 0 ? undefined : nl), body = nl < 0 ? '' : sec.slice(nl + 1);
      const lines = body.split('\n').filter(l => /^- /.test(l)).map(l => l.slice(2).trim());
      if (/Regla.*especial/i.test(title)) c.reglas.push(...lines.map(stripMd));
      else if (/^Tasa de descuento/i.test(title)) {
        for (const l of lines) {
          if ((m = l.match(/^(\d+) días →\s*\*\*([\d.]+)%\*\*/))) c.tasas[m[1]] = +m[2];
          else if ((m = l.match(/^(\d+) días →/))) c.tasas[m[1]] = null;
          else if ((m = l.match(/Vigente al:\*\*\s*(.+)/))) c.tasasVigente = m[1].trim();
        }
      } else if (/^Factorado/i.test(title)) {
        for (const l of lines) {
          if ((m = l.match(/^Razón social:\s*(.+)/))) c.nombre = stripMd(m[1]);
          else if ((m = l.match(/^RFC:\s*\*\*([^*]+)\*\*/))) c.rfc = /no aplica/i.test(m[1]) ? '' : m[1];
          else if ((m = l.match(/^Domicilio:\s*(.+)/))) c.domicilio = m[1].replace(/\s*\([^)]*\)\s*$/, '').trim();
        }
      } else if (/^Obligados Solidarios/i.test(title)) {
        for (let l of lines) {
          let tipo = null;
          if ((m = l.match(/^\*\*Persona (moral|f[ií]sica)[^*]*:\*\*\s*/i))) { tipo = /moral/i.test(m[1]) ? 'PM' : 'PF'; l = l.slice(m[0].length); }
          if (/^\**ninguno/i.test(l) || !l) continue;
          const segs = l.split(' — ');
          if (segs.length < 3) continue;
          const nombre = stripMd(segs[0]);
          const rfc = ((segs.find(s => /RFC/.test(s)) || '').match(/\*\*([A-Z0-9&Ñ]+)\*\*/) || [])[1] || '';
          let dom = segs[segs.length - 1], nota = '';
          if ((m = dom.match(/\s*\(([^)]*)\)\s*$/))) { nota = stripMd(m[1]); dom = dom.slice(0, m.index); }
          if (!tipo) tipo = /\b(S\.?\s?A\.?|S\. DE R\.L\.|LLC|S\.A\.P\.I\.)/.test(nombre) ? 'PM' : 'PF';
          c.os.push({ tipo, nombre, rfc, domicilio: stripMd(dom), nota });
        }
      } else if (/^Firmantes/i.test(title)) {
        for (const l of lines) {
          stripMd(l.replace(/\([^)]*\)/g, '')).split(/ y (?=[A-ZÁÉÍÓÚÑ])/).map(s => s.trim()).filter(Boolean).forEach(n => c.firmantes.push(n));
        }
      } else if (/^Depositario/i.test(title)) {
        for (const l of lines) depName(l).forEach(n => c.depositarios.push(n));
      } else if (/^Nota de avales/i.test(title)) c.notaAvales.push(...lines.map(stripMd));
      else if (/^Cuenta del factorado/i.test(title)) {
        c.cuenta.validacion = stripMd(title);
        for (const l of lines) {
          const k = l.match(/^([^:]+):\s*(.*)$/); if (!k) continue;
          const val = stripMd(((k[2].match(/\*\*([^*]+)\*\*/) || [])[1]) || k[2]);
          const clean = /^(no aplica|—)/i.test(val) ? '' : val;
          if (/^Banco/i.test(k[1])) c.cuenta.banco = clean;
          else if (/^No\. de cuenta/i.test(k[1])) c.cuenta.numero = clean;
          else if (/^Sucursal/i.test(k[1])) c.cuenta.sucursal = clean;
          else if (/^CLABE/i.test(k[1])) c.cuenta.clabe = onlyDigits(clean).slice(0, 18);
          else if (/^Titular/i.test(k[1])) c.cuenta.titular = clean;
          else if (/^Nota/i.test(k[1])) c.reglas.push('Cuenta: ' + stripMd(k[2]));
        }
      }
    }
    // también se acepta como renglón suelto en cualquier parte de la ficha:  - **Depositario:** NOMBRE
    if (!c.depositarios.length) for (const l of part.split('\n')) { const k = l.match(/^\s*-\s*\**Depositarios?\**\s*:\**\s*(.+)$/i); if (k) depName(k[1]).forEach(n => c.depositarios.push(n)); }
    return c.contrato || c.os.length ? c : null;
  }
  function detectClient(cat, text) {
    if (!cat || !text) return -1;
    const doc = makeDoc(text);
    let best = -1, bs = 0;
    cat.clientes.forEach((c, i) => {
      let s = 0;
      if (contractsIn(doc.raw).some(x => sameContract(x, c.contrato))) s += 2;
      const p = findContiguous(doc, tokenize(c.nombre).map(k => k.t));
      if (p >= 0) s += 3 + 1 / (1 + p);
      if (s > bs) { bs = s; best = i; }
    });
    return bs >= 2 ? best : -1;
  }

  /* ---------- lectura automática de campos (mejor esfuerzo; el usuario los revisa) ---------- */
  const contractsIn = raw => [...new Set((raw.match(/\b\d{2,5}\/\d{3}\b/g) || []))];
  const sameContract = (a, b) => a.split('/').map(x => +x).join('/') === String(b).split('/').map(x => +x).join('/');
  function extractFields(anexoText, pagareText) {
    const out = {};
    if (anexoText) {
      const F = flat(anexoText);
      const after = (re, len, multi) => { const m = re.exec(F); if (!m) return null; const t = F.slice(m.index + m[0].length, m.index + m[0].length + (len || 90)); return multi ? t : t.split('\n')[0]; };
      const dateAfter = re => { const m = re.exec(F); return m ? parseDate(m[1]) : null; };
      const DT = '(\\d{1,2}\\s*(?:DE\\s+)?[A-Z]+\\s*(?:DE|DEL)?\\s*\\d{4}|\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{4})';
      const amt = s => { if (!s) return null; const m = s.match(/\$\s*([\d,]+\.\d{2})|(?<![\d.\/])(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?!\s*%|\d)/); return m ? num(m[1] || m[2]) : null; };
      const pct = s => { if (!s) return null; const m = s.match(/(\d+(?:\.\d+)?)\s*%/); return m ? +m[1] : null; };
      const set = (k, v) => { if (v !== null && v !== undefined) out[k] = v; };
      set('valorNominal', amt(after(/VALOR NOMINAL(?! TOTAL)/)));
      set('tipoCambio', amt(after(/TIPO DE CAMBIO/, 40)));
      set('valorNominalTotal', amt(after(/VALOR NOMINAL TOTAL(?: EN PESOS)?/)));
      const af = after(/(?<![A-Z])AFORO/, 70); set('aforoPct', pct(af)); set('aforo', amt(af));
      set('precioBase', amt(after(/PRECIO BASE/)));
      set('tasaPct', pct(after(/TASA DE DESCUENTO/, 60)));
      set('descuento', amt(after(/(?<!TASA DE |IVA |IVA DE |IVA DEL |IVA DE LA )DESCUENTO(?! MENSUAL)/, 60)));
      set('ivaDescuento', amt(after(/IVA (?:DEL? |DE LA )?DESCUENTO/, 60)));
      const co = after(/(?<!IVA |IVA DE |IVA DE LA |IVA DEL |IVA POR )COMISION POR DISPOSICION/, 70, true); set('comisionPct', pct(co)); set('comision', amt(co));
      set('ivaComision', amt(after(/IVA (?:DE LA |DEL? |POR )?COMISION(?: POR DISPOSICION)?/, 60)));
      set('precioDerechos', amt(after(/PRECIO DE LOS DERECHOS DE CREDITO/)));
      set('pagoRealizar', amt(after(/PAGO A REALIZAR EN LA FECHA MAXIMA DE PAGO/)));
      const pl = after(/(?<![A-Z])PLAZO/, 40); if (pl) { const m = pl.match(/(\d{1,3})\s*(?:DIAS)?/); if (m) out.plazo = +m[1]; }
      set('fechaMax', parseDate(after(/(?<!EN LA )FECHA MAXIMA DE PAGO/, 60)));
      set('fechaInicio', parseDate(after(/FECHA DE (?:INICIO|DISPOSICION)/, 60)) || dateAfter(new RegExp('SE FIRMA[^\\n]{0,80}?EL DIA\\s+' + DT)) || dateAfter(new RegExp('EL DIA\\s+' + DT + '\\s*\\(EL .CONTRATO')));
      const tf = F.indexOf('TABLA DE FACTURAS');
      if (tf >= 0) { const xs = F.slice(tf).match(/\$\s*[\d,]+\.\d{2}/g); if (xs) out.facturas = xs.map(x => x.replace(/[$\s]/g, '')).join('\n'); }
      const os = F.match(/["“”]\s*OBLIGADOS? SOLIDARIOS?(?! UNO)[^"“”\n]*["“”]/g); if (os) out.numOS = os.length;
      const tt = after(/TRIGESIMA TERCERA/, 400, true); if (tt) { const m = tt.match(/DE FECHA([\s\S]{0,60})/); if (m) set('fechaContratoApendice', parseDate(m[1])); }
    }
    if (pagareText) {
      const F = flat(pagareText);
      const DT = '(\\d{1,2}\\s*(?:DE\\s+)?[A-Z]+\\s*(?:DE|DEL)?\\s*\\d{4}|\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{4})';
      const dateAfter = re => { const m = re.exec(F); return m ? parseDate(m[1]) : null; };
      const m = F.match(/\$\s*([\d,]+\.\d{2})/); if (m) out.pagareCifra = num(m[1]);
      const d = dateAfter(new RegExp('SE SUSCRIBE[\\s\\S]{0,80}?EL DIA\\s+' + DT)); if (d) out.pagareFecha = d;
      const v = dateAfter(new RegExp('A\\s+MAS\\s+TARDAR\\s+EL\\s+DIA\\s+' + DT)); if (v) out.pagareVence = v;
      const av = F.match(/["“”]\s*AVAL(?:ES)?\b[^"“”\n]*["“”]/g); if (av) out.numAvales = av.length;
    }
    return out;
  }

  /* ---------- regla de tasa ---------- */
  function tasaRule(plazo, tasa, tabla) {
    const periods = [30, 60, 90, 120].filter(p => tabla[p] !== null && tabla[p] !== undefined);
    if (!periods.length) return { status: 'na', nota: 'La ficha no trae tabla de tasas.' };
    const max = Math.max(...periods), acc = [];
    if (plazo < 30) acc.push({ p: 30, esc: 'Sub-30 (plazo menor a 30 días usa la tasa de 30)' });
    else {
      const sup = periods.find(p => p >= plazo);
      if (sup) acc.push({ p: sup, esc: sup === plazo ? 'Periodo exacto' : 'Periodo superior' });
      const inf = [...periods].reverse().find(p => p < plazo && plazo - p <= 10);
      if (inf) acc.push({ p: inf, esc: 'Días de gracia' });
    }
    const esperado = acc.length ? acc.map(a => `${tabla[a.p].toFixed(2)}% (periodo ${a.p}, ${a.esc.toLowerCase().split(' (')[0]})`).join(' o ')
      : `Plazo no autorizado (máximo ${max} días + 10 de gracia)`;
    if (!acc.length) return { status: 'error', esperado, nota: `El plazo de ${plazo} días excede el máximo autorizado para este cliente (${max} días).` };
    const hit = acc.find(a => Math.abs(tabla[a.p] - tasa) < 0.0005);
    if (hit) return { status: 'ok', esperado, nota: `Tasa ${tasa.toFixed(2)}% · periodo de ${hit.p} días · escenario: ${hit.esc}.` };
    const other = periods.find(p => Math.abs(tabla[p] - tasa) < 0.0005);
    return { status: 'error', esperado, nota: other ? `La tasa ${tasa.toFixed(2)}% es la del periodo de ${other} días, que no aplica para un plazo de ${plazo} días.` : `La tasa ${tasa.toFixed(2)}% no está en la tabla autorizada del cliente.` };
  }

  /* ---------- validación completa ---------- */
  function validate(inp) {
    const { cliente: c, factorante: fa, fechaFirma } = inp;
    const f = inp.campos || {};
    const A = inp.anexoText ? makeDoc(inp.anexoText) : null;
    const P = inp.pagareText ? makeDoc(inp.pagareText) : null;
    const checks = [];
    const add = (doc, campo, fuente, esperado, r, sev) => checks.push({ doc, campo, fuente, esperado, encontrado: r.encontrado === undefined ? '' : r.encontrado, status: r.status, nota: r.nota || '', sev: sev || 'material' });
    const noText = name => ({ status: 'pending', encontrado: '', nota: `Falta el texto del ${name}.` });
    const pend = what => ({ status: 'pending', encontrado: '', nota: `No se pudo leer del documento: ${what}.` });
    const cmpDate = (found, exp, labelMissing) => !found ? pend(labelMissing) : !exp ? { status: 'pending', encontrado: fmtDate(found), nota: 'Falta la fecha de firma (Paso 3).' }
      : found === exp ? { status: 'ok', encontrado: fmtDate(found) }
      : { status: 'error', encontrado: fmtDate(found), nota: `Difiere por ${Math.abs(dayDiff(exp, found))} día(s).` };
    const cmpMoney = (found, exp, what) => found === null ? pend(what) : exp === null ? pend('los datos para calcularlo')
      : Math.abs(found - exp) <= 0.021 ? { status: 'ok', encontrado: money(found) }
      : { status: 'error', encontrado: money(found), nota: `Diferencia de ${money(Math.abs(found - exp))}.` };

    /* ===== ANEXO ===== */
    if (A) {
      const cs = contractsIn(A.raw), bad = cs.filter(x => !sameContract(x, c.contrato));
      add('anexo', 'Número de contrato', 'Ficha', c.contrato,
        !cs.length ? { status: 'error', encontrado: '— no aparece —', nota: 'No se encontró ningún número de contrato en el Anexo.' }
          : bad.length ? { status: 'error', encontrado: cs.join(', '), nota: `Aparece un número distinto al de la ficha: ${bad.join(', ')}.` }
            : cs.every(x => x === c.contrato) ? { status: 'ok', encontrado: cs.join(', ') }
              : { status: 'minor', encontrado: cs.join(', '), nota: 'Mismo número, distinto relleno de ceros.' });
      add('anexo', 'Factorado (razón social)', 'Ficha', c.nombre, checkName(A, c.nombre));
      c.os.forEach(o => add('anexo', `Obligado solidario (${o.tipo})`, 'Ficha', o.nombre, checkName(A, o.nombre)));
    } else {
      add('anexo', 'Texto del Anexo', 'Documento', 'Anexo cargado', noText('Anexo'));
    }
    const nOS = num(f.numOS);
    add('anexo', 'Cantidad de obligados solidarios', 'Ficha', String(c.os.length),
      nOS === null ? pend('cuántos obligados solidarios aparecen en el Anexo')
        : nOS === c.os.length ? { status: 'ok', encontrado: String(nOS) }
          : { status: 'error', encontrado: String(nOS), nota: nOS > c.os.length ? 'Hay obligados solidarios de más.' : 'Faltan obligados solidarios.' });

    const plazo = num(f.plazo), tasa = num(f.tasaPct);
    if (plazo === null || tasa === null) add('anexo', 'Tasa de descuento', 'Ficha', 'Según tabla de periodos', pend('plazo y tasa de descuento'));
    else { const t = tasaRule(plazo, tasa, c.tasas); add('anexo', 'Tasa de descuento', 'Ficha', t.esperado || '', { status: t.status, encontrado: `${tasa.toFixed(2)}% a ${plazo} días`, nota: t.nota }); }

    if (A) {
      const cu = c.cuenta || {};
      if (cu.banco) {
        const alts = cu.banco.split(/[()]/).map(s => s.trim()).filter(Boolean);
        const hit = alts.map(a => checkName(A, a)).find(r => r.status === 'ok' || r.status === 'minor');
        add('anexo', 'Cuenta del factorado · Banco', 'Ficha', cu.banco, hit ? { status: 'ok', encontrado: hit.encontrado } : { status: 'error', encontrado: '— no aparece —', nota: 'El banco de la ficha no aparece en el Anexo.' });
      }
      if (cu.numero) {
        const r = checkDigits(A, cu.numero.replace(/\(.*$/, ''));
        const m = A.raw.match(/No\.?\s*de\s*Cuenta\s*:?\s*([\d][\d\- ]{4,}\d)/i);
        if (r.status === 'error' && m) { r.encontrado = m[1].trim(); r.nota = 'El Anexo trae una cuenta distinta a la de la ficha.'; }
        add('anexo', 'Cuenta del factorado · No. de cuenta', 'Ficha', cu.numero, r);
      }
      if (cu.sucursal) add('anexo', 'Cuenta del factorado · Sucursal', 'Ficha', cu.sucursal, checkAddress(A, cu.sucursal.replace(/[()]/g, ' '), { soft: true }));
      if (cu.clabe) {
        const all = [...new Set(A.digits.match(/(?<!\d)\d{18}(?!\d)/g) || [])];
        const others = all.filter(x => x !== cu.clabe && x !== fa.clabe);
        add('anexo', 'Cuenta del factorado · CLABE', 'Ficha', cu.clabe,
          !all.includes(cu.clabe) ? { status: 'error', encontrado: all.length ? all.join(', ') : '— no aparece —', nota: all.length ? 'El Anexo trae una CLABE distinta a la de la ficha.' : 'La CLABE de la ficha no aparece en el Anexo.' }
            : others.length ? { status: 'review', encontrado: all.join(', '), nota: `Además de la CLABE correcta aparece otra: ${others.join(', ')}.` }
              : { status: 'ok', encontrado: cu.clabe });
      }
      c.firmantes.forEach(n => add('anexo', 'Firmante del cliente', 'Ficha', n, checkName(A, n)));
      if ((c.depositarios || []).length) add('anexo', c.depositarios.length > 1 ? 'Depositario (cualquiera de la ficha)' : 'Depositario', 'Ficha', c.depositarios.join(' / '), checkDepositario(A, c.depositarios));
      else { const d = depositariosIn(A)[0]; add('anexo', 'Depositario', 'Ficha', '— la ficha no lo trae —', { status: 'review', encontrado: d ? d.texto : '— no aparece —', nota: 'La ficha de este cliente no trae Depositario, así que no se pudo comparar. Agrégalo a la ficha (- **Depositario:** NOMBRE) y confírmalo a ojo mientras tanto.' }); }
      if (fa.apoderado) add('anexo', 'Firmante de Active Leasing', 'Ficha', fa.apoderado, checkName(A, fa.apoderado));
    }
    const fIni = parseDate(f.fechaInicio), fMax = parseDate(f.fechaMax), fFirma = parseDate(fechaFirma);
    add('anexo', 'Fecha de inicio de disposición', 'Fecha de firma', fmtDate(fFirma), cmpDate(fIni, fFirma, 'fecha de inicio de la disposición'));
    add('anexo', 'Fecha del contrato citada en el Apéndice', 'Ficha', fmtDate(c.fechaContrato), cmpDate(parseDate(f.fechaContratoApendice), c.fechaContrato, 'fecha del contrato citada en el Apéndice'));

    /* ===== VERIFICACIONES INTERNAS ===== */
    const vn = num(f.valorNominal), tc = num(f.tipoCambio); let vnt = num(f.valorNominalTotal);
    const afPct = num(f.aforoPct), aforo = num(f.aforo), pb = num(f.precioBase), desc = num(f.descuento), ivaD = num(f.ivaDescuento);
    const com = num(f.comision), ivaC = num(f.ivaComision), pdc = num(f.precioDerechos), pago = num(f.pagoRealizar);
    const divisa = tc !== null && tc > 0 && tc !== 1;
    const I = (campo, esperadoTxt, r) => add('interno', campo, 'Aritmética', esperadoTxt, r);
    if (divisa) {
      const e = vn !== null ? r2(vn * tc) : null;
      I('Valor Nominal Total en Pesos = Valor Nominal × Tipo de cambio', e === null ? '—' : `${money(vn)} × ${tc} = ${money(e)}`, cmpMoney(vnt, e, 'Valor Nominal Total en Pesos'));
    } else if (vnt === null && vn !== null) vnt = vn;
    if (afPct !== null && aforo !== null) { const e = vnt !== null ? r2(vnt * afPct / 100) : null; I('Aforo = Valor Nominal Total × % de aforo', e === null ? '—' : `${money(vnt)} × ${afPct}% = ${money(e)}`, cmpMoney(aforo, e, 'Aforo')); }
    {
      const e = vnt !== null && afPct !== null ? r2(vnt * (1 - afPct / 100)) : vnt !== null && aforo !== null ? r2(vnt - aforo) : null;
      I('Precio Base = Valor Nominal Total − Aforo', e === null ? '—' : money(e), cmpMoney(pb, e, 'Precio Base'));
    }
    {
      const e = pb !== null && tasa !== null && plazo !== null ? r2(pb * tasa / 100 * plazo / 30) : null;
      I('Descuento = Precio Base × Tasa mensual × (Plazo / 30)', e === null ? '—' : `${money(pb)} × ${tasa}% × ${plazo}/30 = ${money(e)}`, cmpMoney(desc, e, 'Descuento'));
    }
    const sinIVA = c.reglas.some(r => /NO se cobra IVA/i.test(r));
    {
      const e = desc !== null ? (sinIVA ? 0 : r2(desc * 0.16)) : null;
      let r = cmpMoney(ivaD === null && sinIVA ? 0 : ivaD, e, 'IVA del Descuento');
      if (sinIVA && r.status === 'error') r = { status: 'review', encontrado: money(ivaD), nota: 'Este cliente no causa IVA (factorado extranjero); un Anexo con IVA es sospechoso.' };
      I(sinIVA ? 'IVA del Descuento = $0.00 (cliente sin IVA)' : 'IVA del Descuento = 16% × Descuento', e === null ? '—' : money(e), r);
    }
    if (com !== null && com > 0) {
      const e = sinIVA ? 0 : r2(com * 0.16);
      I('IVA de la Comisión = 16% × Comisión', money(e), cmpMoney(ivaC === null ? 0 : ivaC, e, 'IVA de la Comisión'));
    }
    {
      const e = pb !== null && desc !== null ? r2(pb - desc - (ivaD || 0) - (com || 0) - (ivaC || 0)) : null;
      I('Precio de los Derechos de Crédito = Precio Base − Descuento − IVA − Comisión − IVA Comisión', e === null ? '—' : money(e), cmpMoney(pdc, e, 'Precio de los Derechos de Crédito'));
    }
    I('Pago a realizar en la Fecha Máxima de Pago = Precio Base', money(pb), cmpMoney(pago, pb, 'Pago a realizar'));
    {
      const e = fFirma && fMax ? dayDiff(fFirma, fMax) : null;
      I('Plazo = días de la fecha de firma a la Fecha Máxima de Pago', e === null ? '—' : `${fmtDate(fFirma)} → ${fmtDate(fMax)} = ${e} días`,
        plazo === null ? pend('plazo') : e === null ? pend('fecha de firma y Fecha Máxima de Pago') : plazo === e ? { status: 'ok', encontrado: `${plazo} días` } : { status: 'error', encontrado: `${plazo} días`, nota: `Diferencia de ${Math.abs(plazo - e)} día(s).` });
    }
    {
      const nums = String(f.facturas || '').split(/[\s;]+|,(?!\d{3}\b)/).map(num).filter(x => x !== null);
      const suma = nums.length ? r2(nums.reduce((a, b) => a + b, 0)) : null;
      const base = vn !== null ? vn : vnt;
      I('Suma de facturas = Valor Nominal (moneda original)', money(base), suma === null ? pend('importes de las facturas del Apéndice')
        : base === null ? pend('Valor Nominal') : Math.abs(suma - base) <= 0.021 ? { status: 'ok', encontrado: `${money(suma)} (${nums.length} facturas)` }
          : { status: 'error', encontrado: `${money(suma)} (${nums.length} facturas)`, nota: `Diferencia de ${money(Math.abs(suma - base))}.` });
    }
    if (c.reglas.some(r => /Siempre paga comisi[oó]n/i.test(r))) {
      add('interno', 'Comisión por Disposición (regla especial del cliente)', 'Ficha', 'Mayor a $0.00',
        com !== null && com > 0 ? { status: 'ok', encontrado: money(com) } : { status: 'review', encontrado: money(com || 0), nota: 'Este cliente siempre paga comisión por disposición; en 0 es sospechoso.' });
    }

    /* ===== PAGARÉ ===== */
    const cifra = num(f.pagareCifra);
    if (P) {
      add('pagare', 'Suscriptor (nombre del cliente)', 'Ficha', c.nombre, checkName(P, c.nombre));
      add('pagare', 'Domicilio del suscriptor', 'Ficha', c.domicilio, checkAddress(P, c.domicilio));
    } else add('pagare', 'Texto del Pagaré', 'Documento', 'Pagaré cargado', noText('Pagaré'));
    add('pagare', 'Cifra vs. Precio Base del Anexo', 'Anexo', money(pb), cmpMoney(cifra, pb, 'cifra del Pagaré'));
    if (P) {
      if (cifra === null) add('pagare', 'Cifra en número vs. cifra en letra', 'Mismo Pagaré', '—', pend('cifra del Pagaré'));
      else { const r = checkLetra(P, cifra); add('pagare', 'Cifra en número vs. cifra en letra', 'Mismo Pagaré', r.esperado, r); }
    }
    add('pagare', 'Fecha del Pagaré', 'Fecha de firma', fmtDate(fFirma), cmpDate(parseDate(f.pagareFecha), fFirma, 'fecha del Pagaré'));
    { // la fecha del Pagaré debe ser la misma que la del Anexo
      const fp = parseDate(f.pagareFecha);
      add('pagare', 'Fecha del Pagaré vs. fecha del Anexo', 'Anexo', fmtDate(fIni),
        !fp ? pend('fecha del Pagaré') : !fIni ? { status: 'pending', encontrado: fmtDate(fp), nota: 'No se pudo leer la fecha del Anexo para compararla.' }
        : fp === fIni ? { status: 'ok', encontrado: fmtDate(fp) }
        : { status: 'error', encontrado: fmtDate(fp), nota: `El Pagaré tiene fecha ${fmtDate(fp)} y el Anexo ${fmtDate(fIni)}: difieren por ${Math.abs(dayDiff(fIni, fp))} día(s). Deben ser la misma.` });
    }
    { // el vencimiento del Pagaré debe ser la Fecha Máxima de Pago del Anexo (siempre se revisa; si no se lee, queda pendiente)
      const fv = parseDate(f.pagareVence);
      add('pagare', 'Fecha de vencimiento vs. Fecha Máxima de Pago', 'Anexo', fmtDate(fMax),
        !fv ? pend('fecha de vencimiento del Pagaré') : !fMax ? { status: 'pending', encontrado: fmtDate(fv), nota: 'No se pudo leer la Fecha Máxima de Pago del Anexo para compararla.' }
        : fv === fMax ? { status: 'ok', encontrado: fmtDate(fv) }
        : { status: 'error', encontrado: fmtDate(fv), nota: `El Pagaré vence el ${fmtDate(fv)} y la Fecha Máxima de Pago del Anexo es ${fmtDate(fMax)}: difieren por ${Math.abs(dayDiff(fMax, fv))} día(s). Deben ser la misma.` });
    }
    if (P) {
      c.firmantes.forEach(n => add('pagare', 'Firmante del suscriptor', 'Ficha', n, checkName(P, n)));
      c.os.forEach(o => {
        add('pagare', `Aval (${o.tipo})`, 'Ficha', o.nombre, checkName(P, o.nombre));
        add('pagare', `Domicilio del aval ${o.tipo === 'PM' ? '(empresa)' : '(persona física)'} — ${o.nombre}`, 'Ficha', o.domicilio, checkAddress(P, o.domicilio));
      });
    }
    const nAv = num(f.numAvales);
    add('pagare', 'Cantidad de avales', 'Ficha', String(c.os.length),
      nAv === null ? pend('cuántos avales trae el Pagaré') : nAv === c.os.length ? { status: 'ok', encontrado: String(nAv) }
        : { status: 'error', encontrado: String(nAv), nota: nAv > c.os.length ? 'Hay avales de más.' : 'Faltan avales.' });
    if (P) {
      add('pagare', 'Beneficiario', 'Ficha', fa.nombre, checkName(P, fa.nombre));
      const soften = r => r.status === 'error' ? { status: 'review', encontrado: r.encontrado, nota: 'No se localizó en el Pagaré; confirma que la cuenta del beneficiario sea la del Factorante.' } : r;
      if (fa.cuenta) add('pagare', 'Cuenta del beneficiario', 'Ficha', fa.cuenta, soften(checkDigits(P, fa.cuenta)));
      if (fa.clabe) add('pagare', 'CLABE del beneficiario', 'Ficha', fa.clabe, soften(checkDigits(P, fa.clabe)));
      // empresas que aparecen en el Pagaré y no pertenecen a la ficha
      const known = flat(c.raw + ' ' + fa.nombre).replace(/[^A-Z0-9]+/g, ' ');
      const extra = new Set();
      const re = /((?:[A-ZÁÉÍÓÚÑ0-9&][A-Za-zÁÉÍÓÚÑáéíóúñ0-9&]*\s+(?:(?:de|del|la|los|y|en|and|on|DE|DEL|LA|LOS|Y|EN)\s+)*){0,6})[A-ZÁÉÍÓÚÑ0-9&][A-Za-zÁÉÍÓÚÑáéíóúñ0-9&]*,?\s+S\.?\s?(?:A\.?(?:\s?P\.?\s?I\.?)?|\s?[Dd][Ee]\s+R\.?\s?L\.?)\s+[Dd][Ee]\s+C\.?\s?V\.?/g;
      let m;
      while ((m = re.exec(P.raw))) {
        const name = collapse(m[0]);
        const core = flat(name).replace(/,?\s+S\.?\s?(A\.?(\s?P\.?\s?I\.?)?|\s?DE\s+R\.?\s?L\.?)\s+DE\s+C\.?\s?V\.?$/, '').replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').slice(-2).join(' ');
        if (core && !known.includes(core)) extra.add(name);
      }
      if (extra.size) add('pagare', 'Empresas ajenas a la ficha', 'Ficha', 'Ninguna', { status: 'review', encontrado: [...extra].join(' · '), nota: 'Aparece una empresa que no está en la ficha del cliente; confirma que no sea un aval de más.' });
    }

    /* ===== resumen ===== */
    const pts = { ok: 1, minor: 1, review: 0.5, error: 0 };
    const ev = checks.filter(k => k.status in pts);
    const sum = ev.reduce((a, k) => a + pts[k.status], 0);
    const count = s => checks.filter(k => k.status === s).length;
    const errors = count('error'), reviews = count('review'), pending = count('pending'), minors = count('minor');
    let pct = ev.length ? Math.floor(sum / ev.length * 100) : 0;
    if (ev.length && sum === ev.length) pct = 100;
    const part = d => { const x = checks.filter(k => k.doc === d); return { errors: x.filter(k => k.status === 'error').length, reviews: x.filter(k => k.status === 'review').length, pending: x.filter(k => k.status === 'pending').length }; };
    const veredicto = errors ? 'no-firmable' : pending ? 'incompleto' : reviews ? 'confirmar' : 'correcto';
    return { checks, pct, evaluados: ev.length, correctos: count('ok') + minors, errors, reviews, pending, minors, veredicto, anexo: part('anexo'), pagare: part('pagare'), interno: part('interno') };
  }

  const API = { parseCatalog, detectClient, extractFields, validate, tasaRule, numToWords, parseDate, fmtDate, money, num, makeDoc, checkName, checkAddress, checkLetra, checkDigits, checkDepositario, depositariosIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.VAL = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
