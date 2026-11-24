/* Reporte en PDF: copia el "Detalle completo" de cada disposición (sin IA, solo los datos ya validados). */
(function (root) {
  'use strict';
  const LABEL = { ok: 'OK', minor: 'OK (formato)', review: 'Revisar', error: 'Error', pending: 'Sin revisar', na: 'No aplica' };
  const FILL = { ok: [226, 244, 232], minor: [226, 244, 232], review: [253, 243, 214], error: [250, 224, 222], pending: [236, 236, 238], na: [244, 244, 245] };
  const INK = { ok: [22, 101, 52], minor: [22, 101, 52], review: [133, 77, 14], error: [153, 27, 27], pending: [82, 82, 91], na: [113, 113, 122] };
  const SECTIONS = [['anexo', 'Anexo'], ['pagare', 'Pagaré'], ['interno', 'Cuentas del Anexo']];
  // Las fuentes estándar del PDF solo traen Latin-1: se cambian los signos que no existen ahí.
  const clean = s => String(s === null || s === undefined ? '' : s)
    .replace(/[—–]/g, '-').replace(/…/g, '...').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0A\x20-\x7E -ÿ]/g, '').replace(/[ \t]+/g, ' ').trim();

  /* items: [{ titulo, cliente, contrato, firma, anexo, pagare, r }] ; r = resultado de VAL.validate */
  function build(JsPDF, items, when) {
    const doc = new JsPDF({ unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth(), M = 40;
    items.forEach((it, n) => {
      if (n) doc.addPage();
      const r = it.r;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20);
      doc.text('Validación de Anexo y Pagaré', M, 52);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110);
      doc.text(clean('Factoraje · Active Leasing · Borrador generado el ' + when), M, 66);
      doc.setFontSize(11); doc.setTextColor(20); doc.setFont('helvetica', 'bold');
      doc.text(doc.splitTextToSize(clean(it.cliente), W - 2 * M), M, 90);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(60);
      const head = [
        `${it.titulo} · Contrato ${it.contrato || '-'}${it.firma ? ' · Fecha de firma ' + it.firma : ''}`,
        `Archivos: Anexo ${it.anexo || 'falta'} · Pagaré ${it.pagare || 'falta'}`,
        `Resultado: ${r.pct}% correcto (${r.correctos} de ${r.evaluados}) · ${r.errors} errores · ${r.reviews} por confirmar · ${r.pending} sin revisar`
      ].map(clean);
      let y = 106;
      head.forEach(t => { const lines = doc.splitTextToSize(t, W - 2 * M); doc.text(lines, M, y); y += lines.length * 12.5; });
      y += 6;
      SECTIONS.forEach(([key, title]) => {
        const rows = r.checks.filter(k => k.doc === key);
        if (!rows.length) return;
        doc.autoTable({
          startY: y, margin: { left: M, right: M, bottom: 44 }, theme: 'grid',
          head: [[{ content: title, colSpan: 4, styles: { fillColor: [24, 24, 27], textColor: 255, fontSize: 10.5 } }],
            ['Campo', 'Valor esperado (fuente)', 'Encontrado', 'Estatus']],
          body: rows.map(k => [clean(k.campo), clean(k.esperado) + (k.fuente ? '\n(' + clean(k.fuente) + ')' : ''),
            (clean(k.encontrado) || '-') + (k.nota ? '\n' + clean(k.nota) : ''), LABEL[k.status] || clean(k.status)]),
          styles: { font: 'helvetica', fontSize: 8.2, cellPadding: 4, overflow: 'linebreak', valign: 'top', lineColor: [220, 220, 224], lineWidth: 0.5, textColor: 30 },
          headStyles: { fillColor: [244, 244, 245], textColor: 60, fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 118, fontStyle: 'bold' }, 1: { cellWidth: 160 }, 3: { cellWidth: 62, halign: 'center', fontStyle: 'bold' } },
          didParseCell: d => {
            if (d.section !== 'body' || d.column.index !== 3) return;
            const st = rows[d.row.index].status;
            d.cell.styles.fillColor = FILL[st] || FILL.na; d.cell.styles.textColor = INK[st] || INK.na;
          }
        });
        y = doc.lastAutoTable.finalY + 16;
      });
    });
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140);
      doc.text(clean('Borrador de validación automática (comparación de datos, sin IA). Revisar antes de firmar.'), M, doc.internal.pageSize.getHeight() - 22);
      doc.text(`${p} / ${pages}`, W - M, doc.internal.pageSize.getHeight() - 22, { align: 'right' });
    }
    return doc;
  }
  const API = { build, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.VALPDF = API;
})(typeof window !== 'undefined' ? window : globalThis);
