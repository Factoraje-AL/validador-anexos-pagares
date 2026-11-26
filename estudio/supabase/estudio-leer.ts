// Función de Supabase "estudio-leer": lee estados financieros con IA y propone el renglón de Datos de cada cuenta.
// La llave de la IA vive solo aquí, como secreto (ANTHROPIC_API_KEY); nunca llega al navegador.
// Secretos opcionales: ESTUDIO_MODELO (modelo a usar) y ESTUDIO_DOMINIO (dominio de correo autorizado).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const MODELO = Deno.env.get("ESTUDIO_MODELO") ?? "claude-sonnet-5-5";
const DOMINIO = (Deno.env.get("ESTUDIO_DOMINIO") ?? "activeleasing.com.mx").toLowerCase();

type Pagina = { i: number; texto?: string; img: string };

const UBICAR = `Eres analista de riesgos de una arrendadora mexicana. Recibes las páginas (miniaturas) de los documentos financieros de un cliente.
Devuelve los índices de las páginas que contienen: (a) un balance general / estado de situación financiera, (b) un estado de resultados,
(c) relaciones analíticas o integraciones de PASIVOS financieros (créditos bancarios, cuentas por pagar a corto y largo plazo, acreedores).
No incluyas listados de clientes, proveedores, dictámenes, notas ni carátulas. Si hay varios años, incluye todos.`;

const EXTRAER = `Eres analista de riesgos de una arrendadora mexicana. Vas a capturar la hoja "Datos" de un estudio de crédito a partir de los estados financieros del cliente.

LECTURA
- Transcribe cada cuenta del balance general y del estado de resultados de cada periodo, con su nombre tal como aparece y su importe exacto, con centavos si los trae.
- No captures subtotales ni totales como cuentas. Los totales van aparte en "totales".
- "importe" siempre positivo. Usa "resta": true solo cuando la cuenta disminuye el renglón donde se captura (ejemplo: pérdidas de ejercicios anteriores dentro de utilidades retenidas; descuentos que el propio estado suma en lugar de restar).
- Las cuentas complementarias (depreciación acumulada, amortización acumulada, estimaciones) van positivas en su propio renglón de depreciación, amortización o estimación: la plantilla ya las resta.
- Si un dígito no se lee con certeza, usa los subtotales del propio estado para verificarlo; si aun así queda duda, márcala con confianza "baja" y explica en "motivo".
- "fecha_cierre" es el último día del periodo (AAAA-MM-DD) y "meses" los meses que cubre el estado de resultados.
- "pagina" es el índice de la página de donde salió la cuenta.

CLASIFICACIÓN
- Para cada cuenta propone "fila": el número de fila del catálogo de renglones de Datos que se te da. Usa solo filas del catálogo.
- Criterios de la casa (respondidos por el área de riesgos el 26/11/2026; aplícalos siempre):
  Activo: Bancos y caja → Caja y bancos (19). Clientes y "otras cuentas por cobrar" → Cuentas por Cobrar Vigente (22). Inventarios o almacén en una sola cuenta → Artículos terminados (31).
  Anticipo a proveedores → Inventario Anticipo a proveedores (32). IVA acreditable o IVA por acreditar → Pagos Anticipados e Impuestos IVA (39).
  "Impuestos acreditables" sin decir cuál, pagos provisionales de ISR y contribuciones o impuestos a favor → Pagos Anticipados e Impuestos ISR (38).
  Pagos anticipados presentados dentro del activo circulante → Pagos Anticipados e Impuestos Otros (40); presentados en diferido → Diferido Pagos Anticipados (77).
  Deudores diversos → No Operativo Deudores Diversos (43). Equipo de transporte o vehículos → Maquinaria y Equipo Otros (63). Equipo de cómputo y mobiliario → Equipo de Oficina (62).
  Maquinaria, "otra maquinaria y equipo" y equipo especializado → Maquinaria (61). Construcciones → Inmuebles Construcción en Proceso (58).
  Adaptaciones y mejoras y gastos de instalación → Maquinaria y Equipo Otros (63). Depósitos en garantía → Diferido Depósitos en Garantía (79).
  Pasivo: Proveedores → Proveedores (93). Acreedores diversos, anticipo de clientes, sueldos y provisiones de nómina o seguridad social → Acreedores (94).
  Impuestos por pagar, impuestos y derechos por pagar e impuestos retenidos → ISR del pasivo (95). IVA trasladado o impuestos trasladados → IVA del pasivo (97). PTU por pagar → PTU (96).
  Crédito bancario a corto plazo, aunque el cliente lo llame "cuentas por pagar a corto plazo" → Pasivo Financiero Bancario (88). Crédito a corto plazo con financieras no bancarias o tarjetas → Pasivo Financiero No Bancario (89).
  Crédito a largo plazo con bancos → Pasivo Financiero LP Bancario (107); con financieras no bancarias → LP No Bancario (108).
  Capital: capital social fijo y variable → Capital Pagado (119). Aportaciones para futuros aumentos de capital → Aumento de Capital (120).
  Resultados de ejercicios anteriores → Utilidades Retenidas (124), con las pérdidas restando. Resultado del ejercicio → Utilidad del Ejercicio (125).
  Resultados: Ventas e ingresos → Ventas (134); "otros ingresos" presentados antes de ventas netas se suman a Ventas (134). Devoluciones y descuentos → Descuento Sobre Ventas (135).
  Costo de ventas en un solo importe → Costo de Ventas Generales (140). Empresa de servicios sin costo de ventas: el costo queda en cero y todo va a gastos.
  "Gastos de operación" o "gastos generales" en un solo importe → Gastos de Administración (146). Gastos de venta → Gastos de Venta (145).
  "Depreciación y amortización" en un solo importe → Depreciación (149). "Otros productos" y otros ingresos después de la utilidad de operación → Otros Ingresos (147).
  Productos financieros → Intereses Ganados (155). Gastos financieros → Intereses Pagados (156). ISR y PTU del estado de resultados → Impuestos (159 y 160).
  Gastos de fabricación: no hay criterio definido; propón Gastos de Venta (145) con confianza "baja" para que el analista decida.
- Si el estado financiero firmado y la balanza de comprobación clasifican distinto una cuenta, manda el estado financiero firmado.
- Cuando una sola cuenta mezcla acreedores bancarios y no bancarios, no la repartas: clasifícala por el acreedor de mayor importe y márcala con confianza "baja".
- Si además se te da una lista de "criterios por cuenta", tiene prioridad sobre lo anterior.
- "confianza": "alta" cuando el criterio es claro; "media" cuando decides por analogía; "baja" cuando la cuenta admite más de un renglón, el nombre es ambiguo
  (por ejemplo "impuestos por pagar" sin decir si es ISR o IVA, "cuentas por pagar" que según la relación analítica son créditos) o no hay criterio. En "motivo" di en una frase por qué.
- No inventes cuentas ni repartas un importe entre renglones.

Devuelve los periodos en orden cronológico.`;

const herramientaUbicar = {
  name: "paginas_utiles", description: "Índices de las páginas con balance, estado de resultados o relaciones analíticas de pasivos.",
  input_schema: { type: "object", properties: { paginas: { type: "array", items: { type: "integer" } } }, required: ["paginas"] },
};
const herramientaExtraer = {
  name: "capturar_estudio", description: "Cuentas e importes por periodo, con el renglón de Datos propuesto.",
  input_schema: {
    type: "object", required: ["empresa", "periodos"],
    properties: {
      empresa: { type: "string", description: "Razón social del cliente" },
      periodos: {
        type: "array",
        items: {
          type: "object", required: ["fecha_cierre", "meses", "cuentas", "totales"],
          properties: {
            etiqueta: { type: "string" }, fecha_cierre: { type: "string" }, meses: { type: "integer" },
            totales: { type: "object", properties: { activo: { type: "number" }, pasivo: { type: "number" }, capital: { type: "number" }, utilidad_neta: { type: "number" } } },
            cuentas: {
              type: "array",
              items: {
                type: "object", required: ["nombre", "importe", "estado", "fila", "confianza"],
                properties: {
                  nombre: { type: "string" }, importe: { type: "number" }, resta: { type: "boolean" },
                  estado: { type: "string", enum: ["balance", "resultados"] }, fila: { type: ["integer", "null"] },
                  confianza: { type: "string", enum: ["alta", "media", "baja"] }, motivo: { type: "string" }, pagina: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
  },
};

async function claude(system: string, content: unknown[], tool: { name: string }, max_tokens: number) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("La lectura con IA todavía no está conectada: falta guardar la llave ANTHROPIC_API_KEY en los secretos de Supabase.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO, max_tokens, system, tools: [tool], tool_choice: { type: "tool", name: tool.name }, messages: [{ role: "user", content }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error("El servicio de IA respondió con un error: " + (data?.error?.message ?? r.status));
  const uso = (data.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  if (!uso) throw new Error("La IA no devolvió una lectura utilizable. Intenta de nuevo.");
  if (data.stop_reason === "max_tokens") throw new Error("El documento es demasiado largo para leerlo de una vez. Sube solo los estados financieros.");
  return uso.input;
}
const bloques = (paginas: Pagina[]) => paginas.flatMap((p) => [
  { type: "text", text: `--- Página ${p.i}${p.texto ? "\nTexto extraído del PDF:\n" + p.texto : " (escaneada, sin texto)"}` },
  { type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.img } },
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Solo personal con sesión iniciada y correo del dominio autorizado puede gastar lecturas.
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user?.email) return json({ error: "Inicia sesión para usar la lectura." }, 401);
    if (!user.email.toLowerCase().endsWith("@" + DOMINIO)) return json({ error: "Tu cuenta no está autorizada para leer estados financieros." }, 403);

    const body = await req.json();
    const paginas: Pagina[] = Array.isArray(body.paginas) ? body.paginas.slice(0, 80) : [];
    if (!paginas.length) return json({ error: "No llegaron páginas." }, 400);

    if (body.accion === "ubicar") return json(await claude(UBICAR, bloques(paginas), herramientaUbicar, 1000));
    if (body.accion === "extraer") {
      const { data: criterios } = await sb.from("estudio_criterios").select("cuenta,fila,nota");
      const extra = [
        { type: "text", text: "CATÁLOGO DE RENGLONES DE DATOS (fila: renglón)\n" + (body.catalogo ?? []).map((c: { fila: number; renglon: string }) => `${c.fila}: ${c.renglon}`).join("\n") },
        { type: "text", text: "CRITERIOS POR CUENTA (cuenta → fila)\n" + ((criterios ?? []).map((c) => `${c.cuenta} → ${c.fila}${c.nota ? " (" + c.nota + ")" : ""}`).join("\n") || "Aún no hay criterios cargados.") },
      ];
      return json(await claude(EXTRAER, [...extra, ...bloques(paginas.slice(0, 14))], herramientaExtraer, 16000));
    }
    return json({ error: "Acción desconocida." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
