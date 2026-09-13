/**
 * Reporter autocontenido para LAB-05 (caching).
 *
 * Emite banners, resúmenes y tablas comparativas en español neutro. Los colores
 * ANSI se aplican SOLO cuando stdout es una TTY: los archivos de evidencia
 * redirigidos a `docs/output-*.txt` quedan en texto plano (sin secuencias ESC).
 *
 * Sin TraceEntry (lab-04 lo necesitaba para trazas por request; lab-05 emite
 * resúmenes y tablas).
 */

// ── Colores ANSI (códigos crudos, sin dependencias) ─────────────────────────

const USE_COLOR = process.stdout.isTTY === true;

function c(code: string, s: string): string {
  return USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const cyan = (s: string): string => c("1;36", s);
export const green = (s: string): string => c("32", s);
export const red = (s: string): string => c("31", s);
export const yellow = (s: string): string => c("33", s);
export const dim = (s: string): string => c("2", s);

const CLS_COLOR: Record<Anomaly["cls"], (s: string) => string> = {
  ok: green,
  bad: red,
  warn: yellow,
  info: dim,
};

// ── Layout ──────────────────────────────────────────────────────────────────

const BANNER_WIDTH = 64;
const INDENT = "  ";

function banner(title: string): string {
  const inner = ` ${title} `;
  const side = Math.max(2, BANNER_WIDTH - inner.length);
  const left = Math.ceil(side / 2);
  return "═".repeat(left) + inner + "═".repeat(side - left);
}

export function printBanner(title: string): void {
  console.log(cyan(banner(title)));
  console.log();
}

export type Anomaly = { text: string; cls: "ok" | "bad" | "warn" | "info" };

/** Resumen con estadísticas, anomalías y veredicto. */
export function printSummary(opts: {
  title: string;
  stats: ReadonlyArray<readonly [string, string]>;
  anomalies: readonly Anomaly[];
  verdict: string;
  verdictCls: "ok" | "bad" | "warn";
}): void {
  const { title, stats, anomalies, verdict, verdictCls } = opts;

  console.log(cyan(banner(`RESUMEN · ${title}`)));
  console.log(INDENT + stats.map(([k, v]) => `${k}: ${v}`).join(" · "));
  const anomalyTxt =
    anomalies.length === 0
      ? dim("[sin anomalías]")
      : anomalies.map((a) => CLS_COLOR[a.cls](a.text)).join(" · ");
  console.log(INDENT + `anomalías: ${anomalyTxt}`);
  const verdictColor =
    verdictCls === "ok" ? green : verdictCls === "bad" ? red : yellow;
  console.log(INDENT + `veredicto: ${verdictColor(verdict)}`);
  console.log();
}

/** Tabla comparativa simple (exp-04, R23): primera fila = cabecera. */
export function printTable(columns: readonly string[], rows: ReadonlyArray<readonly string[]>): void {
  const header = [...columns];
  const widths = header.map((col, i) =>
    Math.max(col.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join(" | ").trimEnd();

  console.log(INDENT + cyan(line(header)));
  console.log(INDENT + widths.map((w) => "─".repeat(w)).join("-+-"));
  for (const row of rows) {
    console.log(INDENT + line(row));
  }
  console.log();
}