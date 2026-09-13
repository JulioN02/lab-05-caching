# LAB-05 — Caching (Almacenamiento en Caché)

**Plan de Desarrollo Profesional · Temporada 1 · Laboratorio de Ingeniería**

> Hands-on lab: un experimento, no un producto. Este README cubre la definición, la hipótesis, el plan de experimentos y la medición real de la comparativa entre la lectura directa a PostgreSQL, el cache-aside con TTL y la invalidación por escritura.
> **Estado**: ✅ Completado — implementado, medido y verificado (cache-aside + TTL + invalidación por escritura · 18/18 tests DB-free · typecheck limpio).
> **Fecha de medición**: 2026-09-12 · evidencia regenerable en `docs/output-*.txt` (R14).

## Problema

Un endpoint de solo lectura (p. ej. "resumen de stock", "reporte de ventas",
"perfil del usuario") es consultado miles de veces por minuto. Cada request
pega contra la base de datos, ejecuta la misma consulta una y otra vez, y la
base empieza a competir con las escrituras reales del sistema. El resultado:
latencia alta, base saturada y costos innecesarios — para devolver siempre lo
mismo.

La respuesta obvia es **caché**: guardar el resultado y servirlo sin volver a
la base. Pero guardar y servir es la parte fácil. Lo difícil es la
**invalidación**: si un dato cambia (un movimiento de stock), la copia en caché
queda vieja (stale) y el usuario lee información desactualizada. ¿Cuándo
invalidamos? ¿Cada cuánto expira (TTL)? ¿Invalidamos al escribir, o dejamos
que expire sola? ¿Qué tan aceptable es que un reporte tenga 30 segundos de
atraso?

Además hay que elegir *dónde* guardar: PostgreSQL mismo (¿por qué no?),
memoria en el proceso Node (un `Map`), o un caché externo. Cada opción tiene un
costo distinto en latencia, consistencia y vida útil. El lab consiste en
construir un endpoint de lectura con tres variantes — base directa, caché
con TTL, caché con invalidación por escritura — y medir la diferencia con
números.

## Objetivo del lab

Implementar un patrón de caché típico (cache-aside con TTL y, opcionalmente,
write-through/invalidación por escritura), medir la mejora de latencia frente a
golpear la base en cada request, entender los trade-offs de datos viejos vs.
velocidad, y decidir con datos dónde conviene cachear y qué invalidar.

## Hipótesis

Antes de correr los experimentos, las expectativas son:

1. **Línea base sin caché**: cada request ejecuta la consulta en PostgreSQL;
   la latencia es la del round-trip real a la base (p. ej. ms a decenas de ms)
   y la base recibe 1 consulta por request.
2. **Cache-aside con TTL**: el primer request carga el caché y los siguientes
   se sirven desde memoria — la latencia debería caer **un orden de magnitud o
   más** (de ms a microsegundos) y la base deja de recibir casi todas las
   consultas (hit ratio alto).
3. **La invalidación es el costo oculto**: con TTL puro hay una ventana de
   **stale data** (el dato cambia, la caché sigue sirviendo el viejo hasta que
   expira). Invalidar por escritura la cierra, pero obliga a que el escritor
   conozca y actualice la caché (más acoplamiento y riesgo de bugs).
4. **El hit ratio y la latencia van juntos**: a mayor hit ratio, menor
   latencia promedio — y la tabla de medición debería mostrarlo con datos
   (hit ratio %, latencia avg/p95, requests a la base).
5. **PostgreSQL como caché es viable pero más lento**: servir desde una tabla
   en PG es más rápido que recomputar la consulta, pero sigue siendo un
   round-trip a la base; la caché en memoria del proceso Node es la más rápida
   y la que menos satura la base.

## Plan de experimentos

- Exp 1: **Línea base** — endpoint de lectura que consulta PostgreSQL en cada
  request (sin caché). Medir latencia avg/p95 y requests a la base.
- Exp 2: **Cache-aside con TTL** — caché en memoria (Map) con TTL; medir
  primer request (miss), siguientes (hits), hit ratio y latencia.
- Exp 3: **Invalidación por escritura** — un endpoint de escritura que invalida
  (o actualiza) la entrada en caché al modificar el dato; medir que el lector
  vea el dato nuevo sin esperar el TTL.
- Exp 4: **Medición consolidada** — tabla de comparación (latencia avg/p95,
  hit ratio, requests a la base, consumo de memoria) para las tres variantes.
- Exp 5 (opcional): **PostgreSQL como caché** — comparar el costo de cachear en
  una tabla de PG vs. memoria del proceso, para entender los trade-offs de cada
  lugar de almacenamiento. (Fuera de alcance del lab; la interfaz `Cache<T>`
  async está diseñada para permitir el drop-in.)

## Temas a explorar

- Cache-aside (lazy loading) vs. write-through vs. write-back
- TTL y la ventana de datos viejos (staleness) vs. consistencia
- Invalidación por escritura: invalidar vs. actualizar la caché
- Hit ratio, miss penalty y cold/warm cache
- Caché en memoria (Map/estructura Node) vs. PostgreSQL vs. caché externo
- Trade-offs: velocidad, consistencia, complejidad y memoria

## Estructura del repositorio

```
lab-05-caching/
├── package.json          # scripts: test, typecheck, db:setup, exp:*, evidence
├── tsconfig.json         # TS strict, ESM (nodenext), erasableSyntaxOnly
├── docker-compose.yml    # PostgreSQL 16 en el puerto 55437 (container lab-05-pg)
├── migrations/
│   └── 001_schema.sql    # stock_items sin índice sobre category (R18)
├── src/
│   ├── db.ts             # Pool singleton + contador de queries (requestsToDb)
│   ├── setup.ts          # db:setup / db:seed / db:reset (migra + seed 1M filas)
│   ├── clock.ts          # reloj inyectable (realNow / fake clock)
│   ├── cache.ts          # Cache<T> async + cache-aside con TTL (Map)
│   ├── source.ts         # StockRepository (interfaz + impl PG)
│   ├── api.ts            # getStockSummary / updateStockQuantity (thin)
│   ├── evidence.ts       # measureReads, percentile, serializedBytes
│   ├── reporter.ts       # banner, resumen con veredicto, tablas
│   ├── exp-01-baseline.ts     # lectura directa a la base
│   ├── exp-02-cache-ttl.ts    # cache-aside con TTL
│   ├── exp-03-invalidate.ts   # invalidación por escritura (invalidate vs update)
│   └── exp-04-measure.ts      # tabla de medición comparativa
├── tests/
│   └── cache.test.ts     # invariantes R1–R11, R17, R22 (100 % DB-free)
└── docs/
    ├── output-01-baseline.txt
    ├── output-02-cache-ttl.txt
    ├── output-03-invalidate.txt
    ├── output-04-measure.txt
    └── output-test.txt
```

## Cómo ejecutar este lab

Este lab usa PostgreSQL (Docker, puerto 55437) para el dato fuente pero el
caché vive en memoria del proceso; los tests son 100 % DB-free (R24):

```bash
npm install                # solo pg + types (TypeScript nativo, sin build)

docker compose up -d db    # PostgreSQL 16 en localhost:55437 (lab-05-pg)
npm run db:setup           # crea lab_caching + migra + seed 1M filas (idempotente)

npm run exp:baseline       # Exp 1 — lectura directa a la base
npm run exp:cache-ttl      # Exp 2 — cache-aside con TTL
npm run exp:invalidate     # Exp 3 — invalidación por escritura
npm run exp:measure        # Exp 4 — tabla de medición comparativa

npm test                   # invariantes con node:test (sin base de datos)
npm run typecheck          # tsc --noEmit (TS strict)

npm run evidence           # regenera los 5 docs/output-*.txt de evidencia
```

Knobs de entorno:

| Variable | Default | Descripción |
|---|---|---|
| `LAB_ROWS` | `1000000` | Filas del seed (determinista vía `generate_series`). Fallback documentado: `LAB_ROWS=5000000` para hardware muy rápido — el heap scan de ~1M filas ya garantiza decenas-hasta-miles de ms en el baseline. |
| `LAB_REQUESTS` | `300` (baseline) / `1000` (caché) | Requests del loop medido (N). |
| `LAB_TTL_MS` | `30000` | TTL del cache-aside en milisegundos. |
| `LAB_PGPORT` / `LAB_PGHOST` / `LAB_PGUSER` / `LAB_PGPASSWORD` / `LAB_PGDATABASE` | `55437` / `localhost` / `postgres` / `lab` / `lab_caching` | Conexión a PostgreSQL. |

## Mediciones reales

Evidencia generada el **2026-09-12** sobre PostgreSQL 16 (Docker, puerto 55437)
con `LAB_ROWS=1000000` (1M filas, 10 categorías, **sin índice sobre
`category`**, R18). Hardware local; los valores de `docs/output-*.txt` son la
fuente verbatim (regenerables con `npm run evidence`).

### Exp 1 — Línea base (lectura directa, N=300)

```
n: 300 · avg ms: 604.84 · p95 ms: 790.40 · p99 ms: 964.03 · requestsToDb: 300
```

Cada request ejecuta el agregado `GROUP BY category` completo sobre 1M filas:
1 query por request (veredicto `requestsToDb === n`). En este entorno el heap
scan cuesta ~0.6–0.9 s por request — el costo que la caché va a eliminar.

### Exp 2 — Cache-aside con TTL (N=1000, TTL 30 s)

```
n: 1000 · avg ms: 0.44 · p95 ms: 0.02 · p99 ms: 0.05 · hitRatio: 0.9990
requestsToDb: 1 · cache size: 1 · bytes: 637
```

Un solo miss inicial (1 query) + 999 hits desde memoria: hit ratio **99.90 %** y
**1 sola request a la base** para 1000 lecturas. El avg (0.44 ms) incluye el
miss inicial (~600 ms repartido entre 1000 muestras); el p95 (0.02 ms) muestra
el caso típico.

### Exp 3 — Invalidación por escritura (R8/R22)

| Estrategia | Próxima lectura | Llamadas fuente (write) | Llamadas fuente (read) | ¿Fresco? |
|---|---|---|---|---|
| TTL puro (sin invalidación) | HIT (stale v1) | 1 | 0 | NO |
| `invalidate` | MISS (reload v2) | 1 | 1 | SÍ |
| `update` | HIT (v2 en caché) | 2 | 0 | SÍ |

La ventana de staleness del TTL puro se cierra al invalidar (o actualizar) al
escribir: el lector ve el dato nuevo **en el mismo instante**, sin esperar el
TTL. `update` paga 1 lectura de recomputo en la escritura; `invalidate` paga 1
miss en la lectura siguiente.

### Exp 4 — Medición consolidada (R23)

| Variante | n | avg ms | p95 ms | Hit ratio | Requests-to-DB | Bytes |
|---|---|---|---|---|---|---|
| baseline | 300 | 622.69 | 873.03 | — | 300 | — |
| cache-ttl | 1000 | 0.82 | 0.02 | 99.90 % | 1 | 637 |
| cache-invalidate | 1000 | 5.83 | 0.02 | 98.99 % | 19 | — |

La caché en memoria reduce la latencia promedio de **~620 ms a menos de 1 ms**
(~700×) y las requests a la base de **300 a 1**. La variante con invalidación
intercala 1 escritura cada 100 lecturas: 19 requests a la base (1 miss inicial
+ 9 escrituras + 9 recargas) y un hit ratio de **98.99 %** — mediblemente
distinto del TTL puro, que es el costo de la consistencia inmediata.

### Lectura de la evidencia

- `docs/output-01-baseline.txt` · `output-02-cache-ttl.txt` ·
  `output-03-invalidate.txt` · `output-04-measure.txt` · `output-test.txt`
  (gitignored, regenerables con `npm run evidence`).
- Los tests (`npm test`) son **100 % DB-free** (R24): pasan con la base
  apagada, usando fake clock + repositorio inyectable con contador de llamadas.

## Conclusión

### Cuándo cachear

- **Lecturas calientes de agregados que cambian poco** (resumen de stock,
  reportes, configuraciones): el caso ideal. En la medición, la caché pasó de
  ~620 ms a ~0.02 ms (p95) y de 300 a 1 requests a la base — varios órdenes de
  magnitud, con un solo valor de 637 bytes en memoria.
- **El TTL es el amortiguador de consistencia**: si la aplicación tolera una
  ventana de dato viejo (p. ej. 30 s de atraso en un reporte), el cache-aside
  con TTL puro es suficiente y barato. El hit ratio depende de `TTL / duración
  del run`: si las lecturas ocurren mucho más rápido que el TTL, el ratio se
  acerca a 1 (0.999 con TTL 30 s).
- **La invalidación es para cuando el dato viejo NO es tolerable**: cierra la
  ventana de staleness al costo de que el escritor conozca la caché (acoplamiento)
  y de pagar un miss en la lectura siguiente (`invalidate`) o una lectura de
  recomputo en la escritura (`update`).

### Qué invalidar y cómo

- **`invalidate` (por defecto)**: escribir es barato (1 query) pero la próxima
  lectura paga un miss + reload. Ideal cuando las escrituras son poco frecuentes
  y las lecturas muchas: el costo del miss se diluye (98.99 % de hits con 1
  escritura cada 100 lecturas).
- **`update`**: la escritura sobrescribe la caché con el valor fresco (1 write +
  1 recompute); la próxima lectura es HIT sin tocar la fuente. Ideal cuando las
  lecturas son muchísimo más frecuentes que las escrituras y no se quiere ni un
  miss.
- **Invalidación por prefijo**: con más de una clave (p. ej. `stock:*`), borrar
  por prefijo mantiene la coherencia de un dominio entero sin conocer todas las
  claves.

### Trade-offs (staleness vs. velocidad)

| Decisión | Costo | Beneficio |
|---|---|---|
| TTL puro | Ventana de dato viejo (hasta `TTL_MS`) | Escritura trivial, 0 acoplamiento, hit ratio ~0.999 |
| `invalidate` al escribir | 1 miss en la lectura siguiente | Dato fresco al instante, escritura barata |
| `update` al escribir | 1 recompute en cada escritura | Dato fresco al instante, 0 misses en lecturas |

En un sistema real, la elección depende del negocio: un panel de inventario
tolera 30 s de atraso; un carrito de compras no. El lab deja medido cuánto
cuesta cada opción y el criterio para decidir.

### Gotcha documentado: bigint de `SUM()`

`SUM(quantity)` sobre 1M filas devuelve un **bigint** y node-postgres lo entrega
como **string**; `CAST(...::int)` desbordaría `int4` a 5M filas (~2.5e9 >
2.147e9). El repositorio mapea con `Number(row.quantity)` y usa `COUNT(*)::int`
(seguro hasta 5M). Cualquier agregado con `SUM`/`AVG` grande en node-postgres
debe convertir explícitamente.

### Cómo se conecta con el plan

LAB-05 alimenta el módulo de **Inventory & Stock Management** (reportes de
stock y agregaciones que se leen mucho y cambian poco → candidatos ideales de
caché) y es a la vez **transversal**: toda API profesional necesita saber cuándo
cachear, qué invalidar y cuánto dato viejo es aceptable. Complementa a LAB-03
(los índices optimizan la consulta; la caché evita ejecutarla) y aporta el
criterio de consistencia que cualquier producto con lecturas calientes necesita.

## Criterio de completado

- [x] Documentar problema, hipótesis y plan en este README (sección mediciones completada)
- [x] Tres variantes medidas: base directa, cache-aside TTL, invalidación por escritura
- [x] Evidencia real en `docs/output-*.txt` (latencia avg/p95, hit ratio, requests a la base)
- [x] Invariante verificado con tests: TTL respetado, invalidación efectiva, hit ratio medible (18/18 en `npm test`, DB-free)
- [x] Conclusión documentada: trade-offs de staleness vs. velocidad y dónde cachear
- [x] `npm run typecheck` limpio