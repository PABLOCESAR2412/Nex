# Nex · sistema visual

## Dirección

Interfaz de operación para un estudio personal de contenido. La base es un panel de trabajo claro y familiar; la identidad viene de un tono editorial botánico: verde pino profundo, papel marfil y salvia. El guiño a una hoja de producción audiovisual aparece en una sola pieza: la línea de etapas que lleva una campaña desde el brief hasta su publicación.

La interfaz prioriza campañas, estado de revisión y calendario. No imita una consola ni un panel técnico. La referencia visual aprobada es el dashboard de estudio de contenido compartido por el usuario.

## Tokens

| Token | Valor | Uso |
|---|---|---|
| `pine-950` | `#0c1510` | Fondo exterior |
| `pine-900` | `#101b14` | Navegación lateral y cabecera |
| `pine-850` | `#142219` | Superficies principales |
| `pine-800` | `#1a2a20` | Superficie elevada |
| `pine-700` | `#26392b` | Selección y navegación activa |
| `moss-600` | `#5c765f` | Acentos secundarios |
| `sage-400` | `#a9c094` | Progreso y estados positivos |
| `sage-300` | `#c5d6b2` | Acciones primarias e iconos activos |
| `ivory` | `#f0eedf` | Títulos y contenido principal |
| `muted` | `#a4b1a1` | Ayuda y metadatos |
| `line` | `rgba(201, 218, 185, .15)` | Separadores |

## Tipografía

- Georgia para titulares y nombres de campañas: voz editorial y cálida.
- Segoe UI para navegación, controles y datos: lectura compacta y nativa.
- Evitar etiquetas en mayúsculas decorativas; reservarlas para la fecha y grupos de navegación.

## Composición

- Navegación lateral estable en escritorio; se reduce a una banda de iconos en móvil.
- Cabecera con ruta, búsqueda y perfil.
- **Inicio:** encabezado y acción principal, resumen, producción y publicaciones próximas, calendario semanal.
- **Calendario:** semana completa con navegación contextual, piezas por canal y lista de próximas publicaciones. En móvil, solo el tablero conserva desplazamiento horizontal.
- **Biblioteca:** búsqueda y filtros en reposo, portada editorial para video, archivos agrupados por tipo y estado de producción.
- **Cuentas:** canales sociales con nombre, uso y estado legible. Las cuentas de muestra se identifican como ejemplos y no como sesiones conectadas.
- **Despliegues:** proyectos de Cloudflare y Vercel en una lista de actividad y contexto de publicación; dominios `.example` son ilustrativos.
- **Ajustes:** identidad del estudio, preferencias previstas y notificaciones, con controles en reposo hasta implementar persistencia.
- Separadores finos organizan grupos; evitar una cuadrícula de tarjetas idénticas.
- La portada de muestra es un afiche vectorial editorial. Los elementos de ejemplo no son datos conectados.

## Componentes

- **Navegación:** fondo pino, selección salvia tenue, iconos SVG de trazo uniforme.
- **Resumen:** números tabulares y etiqueta visible «Datos de muestra».
- **Producción:** portada, canales destino, etapa actual y pasos completados.
- **Publicación:** red social, hora, título, cuenta y estado.
- **Calendario:** columnas por día y piezas con identificación de canal.
- **Acciones:** verbos concretos; salvia solo para la acción principal.

## Estados y accesibilidad

- El punto de progreso indica la etapa actual; los pasos completos llevan un check y texto «Listo».
- Estado de publicación combina texto y punto, nunca solo color.
- Los controles de esta entrega están deshabilitados porque el prototipo no contiene lógica.
- Mantener foco de teclado visible, objetivos cómodos y contraste suficiente.
- En móvil, las áreas de trabajo pasan a una columna; el calendario conserva siete columnas con desplazamiento horizontal propio.
- Respetar `prefers-reduced-motion`.

## Evolución de diseño

Las vistas de biblioteca, cuentas, calendario, ajustes y despliegues heredan esta paleta, tipografía y espaciado. Cada integración debe mostrar su estado (conectada, requiere atención o no configurada) en texto y en color, mantener las credenciales fuera de la interfaz pública y conservar la misma jerarquía entre campaña, archivo y destino.

La navegación entre las seis vistas está activa. El resto de controles se mantiene deshabilitado hasta que exista el flujo correspondiente. Los datos de muestra se identifican como tales y deben reemplazarse por estados vacíos y datos reales antes de publicar Nex para usuarios.
