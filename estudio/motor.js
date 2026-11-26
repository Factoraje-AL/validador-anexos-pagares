/* Motor del llenado de la hoja Datos. Sin interfaz y sin IA: catálogo de renglones, comprobaciones aritméticas
   y escritura del Excel. Corre igual en el navegador y en Node (para las pruebas).

   Regla de oro: de la plantilla solo se tocan las celdas de captura de Datos (columnas B a E), la fecha y los meses
   del último periodo. Ninguna fórmula del sistema se modifica. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Motor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Renglones de captura de Datos: fila de Excel, nombre, grupo y sección. */
  const CATALOGO = [
    [19,'Caja y bancos','Efectivo','Activo circulante'],[20,'Inversiones en Valores','Efectivo','Activo circulante'],
    [22,'Vigente','Cuentas por Cobrar','Activo circulante'],[23,'Vencido','Cuentas por Cobrar','Activo circulante'],
    [24,'Estimación prev. para riesgos crediticios','Cuentas por Cobrar','Activo circulante'],[25,'Cartera Descontada','Cuentas por Cobrar','Activo circulante'],
    [27,'Cuentas por Cobrar','Cuentas por Cobrar Intercompañías','Activo circulante'],
    [29,'Materias primas y materiales','Inventario','Activo circulante'],[30,'Productos en proceso','Inventario','Activo circulante'],
    [31,'Artículos terminados','Inventario','Activo circulante'],[32,'Anticipo a proveedores','Inventario','Activo circulante'],
    [33,'Mercancías en tránsito','Inventario','Activo circulante'],[34,'Mercancías en consignación','Inventario','Activo circulante'],
    [35,'Reevaluación','Inventario','Activo circulante'],[36,'Estimaciones por obsolencia','Inventario','Activo circulante'],
    [38,'ISR','Pagos Anticipados e Impuestos','Activo circulante'],[39,'IVA','Pagos Anticipados e Impuestos','Activo circulante'],[40,'Otros','Pagos Anticipados e Impuestos','Activo circulante'],
    [42,'Cuentas por Cobrar Intercompañías','No Operativo','Activo circulante'],[43,'Deudores Diversos','No Operativo','Activo circulante'],
    [44,'Prestamos a Accionistas y Empleados','No Operativo','Activo circulante'],[45,'Otros','No Operativo','Activo circulante'],
    [53,'Terrenos','Inmuebles','Activo fijo'],[54,'Reevaluación de Terrenos','Inmuebles','Activo fijo'],[55,'Edificios','Inmuebles','Activo fijo'],
    [56,'Reevaluación de Edificios','Inmuebles','Activo fijo'],[57,'Depreciación','Inmuebles','Activo fijo'],[58,'Construcción en Proceso','Inmuebles','Activo fijo'],[59,'Amortización','Inmuebles','Activo fijo'],
    [61,'Maquinaria','Maquinaria y Equipo','Activo fijo'],[62,'Equipo de Oficina','Maquinaria y Equipo','Activo fijo'],[63,'Otros','Maquinaria y Equipo','Activo fijo'],[64,'Depreciación','Maquinaria y Equipo','Activo fijo'],
    [66,'Cuentas por Cobrar','Cuentas por Cobrar Intercompañías (LP)','Activo fijo'],
    [68,'Subsidiarias y Asociadas','Inversiones','Activo fijo'],[69,'Inversiones a Largo Plazo','Inversiones','Activo fijo'],[70,'Otros','Inversiones','Activo fijo'],
    [72,'Patentes, Licencias y Marcas','Intangible','Activo fijo'],[73,'Crédito Mercantil','Intangible','Activo fijo'],[74,'Amortización','Intangible','Activo fijo'],[75,'Otros','Intangible','Activo fijo'],
    [77,'Pagos Anticipados','Diferido','Activo fijo'],[78,'Impuestos','Diferido','Activo fijo'],[79,'Depósitos en Garantía','Diferido','Activo fijo'],[80,'Otros','Diferido','Activo fijo'],
    [88,'Bancario','Pasivo Financiero CP','Pasivo circulante'],[89,'No Bancario','Pasivo Financiero CP','Pasivo circulante'],
    [90,'Porción Circulante Bancario','Pasivo Financiero CP','Pasivo circulante'],[91,'Porción Circulante No Bancario','Pasivo Financiero CP','Pasivo circulante'],
    [93,'Proveedores','Pasivo No Financiero','Pasivo circulante'],[94,'Acreedores','Pasivo No Financiero','Pasivo circulante'],[95,'ISR','Pasivo No Financiero','Pasivo circulante'],
    [96,'PTU','Pasivo No Financiero','Pasivo circulante'],[97,'IVA','Pasivo No Financiero','Pasivo circulante'],
    [99,'Cuentas por Pagar','Cuentas por Pagar Intercompañías','Pasivo circulante'],[101,'Préstamos de Inversionistas','Préstamos Inversionistas','Pasivo circulante'],
    [107,'Bancario','Pasivo Financiero LP','Pasivo a largo plazo'],[108,'No Bancario','Pasivo Financiero LP','Pasivo a largo plazo'],
    [109,'Porción a Largo Plazo Bancario','Pasivo Financiero LP','Pasivo a largo plazo'],[110,'Porción a Largo Plazo No Bancario','Pasivo Financiero LP','Pasivo a largo plazo'],
    [111,'Aportación Para Futuros Aumentos de Cap.','Pasivo Financiero LP','Pasivo a largo plazo'],
    [119,'Capital Pagado','Capital Contable','Capital contable'],[120,'Aumento de Capital','Capital Contable','Capital contable'],[121,'Dividendos','Capital Contable','Capital contable'],
    [122,'Prima por Suscripción','Capital Contable','Capital contable'],[123,'Reserva Legal','Capital Contable','Capital contable'],
    [124,'Utilidades Retenidas','Capital Contable','Capital contable'],[125,'Utilidad del Ejercicio','Capital Contable','Capital contable'],
    [134,'Ventas','Ventas Netas','Estado de resultados'],[135,'Descuento Sobre Ventas','Ventas Netas','Estado de resultados'],
    [137,'Inventario Inicial','Costo de Ventas','Estado de resultados'],[138,'Costo de Producción','Costo de Ventas','Estado de resultados'],
    [139,'Inventario Final','Costo de Ventas','Estado de resultados'],[140,'Generales','Costo de Ventas','Estado de resultados'],
    [145,'Gastos de Venta','Gastos de Venta y Administración','Estado de resultados'],[146,'Gastos de Administración','Gastos de Venta y Administración','Estado de resultados'],
    [147,'Otros Ingresos','Gastos de Venta y Administración','Estado de resultados'],[148,'Otros Gastos','Gastos de Venta y Administración','Estado de resultados'],
    [149,'Depreciación','Gastos de Venta y Administración','Estado de resultados'],[150,'Amortización','Gastos de Venta y Administración','Estado de resultados'],
    [153,'Ganancia Cambiaria','Costo Integral de Financiamiento','Estado de resultados'],[154,'Pérdida Cambiaria','Costo Integral de Financiamiento','Estado de resultados'],
    [155,'Intereses Ganados','Costo Integral de Financiamiento','Estado de resultados'],[156,'Intereses Pagados','Costo Integral de Financiamiento','Estado de resultados'],
    [159,'ISR','Impuestos','Estado de resultados'],[160,'PTU','Impuestos','Estado de resultados']
  ].map(([fila, nombre, grupo, seccion]) => ({ fila, nombre, grupo, seccion, etiqueta: grupo + ' – ' + nombre }));
  const FILAS = new Set(CATALOGO.map(c => c.fila));
  const POR_FILA = Object.fromEntries(CATALOGO.map(c => [c.fila, c]));
  const TOLERANCIA = 3;           // la misma que usa la plantilla en sus celdas de cuadre
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

  /* Una cuenta: { nombre, importe (como viene en el estado, positivo), resta (true si dentro de su renglón se resta,
     p. ej. pérdidas de ejercicios anteriores dentro de Utilidades Retenidas), fila (renglón de Datos) }. */
  function valores(cuentas) {
    const v = {};
    for (const c of cuentas) {
      if (!FILAS.has(c.fila)) continue;
      v[c.fila] = round2((v[c.fila] || 0) + (c.resta ? -1 : 1) * Number(c.importe || 0));
    }
    return v;
  }

  /* Reproduce los subtotales de Datos (mismas sumas y restas que las fórmulas de la plantilla) para poder
     comprobar los cuadres antes de generar el archivo. */
  function totales(cuentas) {
    const v = valores(cuentas), g = f => v[f] || 0, s = (a, b) => { let t = 0; for (let f = a; f <= b; f++) t += g(f); return t; };
    const circulante = s(19, 20) + (s(22, 23) - g(24) + g(25)) + g(27) + (s(29, 35) - g(36)) + s(38, 40) + s(42, 45);
    const fijo = (s(53, 56) - g(57) + g(58) - g(59)) + (s(61, 63) - g(64)) + g(66) + s(68, 70) + (s(72, 73) - g(74) + g(75)) + s(77, 80);
    const pasivoCP = s(88, 91) + s(93, 97) + g(99) + g(101);
    const pasivoLP = s(107, 111);
    const capital = s(119, 120) + s(122, 125) - g(121);
    const ventasNetas = g(134) - g(135);
    const costo = g(137) + g(138) - g(139) + g(140);
    const bruta = ventasNetas - costo;
    const gastos = g(145) + g(146) - g(147) + g(148) + g(149) + g(150);
    const cif = -g(153) + g(154) - g(155) + g(156);
    const impuestos = g(159) + g(160);
    const neta = bruta - gastos - cif - impuestos;
    const r = { activoCirculante: circulante, activoFijo: fijo, activo: circulante + fijo, pasivoCP, pasivoLP, pasivo: pasivoCP + pasivoLP, capital,
      pasivoCapital: pasivoCP + pasivoLP + capital, ventasNetas, costo, utilidadBruta: bruta, gastos, cif, impuestos, utilidadNeta: neta,
      utilidadEjercicio: g(125), deudaFinanciera: s(88, 91) + s(107, 111), ebitda: neta + impuestos + cif + g(149) + g(150) };
    for (const k in r) r[k] = round2(r[k]);
    return r;
  }

  /* Comprobaciones de un periodo. `leido` son los totales que trae impreso el propio estado financiero.
     Devuelve una lista de { id, titulo, ok, detalle }; el estudio solo se genera si todas pasan. */
  function comprobar(periodo) {
    const t = totales(periodo.cuentas), leido = periodo.totales || {}, out = [];
    const money = n => Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cerca = (a, b) => Math.abs(a - b) < TOLERANCIA;
    const sinRenglon = periodo.cuentas.filter(c => !FILAS.has(c.fila) && Number(c.importe || 0) !== 0);
    out.push({ id: 'asignadas', titulo: 'Todas las cuentas tienen renglón', ok: sinRenglon.length === 0,
      detalle: sinRenglon.length ? 'Faltan ' + sinRenglon.length + ': ' + sinRenglon.map(c => c.nombre).slice(0, 4).join(', ') + (sinRenglon.length > 4 ? '…' : '') : 'Listo' });
    out.push({ id: 'balance', titulo: 'Cuadre de balance', ok: cerca(t.activo, t.pasivoCapital),
      detalle: 'Activo ' + money(t.activo) + ' · Pasivo + capital ' + money(t.pasivoCapital) + (cerca(t.activo, t.pasivoCapital) ? '' : ' · diferencia ' + money(t.activo - t.pasivoCapital)) });
    out.push({ id: 'resultados', titulo: 'Cuadre de resultados', ok: cerca(t.utilidadEjercicio, t.utilidadNeta),
      detalle: 'Utilidad del balance ' + money(t.utilidadEjercicio) + ' · Utilidad calculada ' + money(t.utilidadNeta) + (cerca(t.utilidadEjercicio, t.utilidadNeta) ? '' : ' · diferencia ' + money(t.utilidadEjercicio - t.utilidadNeta)) });
    const pares = [['activo', 'Total activo', t.activo], ['pasivo', 'Total pasivo', t.pasivo], ['capital', 'Capital contable', t.capital], ['utilidad_neta', 'Utilidad neta', t.utilidadNeta]];
    for (const [k, titulo, calc] of pares) {
      if (leido[k] == null || leido[k] === '') continue;
      // El pasivo y el capital pueden diferir del estado cuando una cuenta se reclasifica entre ambos (aportaciones para futuros aumentos):
      // por eso se comparan también en conjunto.
      let ok = cerca(calc, Number(leido[k]));
      if (!ok && (k === 'pasivo' || k === 'capital') && leido.pasivo != null && leido.capital != null) ok = cerca(t.pasivo + t.capital, Number(leido.pasivo) + Number(leido.capital));
      out.push({ id: 'vs_' + k, titulo: titulo + ' contra el estado', ok, detalle: 'Capturado ' + money(calc) + ' · Estado ' + money(leido[k]) });
    }
    return out;
  }

  /* El capital debe "rodar": utilidades retenidas de un año = retenidas + utilidad del año anterior (salvo dividendos o
     capitalizaciones). No bloquea; solo avisa. */
  function avisos(periodos) {
    const out = [];
    for (let i = 1; i < periodos.length; i++) {
      const a = valores(periodos[i - 1].cuentas), b = valores(periodos[i].cuentas);
      const esperado = (a[124] || 0) + (a[125] || 0), real = b[124] || 0;
      if (Math.abs(esperado - real) >= TOLERANCIA && (a[125] || 0) !== 0)
        out.push('Las utilidades retenidas de ' + periodos[i].etiqueta + ' no coinciden con las de ' + periodos[i - 1].etiqueta + ' más su utilidad (diferencia ' +
          round2(real - esperado).toLocaleString('es-MX') + '). Puede haber dividendos, capitalización o un error del cliente.');
    }
    return out;
  }

  /* Fórmula visible de una celda, como la capturan los analistas: =78220.81+814401.29 */
  const num = n => String(round2(Math.abs(n)));
  function formula(terminos) {
    const t = terminos.filter(x => Number(x.importe || 0) !== 0);
    if (!t.length) return null;
    let f = '';
    t.forEach((x, i) => { const neg = (Number(x.importe) < 0) !== !!x.resta; f += (neg ? '-' : (i ? '+' : '')) + num(x.importe); });
    return f;
  }

  const COLS = ['B', 'C', 'D', 'E'];
  const serial = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);

  /* Plan de celdas: qué se escribe en cada celda de Datos. Los periodos van en orden cronológico; el último ocupa E. */
  function plan(estudio) {
    const ps = estudio.periodos.slice(-4), offset = 4 - ps.length, celdas = {};
    ps.forEach((p, i) => {
      const col = COLS[offset + i], porFila = {};
      for (const c of p.cuentas) if (FILAS.has(c.fila)) (porFila[c.fila] = porFila[c.fila] || []).push(c);
      for (const fila in porFila) { const f = formula(porFila[fila]); if (f) celdas[col + fila] = f; }
    });
    const ult = ps[ps.length - 1], [y, m] = ult.fecha_cierre.split('-').map(Number);
    return { celdas, fechaSerial: serial(y, m, 1), meses: Number(ult.meses) || m };
  }

  /* Llena la plantilla. `zip` es una instancia de JSZip ya cargada con la plantilla en blanco.
     Solo reescribe el XML de la hoja Datos (celdas de captura, E5 y E6) y pide a Excel recalcular al abrir. */
  async function llenar(zip, estudio) {
    const wb = await zip.file('xl/workbook.xml').async('string');
    const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const m = wb.match(/<sheet[^>]*name="Datos"[^>]*r:id="([^"]+)"/);
    if (!m) throw new Error('La plantilla no tiene una hoja llamada Datos.');
    const rel = rels.match(new RegExp('<Relationship[^>]*Id="' + m[1] + '"[^>]*Target="([^"]+)"')) || rels.match(new RegExp('<Relationship[^>]*Target="([^"]+)"[^>]*Id="' + m[1] + '"'));
    const ruta = 'xl/' + rel[1].replace(/^\/?xl\//, '');
    let x = await zip.file(ruta).async('string');
    const { celdas, fechaSerial, meses } = plan(estudio);

    for (const ref in celdas) {
      const re = new RegExp('<c r="' + ref + '"( s="\\d+")?(?:/>|><v>[^<]*</v></c>)');
      if (!re.test(x)) throw new Error('La celda ' + ref + ' de la plantilla no es una celda de captura; no se modificó nada.');
      x = x.replace(re, (_, s) => '<c r="' + ref + '"' + (s || '') + '><f>' + celdas[ref] + '</f></c>');
    }
    for (const [ref, val] of [['E5', fechaSerial], ['E6', meses]]) {
      const re = new RegExp('(<c r="' + ref + '"[^>]*>)<v>[^<]*</v>');
      if (!re.test(x)) throw new Error('No se encontró la celda ' + ref + ' en la plantilla.');
      x = x.replace(re, '$1<v>' + val + '</v>');
    }
    zip.file(ruta, x);

    // Los resultados guardados de las fórmulas ya no valen: se quitan en todas las hojas y Excel los recalcula al abrir.
    for (const nombre of Object.keys(zip.files)) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(nombre)) continue;
      let h = await zip.file(nombre).async('string');
      h = h.replace(/(<c r="[A-Z]+\d+"[^>]*?) t="(?:str|e|b)"([^>]*>)(<f[^>]*\/>|<f[^>]*>[^<]*<\/f>)<v>[^<]*<\/v>/g, '$1$2$3')
           .replace(/(<\/f>|<f[^>]*\/>)<v>[^<]*<\/v>/g, '$1');
      zip.file(nombre, h);
    }
    zip.file('xl/workbook.xml', /<calcPr[^>]*\/>/.test(wb) ? wb.replace(/<calcPr([^>]*)\/>/, (a, attrs) => '<calcPr' + attrs.replace(/ fullCalcOnLoad="[^"]*"/, '') + ' fullCalcOnLoad="1"/>') : wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>'));
    if (zip.file('xl/calcChain.xml')) {      // la cadena de cálculo se reconstruye sola; quitarla evita referencias viejas
      zip.remove('xl/calcChain.xml');
      zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship[^>]*calcChain[^>]*\/>/, ''));
      const ct = await zip.file('[Content_Types].xml').async('string');
      zip.file('[Content_Types].xml', ct.replace(/<Override[^>]*calcChain[^>]*\/>/, ''));
    }
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  /* Normaliza el nombre de una cuenta para buscarla en la memoria del cliente y en el reglamento. */
  const clave = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

  return { CATALOGO, POR_FILA, FILAS, TOLERANCIA, valores, totales, comprobar, avisos, formula, plan, llenar, clave, round2 };
});
