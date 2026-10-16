// Build: NODE_PATH=/tmp/skynet-deck-tools/node_modules node generate.cjs
const pptxgen = require('pptxgenjs');
const fs = require('node:fs');
const path = require('node:path');
const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Equipo Skynet';
pptx.subject = 'Estado preliminar del proyecto — 15 de octubre de 2026';
pptx.title = 'Skynet — Autonomous QA Platform';
pptx.company = 'Endava · Hackathon';
pptx.lang = 'es-AR';
pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'es-AR' };
const C = { bg:'F4F4F5', white:'FFFFFF', ink:'242426', muted:'626269', line:'DEDEE2', red:'A80000', dark:'151515', green:'24754F', amber:'85520E', lightRed:'FCEEEE' };
const W=13.333333, H=7.5, S=pptx.ShapeType;
const notes=[];
function shape(s,x,y,w,h,fill=C.white,line=C.line,type=S.rect){s.addShape(type,{x,y,w,h,fill:{color:fill},line:{color:line,width:.7},radius:.1});}
function text(s,t,x,y,w,h,size=20,color=C.ink,bold=false,extra={}){s.addText(t,{x,y,w,h,fontFace:'Arial',fontSize:size,color,bold,margin:0,breakLine:false,vertAnchor:'top',valign:'top',fit:'shrink',...extra});}
function line(s,x,y,w,h=0,color=C.line,arrow=false){s.addShape(S.line,{x,y,w,h,line:{color,width:1.4,...(arrow?{endArrowType:'triangle'}:{})}});}
function image(s,file,x,y,w,h){const p=path.join(__dirname,'assets',file);const b=fs.readFileSync(p);const iw=b.readUInt32BE(16),ih=b.readUInt32BE(20);const r=Math.min(w/iw,h/ih);s.addImage({path:p,x:x+(w-iw*r)/2,y:y+(h-ih*r)/2,w:iw*r,h:ih*r});}
function slide(title,kicker='ESTADO PRELIMINAR',source='',speaker=''){
 const s=pptx.addSlide();s.background={color:C.bg};
 shape(s,0,0,W,.075,C.red,C.red);text(s,kicker,.65,.3,11,.24,10,C.red,true);
 text(s,title,.65,.73,12,.65,30,C.ink,true);
 line(s,.65,7.03,12,0);text(s,'SKYNET · 15 OCT 2026 · PRELIMINAR',.65,7.16,4.1,.18,9,C.muted);
 text(s,source,4.3,7.16,7.85,.18,8.5,C.muted,false,{align:'right'});
 text(s,String(notes.length+1).padStart(2,'0'),12.35,7.12,.35,.25,11,C.red,true,{align:'right'});
 s.addNotes(speaker+'\n\nFuente de verificación: '+source+'\nRepositorio: commit 7c89229. Estado relevado el 15/10/2026.');
 notes.push({title,speaker,source}); return s;
}
function subtitle(s,t){text(s,t,.65,1.4,12,.5,17,C.muted);}
function card(s,x,y,w,h,title,body,{accent=C.red,size=19,fill=C.white}={}){const bodyY=h<=1.5?.65:.88;shape(s,x,y,w,h,fill);shape(s,x,y,.055,h,accent,accent);text(s,title,x+.2,y+.18,w-.4,.5,h<=1.5?19:21,C.ink,true);text(s,body,x+.2,y+bodyY,w-.4,h-bodyY-.15,size,C.muted);}
function bullets(s,items,x,y,w,{size=21,gap=.95,color=C.ink}={}){items.forEach((t,i)=>{shape(s,x,y+i*gap+.12,.07,.07,C.red,C.red);text(s,t,x+.22,y+i*gap,w-.22,gap-.12,size,color);});}
function tag(s,t,x,y,w,color=C.red){shape(s,x,y,w,.36,color,color);text(s,t,x+.08,y+.07,w-.16,.22,11,C.white,true);}
function table(s,headers,rows,widths,x=.65,y=1.8,rowH=.7,font=17){let xx=x;headers.forEach((h,i)=>{shape(s,xx,y,widths[i],.52,C.dark,C.dark);text(s,h,xx+.13,y+.13,widths[i]-.26,.3,13,C.white,true);xx+=widths[i];});rows.forEach((r,ri)=>{let xx=x; r.forEach((t,i)=>{shape(s,xx,y+.52+ri*rowH,widths[i],rowH,ri%2? 'EEEEF1':C.white);text(s,t,xx+.13,y+.67+ri*rowH,widths[i]-.26,rowH-.2,font,i===0?C.ink:C.muted,i===0);xx+=widths[i];});});}
function banner(s,t,y=6.3,color=C.dark){shape(s,.65,y,12,.48,color,color);text(s,t,.85,y+.1,11.6,.3,15,C.white,true);}

// 01
{
 const s=pptx.addSlide();s.background={color:'000000'};
 image(s,'skynet-logo.png',.75,1.0,4.4,3.15);
 shape(s,5.55,1.05,.055,4.85,C.red,C.red);
 text(s,'AUTONOMOUS\nQA PLATFORM',6.05,1.2,6.4,1.75,39,'E5E5E7',true);
 text(s,'Auditoría web multiagente\ncon revisión humana',6.08,3.28,6,1,25,'BDBDC4');
 text(s,'Presentación preliminar para el equipo',6.08,4.72,6,.45,19,'FFFFFF');
 text(s,'15 de octubre de 2026  ·  Estado: prototipo funcional',6.08,5.35,6,.6,15,'AAAAAF');
 shape(s,0,7.1,W,.05,C.red,C.red);
 text(s,'ENDAVA / HACKATHON',.75,6.65,4,.25,11,'AAAAAF');
 text(s,'Base de código: 7c89229',9.1,6.65,3.4,.25,11,'AAAAAF',false,{align:'right'});
 const speaker='Objetivo de la reunión: mostrar lo que ya funciona, explicar cómo está construido y acordar las prioridades. El nombre Autonomous se refiere a la ejecución de las comprobaciones: la decisión final sigue siendo humana. No se aplican correcciones al sitio automáticamente. Presentación sugerida: 15–20 minutos más preguntas; las dos últimas diapositivas son anexos.';
 s.addNotes(speaker);notes.push({title:'Skynet — Autonomous QA Platform',speaker,source:'Repositorio 7c89229; aplicación local'});
}
// 02
{
 const s=slide('Qué tenemos hoy','RESUMEN EJECUTIVO','Auditoría f5c05166 · 15/10/2026; código actual',
 'Tenemos un prototipo funcional que cubre ocho categorías con seis módulos especializados. La corrida observada duró 62,536 segundos y produjo 22 hallazgos. Se visitaron tres páginas válidas y una respuesta HTML 404. Esto demuestra funcionamiento, no precisión/recall ni desempeño representativo. El despliegue y la persistencia aún requieren trabajo.');
 subtitle(s,'Un flujo completo: sitio + reglas → hallazgos con evidencia → revisión del equipo.');
 const metrics=[['6','agentes especializados'],['8','categorías implementadas'],['22','hallazgos en la demo'],['62,5 s','duración observada']];
 metrics.forEach(([n,t],i)=>{const x=.65+i*3.06;shape(s,x,2.05,2.82,1.65);text(s,n,x+.22,2.28,2.4,.65,39,C.red,true);text(s,t,x+.22,3.08,2.4,.36,16,C.muted);});
 card(s,.65,4.08,5.85,1.85,'Ya implementado','Auditoría, revisión, actividad visible y configuración por archivos.',{size:20});
 card(s,6.8,4.08,5.85,1.85,'Próximo foco','Persistencia, Docker integral y ensayo con entradas desconocidas.',{accent:C.amber,size:20});
 text(s,'Corrida de práctica: 3 páginas válidas + 1 destino roto. No es un benchmark de calidad.',.65,6.3,12,.35,16,C.muted);
}
// 03
{
 const s=slide('El objetivo: QA de contenido reutilizable','PROPÓSITO Y ALCANCE','README.md; platform-template/README.md',
 'El desafío es auditar un sitio estático diferente cambiando entradas, sin modificar el código. Se verifican condiciones lingüísticas, editoriales, locales y de medios. No es hoy un sistema de pruebas funcionales de formularios ni de comparación visual de layouts. La plataforma conserva evidencia para que una persona decida.');
 subtitle(s,'Detectar problemas de contenido sin depender de la marca ni del idioma del sitio de práctica.');
 card(s,.65,2.05,3.8,3.55,'Entrada','URL del sitio\n\nPerfil lingüístico YAML\n\nReferencias Markdown',{size:20});
 card(s,4.75,2.05,3.8,3.55,'Análisis','Reglas deterministas\n\nModelos con contexto\n\nValidación de evidencias',{size:20});
 card(s,8.85,2.05,3.8,3.55,'Salida','Issues estructurados\n\nUbicación y corrección sugerida\n\nRevisión humana',{size:20});
 banner(s,'Alcance actual: calidad de contenido de sitios estáticos; sin corrección automática.');
}
// 04
{
 const s=slide('Entradas y contrato de salida','CONFIGURACIÓN','src/config.ts; reference-content.ts; docs/ISSUE_SCHEMA.json',
 'El perfil se carga en cada auditoría. SITE_URL, LINGUISTIC_ASSET_PATH, REFERENCE_CONTENT_PATH e ISSUE_SCHEMA_PATH definen las entradas. Las referencias se mapean por página. Los archivos montados se tratan como solo lectura. Reglas opcionales ausentes no se inventan; campos desconocidos no crean nuevas comprobaciones automáticamente. Las evidencias se conservan en su idioma original y se solicitan explicaciones en inglés.');
 card(s,.65,1.95,5.85,3.95,'Perfil del sitio','Locale objetivo y de origen\nFormatos de fecha, moneda y unidades\nVoz de marca y reglas de estilo\nGlosario: términos preferidos y prohibidos\nReferencias vinculadas a cada página',{size:19});
 card(s,6.8,1.95,5.85,3.95,'Cada hallazgo incluye','Categoría y severidad\nPágina + tipo de elemento / selector\nDescripción y evidencia\nResultado esperado + sugerencia\nConfianza y estado de revisión',{size:19});
 banner(s,'Los valores se leen de las entradas: cambiar de sitio no debe requerir cambiar código.');
}
// 05
{
 const s=slide('Stack: simple y explícito','IMPLEMENTACIÓN','package.json; Dockerfiles; src/server.ts',
 'Las versiones mostradas son las declaradas en package.json, no un inventario exacto de dependencias resueltas. El contenedor usa Node 22 slim. El frontend es HTML, CSS y JavaScript nativo; no React. No usamos un framework de agentes ni una base de datos. La integración OpenAI está en el backend; gpt-6-astra es el modelo configurado en la corrida observada, no un requisito fijo.');
 table(s,['CAPA','TECNOLOGÍA','RESPONSABILIDAD'],[
 ['Backend','Node.js 22 · TypeScript 5.8 · Express 5','API, ejecución y entrega del dashboard'],
 ['Crawler','Fetch + Cheerio','Recorrer HTML y extraer texto, enlaces y medios'],
 ['IA','OpenAI SDK 5 · Responses API','Salidas estructuradas e inspección de imágenes'],
 ['Reglas / validación','YAML + Ajv / JSON Schema','Perfil configurable y contrato de issues'],
 ['Frontend','HTML · CSS · JavaScript nativo','Actividad, filtros y revisión de hallazgos'],
 ['Ejecución / pruebas','Docker Compose · node:test · tsx','Entorno reproducible y pruebas con mocks'],
 ],[2.1,4.3,5.6],.65,1.85,.64,16);
 text(s,'Modelo observado: gpt-6-astra · configurable mediante OPENAI_MODEL. Estado almacenado en memoria.',.65,6.55,12,.3,14,C.muted);
}
// 06
{
 const s=slide('Arquitectura de extremo a extremo','DIAGRAMA','src/server.ts; src/orchestrator/audit.ts; src/agents/',
 'El navegador llama a Express. POST /api/audits responde 202 y continúa en segundo plano dentro del mismo proceso Node. El coordinador carga entradas y ejecuta el crawler, luego despacha módulos especializados. Cinco tipos de agentes pueden usar el cliente compartido de modelos; Links es determinista. El estado queda en memoria. El dashboard consulta el último estado; no hay cola distribuida ni event bus.');
 const box=(x,y,w,h,title,body,fill=C.white)=>{shape(s,x,y,w,h,fill);text(s,title,x+.15,y+.15,w-.3,.38,18,C.ink,true);text(s,body,x+.15,y+.65,w-.3,h-.7,15,C.muted);};
 box(.65,2.05,2.35,1.3,'Dashboard','Acciones + revisión');
 box(3.65,2.05,2.45,1.3,'Express API','HTTP / polling');
 box(6.75,2.05,2.6,1.3,'Orquestador','Registro + cola local');
 box(10,2.05,2.65,1.3,'Agentes','6 módulos / 8 categorías');
 line(s,3,2.7,.65,0,C.red,true);line(s,6.1,2.7,.65,0,C.red,true);line(s,9.35,2.7,.65,0,C.red,true);
 box(.65,4.35,2.35,1.3,'Entradas','YAML + MD + schema');
 box(3.65,4.35,2.45,1.3,'Estado en memoria','Run + issues + revisión');
 box(6.75,4.35,2.6,1.3,'Crawler','HTML del mismo origen');
 box(10,4.35,2.65,1.3,'OpenAI API','Texto + imágenes');
 line(s,4.9,3.35,0,1,C.muted,true);line(s,8.05,3.35,0,1,C.muted,true);line(s,11.3,3.35,0,1,C.red,true);
 line(s,3,5,.3,0,C.muted);line(s,3.3,3.05,0,1.95,C.muted);line(s,3.3,3.05,.35,0,C.muted,true);
 text(s,'Configuración cargada por el backend',.65,5.85,5.5,.4,13,C.muted);
 text(s,'Cliente compartido: estructura, reintentos y uso',8.5,5.85,4.15,.4,13,C.muted);
 banner(s,'Un proceso Node; workers lógicos concurrentes. No es una plataforma distribuida.');
}
// 07
{
 const s=slide('Workflow de una auditoría','PASO A PASO','src/orchestrator/audit.ts; src/dashboard/public/app.js',
 'Run audit inicia la ejecución. El perfil y schema se cargan primero; sin páginas HTML válidas el run falla. El crawler descubre páginas y recursos. El registro de agentes genera tareas por sitio o página. Se validan y deduplican hallazgos; el navegador ve actualizaciones por polling cada segundo. La revisión humana está disponible al terminar. Clear results elimina los resultados del servidor y sus decisiones de revisión.');
 const steps=[['01','Configurar','URL, perfil y referencias'],['02','Descubrir','Crawl del mismo origen'],['03','Despachar','Workers por alcance'],['04','Comprobar','Reglas + modelos'],['05','Validar','Schema, evidencia, IDs'],['06','Revisar','Verify / Dismiss / Escalate']];
 steps.forEach(([n,t,b],i)=>{const col=i%3,row=Math.floor(i/3),x=.65+col*4.1,y=1.95+row*2.12;shape(s,x,y,3.8,1.7);text(s,n,x+.2,y+.18,.55,.45,25,C.red,true);text(s,t,x+.9,y+.22,2.65,.4,22,C.ink,true);text(s,b,x+.2,y+.95,3.4,.4,18,C.muted);});
 banner(s,'El estado del run y el estado de revisión de cada issue son conceptos distintos.');
}
// 08
{
 const s=slide('Qué decide el orquestador','COORDINACIÓN','src/orchestrator/audit.ts; src/agents/model-check.ts',
 'El plan es explícito: no hay un modelo que decida libremente qué agente usar. Links corre una vez para todo el sitio y los otros cinco agentes se despachan por página aplicable. Para tres páginas, esto genera 16 workers: 1 + 5×3. Como máximo corren dos simultáneamente. Un fallo no cancela los demás. Se preservan hallazgos deterministas válidos ante fallos del modelo. El cliente de IA tiene 60 segundos de timeout por intento y un reintento para errores transitorios.');
 card(s,.65,1.95,5.85,3.95,'Plan de ejecución','Registro: agente + categorías + alcance\n\nUna tarea de Links para el sitio\nCinco tipos de agentes por página\n\nMáximo 2 workers simultáneos',{size:20});
 card(s,6.8,1.95,5.85,3.95,'Control y resiliencia','Fallos aislados por worker\n\n1 reintento ante errores transitorios\nTimeout de modelo: 60 s por intento\n\nSchema + deduplicación + estado previo',{size:20});
 banner(s,'Demo actual: 6 agentes → 16 workers → 15 completados + 1 no aplicable.');
}
// 09
{
 const s=slide('Seis agentes, ocho categorías','COBERTURA','src/agents/; registro en src/orchestrator/audit.ts',
 'Agente y categoría no son lo mismo. Locale/Formatting agrupa dos categorías y Brand/Terminology otras dos. Links es determinista. Language, Brand y Translation usan modelo; Locale y Media mezclan comprobaciones deterministas con modelo. La fuente de cada verificación debe estar configurada o disponible. Cobertura implementada no implica que cada check se ejecute en cada página.');
 table(s,['AGENTE','CATEGORÍAS','CÓMO COMPRUEBA'],[
 ['Language','Ortografía y gramática','Modelo + citas exactas del texto'],
 ['Links','Enlaces','Respuestas HTTP del mismo origen'],
 ['Locale / Formatting','Formato + reglas locales','Fechas deterministas + reglas con modelo'],
 ['Brand / Terminology','Voz de marca + terminología','Reglas de marca y glosario en contexto'],
 ['Translation Quality','Calidad de traducción','Referencia Markdown vs. texto destino'],
 ['Media','Imágenes y video','Recursos + alt + WebVTT + visión'],
 ],[2.5,3.65,5.85],.65,1.85,.68,16);
 text(s,'Las comprobaciones visuales del modelo se identifican como observaciones que requieren revisión.',.65,6.62,12,.3,14,C.muted);
}
// 10
{
 const s=slide('De una respuesta de IA a un hallazgo revisable','CALIDAD DE LA EVIDENCIA','docs/ISSUE_SCHEMA.json; model-check.ts; translation-quality.ts; media.ts',
 'El modelo devuelve estructura, pero no se confía ciegamente en ella. El coordinador valida schema y categorías. Los agentes de texto exigen citas presentes en sus entradas; Translation valida ambas fuentes por separado. La visión no se puede verificar como una subcadena de píxeles y se etiqueta como observación del modelo. La confianza es una estimación de la salida, no precisión calibrada. Verified confirma la existencia del problema, no su corrección.');
 bullets(s,['Estructura validada: categoría, severidad, ubicación, evidencia y estado.','Citas de texto verificadas contra las entradas; traducción valida origen y destino.','Observaciones visuales explícitamente marcadas para revisión humana.','IDs estables y deduplicación para evitar hallazgos repetidos.'],.8,2.0,11.5,{size:22,gap:1.0});
 banner(s,'Verified = hallazgo confirmado. No significa que el contenido del sitio ya esté corregido.');
}
// 11
{
 const s=slide('La app: una superficie de revisión','PRODUCTO ACTUAL','Captura real del dashboard · localhost:3000',
 'Mostrar primero el flujo visible: Run audit, crawl solo enlaces y Clear results. La barra resume estado, duración y hallazgos; el panel de actividad se abre bajo demanda. Pages distingue páginas exitosas de destinos rotos. Findings permite filtrar y revisar. La identidad visual utiliza cabecera oscura, superficie clara y acentos rojos. Captura de resultados existentes: no es una maqueta.');
 shape(s,.65,1.65,8.6,4.97,C.white);image(s,'dashboard.png',.72,1.72,8.46,4.83);
 bullets(s,['Acciones de ejecución','Resumen compacto','Páginas y destinos rotos','Filtros y hallazgos'],9.55,2.0,3.05,{size:20,gap:1.05});
}
// 12
{
 const s=slide('Actividad visible sin saturar la página','OBSERVABILIDAD','activity.js; polling de GET /api/audits/latest',
 'El panel agrupa estados por agente y muestra los últimos 60 cambios observados en la pestaña. Las marcas horarias son de observación, no un log durable del servidor. Puede perder transiciones muy breves entre polls. Technical details contiene tiempos, intentos, tokens, costos y checks de medios. Los costos son desconocidos si faltan tarifas o uso; no se muestran como cero. La ausencia de imágenes o videos es no aplicable; otros skips y fallos conservan su significado.');
 image(s,'activity-panel.png',.65,1.62,3.25,5.2);
 card(s,4.3,1.85,8.35,1.35,'Vista humana','Quién está trabajando, qué terminó y qué requiere atención.',{size:18});
 card(s,4.3,3.45,8.35,1.35,'Detalles a demanda','Cobertura, intentos, duración, tokens, costos y recursos.',{size:18});
 card(s,4.3,5.05,8.35,1.35,'“No aplicable” no es un fallo','Media en Pricing: no hay imágenes ni videos para inspeccionar.',{size:18,accent:C.green});
}
// 13
{
 const s=slide('Hallazgos que el equipo puede revisar','WORKFLOW HUMANO','issues-view.js; captura real de Translation Quality',
 'La tarjeta separa severidad, categoría y estado. La evidencia mantiene las citas originales. Expected y Suggested fix se agrupan, Details contiene confianza y selector. Las acciones guardan estado sin reconstruir la tarjeta ni cerrar los bloques expandidos. Un error de guardado se muestra dentro de la tarjeta. Las decisiones persisten solo en la sesión actual del servidor.');
 image(s,'translation-finding.png',.65,1.95,8.25,4.55);
 card(s,9.2,1.95,3.45,4.55,'Decisión humana','Verify\nConfirmar el problema\n\nDismiss\nDescartar el hallazgo\n\nEscalate\nPedir revisión adicional',{size:18});
}
// 14
{
 const s=slide('Caso real: subtítulos en el idioma equivocado','EJEMPLO DE MEDIA','about.html:68; video/captions.vtt; hallazgo media-e3c90b8d03179145',
 'En About, sección Conoce al equipo, el primer video tiene un track con srclang es y etiqueta Español. La lectura real del WebVTT encontró cues en inglés. El agente reporta el XPath, URL del recurso y texto de evidencia. La corrección propuesta es español. La tarjeta está Verified porque el hallazgo se confirmó, pero no se ha editado el archivo de práctica. Mostrar en la demo activando los subtítulos Español.');
 image(s,'caption-finding.png',.65,1.85,8.15,4.8);
 tag(s,'DÓNDE',9.1,1.95,1.2);
 text(s,'About → Conoce al equipo',9.1,2.5,3.55,.8,22,C.ink,true);
 text(s,'(//video)[1]/track[1]\n\n/video/captions.vtt',9.1,3.55,3.55,1.1,16,C.muted);
 text(s,'Etiqueta: Español\nContenido: inglés',9.1,5.15,3.55,1.0,21,C.red,true);
}
// 15
{
 const s=slide('Resultado observado en el sitio de práctica','EVIDENCIA DE FUNCIONAMIENTO','GET /api/audits/latest · 15/10/2026 13:57 ART',
 'Esta corrida completada tiene 22 issues y duró 62,536 segundos. Las categorías suman 1 Links, 1 Language, 4 Locale, 1 Formatting, 3 Terminology, 2 Brand, 4 Translation y 6 Media. Se despacharon 16 workers y 15 completaron; Media/Pricing fue no aplicable. No confundir 4 respuestas HTML con 4 páginas válidas: una era un 404. No hay costo en dólares validado porque las tarifas no estaban configuradas.');
 card(s,.65,1.95,3.5,3.9,'Una corrida completa','22 hallazgos\n62,5 segundos\n3 páginas válidas\n1 destino roto\n15 workers completados\n1 check no aplicable',{size:21});
 const rows=[['Media',6],['Reglas locales',4],['Traducción',4],['Terminología',3],['Voz de marca',2],['Formato',1],['Gramática',1],['Enlaces',1]];
 rows.forEach(([name,n],i)=>{const y=1.98+i*.49;text(s,name,4.6,y,2.4,.33,17,C.muted);shape(s,7.15,y+.025,n*.72,.25,i===0?C.red:'77777F',i===0?C.red:'77777F');text(s,String(n),7.3+n*.72,y-.015,.6,.33,17,C.ink,true);});
 banner(s,'Smoke test: no demuestra precisión/recall ni garantiza el mismo resultado en otro sitio.');
}
// 16
{
 const s=slide('Qué validamos hasta ahora','VALIDACIÓN','npm test + typecheck; pruebas de navegador; smoke test real',
 'Se ejecutó la suite actual durante la preparación: 57 entradas TAP aprobadas, incluyendo grupos. Las pruebas usan sitios y APIs simuladas, no llamadas pagas. El typecheck pasó. Las comprobaciones de navegador cubrieron móvil, teclado, actualizaciones, filtros, expansión de evidencia y guardado/error de revisión. El smoke test real demuestra integración. Ninguno de estos reemplaza un benchmark humano de precisión y recall con ground truth.');
 card(s,.65,1.95,3.8,3.85,'57 tests aprobados','Contratos y evidencia\nErrores y reintentos\nPerfiles alternativos\nReset y estado de revisión\nCobertura / no aplicable',{size:19});
 card(s,4.75,1.95,3.8,3.85,'Navegador','Desktop y móvil\nTeclado y foco\nPanel de actividad\nTarjetas estables\nFiltros y errores de guardado',{size:19});
 card(s,8.85,1.95,3.8,3.85,'Integración real','Corrida de 8 categorías\nEvidencias inspeccionadas\nEjemplos de texto y medios\n\nPendiente: benchmark de calidad',{size:19,accent:C.amber});
 banner(s,'Validación técnica ≠ exactitud semántica. Hace falta evaluación humana sistemática.');
}
// 17
{
 const s=slide('Cómo se ejecuta y configura','OPERACIÓN','platform-template/README.md; docker-compose.yml; .env.example',
 'En local, el sitio debe estar disponible en el puerto 8080 y el dashboard en 3000. npm run dev carga ../.env. El API key se mantiene en backend. Docker Compose define ambos servicios y montajes de solo lectura, pero todavía falta validación end to end de ese camino. El modelo y las tarifas se configuran por entorno. Ejecutar Run audit envía texto, referencias y medios a OpenAI y consume API.');
 card(s,.65,1.95,5.85,2.2,'Desarrollo local','cd platform-template\nnpm install\nnpm run dev',{size:21});
 card(s,.65,4.4,5.85,1.6,'Docker Compose','docker compose up --build\nConfigurado; validación integral pendiente.',{size:17,accent:C.amber});
 card(s,6.8,1.95,5.85,4.05,'Variables principales','SITE_URL\nLINGUISTIC_ASSET_PATH\nREFERENCE_CONTENT_PATH\nISSUE_SCHEMA_PATH\nOPENAI_API_KEY / OPENAI_MODEL\nTarifas opcionales para estimar costos',{size:18});
 text(s,'API key en backend. Los inputs montados se leen; el contenido del sitio no se modifica.',.65,6.42,12,.35,16,C.muted);
}
// 18
{
 const s=slide('Límites actuales: qué no debemos prometer','ALCANCE REAL','README: Current limits; crawler; media-resources; server.ts',
 'El servidor conserva solo el último run en memoria; reiniciar borra resultados. Links no cubre externos, locale de destino ni semántica de anclas. El crawler no ejecuta JavaScript ni valida layout. El límite de visitas es 50 y texto de página mayor a 24.000 caracteres falla el paso de modelo sin chunking. Media está limitado al mismo origen y formatos raster admitidos; verifica disponibilidad de video, no audio, frames ni sincronización. La calidad semántica requiere juicio humano.');
 card(s,.65,1.95,5.85,1.85,'Memoria y trazabilidad','Sin historial durable de runs ni auditoría persistente de revisiones.',{size:19,accent:C.amber});
 card(s,6.8,1.95,5.85,1.85,'Cobertura de enlaces','Faltan externos, destino en otro locale y coherencia texto/destino.',{size:19,accent:C.amber});
 card(s,.65,4.08,5.85,1.85,'Escala y navegación','50 visitas; texto >24.000 caracteres sin chunking. No ejecuta JavaScript.',{size:19,accent:C.amber});
 card(s,6.8,4.08,5.85,1.85,'Medios y criterio del modelo','Sin reproducción/audio/sincronía de video; límites de recursos e imágenes.',{size:19,accent:C.amber});
}
// 19
{
 const s=slide('Próximos pasos propuestos','ROADMAP PRIORIZADO','docs/HANDOFF.md: Next Task; README: milestones',
 'La siguiente tarea registrada es persistencia. Proponemos mantenerla como prioridad: runs, workers, findings y decisiones con timestamps, más pruebas de recuperación. Después validar Docker y la permanencia de datos. Ampliar Links para el catálogo completo. Ensayar con un sitio/perfil desconocido y medir precisión y recall sobre anotaciones humanas. Robustez adicional: chunking y consistencia de explicaciones. No se comprometen fechas ni esfuerzo estimado en esta presentación.');
 table(s,['ORDEN','ENTREGABLE','CRITERIO DE SALIDA'],[
 ['1','Persistencia e historial','Runs y revisiones sobreviven a reinicios'],
 ['2','Validación Docker end to end','Arranque y auditoría reproducibles'],
 ['3','Ampliar Links','Externos, locale y significado del destino'],
 ['4','Ensayo con sitio desconocido','Sin cambios de código + revisión de calidad'],
 ['5','Robustez y límites','Chunking y explicaciones consistentes'],
 ],[1.0,4.2,6.8],.65,1.95,.77,18);
 text(s,'Prioridad para acordar hoy: consolidar la base antes de ampliar el alcance.',.65,6.62,12,.3,16,C.red,true);
}
// 20
{
 const s=slide('Guion para la demo y conversación del equipo','CIERRE','Aplicación local; funcionalidades implementadas',
 'Propuesta de demo en cinco minutos: abrir el dashboard con resultados existentes, explicar el resumen, mostrar actividad y su detalle, revisar el hallazgo de subtítulos y ubicarlo en About, luego explicar los estados. Si se ejecuta una auditoría nueva, advertir que consume API y esperar aproximadamente un minuto en este sitio, sin prometer el mismo tiempo. No usar Clear results antes de mostrar los hallazgos. Decisiones: prioridad de persistencia, responsable del ensayo y criterios de calidad.');
 bullets(s,['Mostrar la corrida actual: 22 hallazgos y cobertura real.','Abrir View activity: agentes, no aplicable y detalles técnicos.','Abrir una tarjeta: evidencia, corrección y ubicación en el sitio.','Explicar Verify / Dismiss / Escalate y Clear results.'],.8,1.95,11.5,{size:22,gap:.9});
 banner(s,'Para acordar: prioridad de persistencia, responsables y criterio de calidad para el siguiente ensayo.',6.2);
}
// 21
{
 const s=slide('Anexo A · API disponible','REFERENCIA TÉCNICA','src/server.ts',
 'Estos endpoints existen hoy. Se permiten una auditoría o crawl activos; solicitudes concurrentes se rechazan con 409. DELETE results también rechaza durante ejecución. La revisión valida los estados admitidos. No hay API de historial durable, exportación de resultados ni cancelación de auditoría.');
 table(s,['ENDPOINT','USO'],[
 ['POST /api/audits','Inicia auditoría en segundo plano; devuelve 202'],
 ['GET /api/audits/latest','Estado, workers, cobertura y hallazgos'],
 ['POST /api/crawl','Crawl y Links sin llamadas al modelo'],
 ['GET /api/pages · GET /api/issues','Consulta los resultados actuales'],
 ['PATCH /api/issues/:id/status','verified / dismissed / escalated'],
 ['DELETE /api/results','Borra resultados y decisiones de revisión'],
 ['GET /api/health · POST /api/test-model','Estado del servidor y conexión con el modelo'],
 ],[5.25,6.75],.65,1.72,.61,16);
}
// 22
{
 const s=slide('Anexo B · Mapa del código y fuentes','REFERENCIA TÉCNICA','Repositorio 7c89229 · documentación y captura actual',
 'Los diagramas y las cifras se basan en el código, no solo en documentación histórica. AGENTS y partes del README raíz todavía describen el scaffold original; para el estado actual usar platform-template/README y src. La captura corresponde a una corrida real del 15 de octubre. Los archivos de esta presentación incluyen notas del expositor y capturas para reutilización.');
 table(s,['RUTA','QUÉ ENCONTRAR'],[
 ['src/server.ts · src/config.ts','API, configuración y estado actual'],
 ['src/crawler/crawl.ts','Descubrimiento y extracción HTML'],
 ['src/orchestrator/audit.ts','Registro, despacho y concurrencia'],
 ['src/agents/','Checks y cliente compartido de modelos'],
 ['src/dashboard/public/','Interfaz, actividad y tarjetas de hallazgos'],
 ['test/ · docs/ISSUE_SCHEMA.json','Pruebas y contrato de salida'],
 ['platform-template/README.md · docs/HANDOFF.md','Operación, límites y próximos hitos'],
 ],[6.3,5.7],.65,1.72,.61,16);
 text(s,'Rutas src/ y test/ relativas a platform-template/.',.65,6.68,12,.2,12,C.muted);
}

const base='Skynet_Presentacion_Preliminar_2026-10-15';
fs.writeFileSync(path.join(__dirname,base+'_Notas.txt'),notes.map((n,i)=>`${String(i+1).padStart(2,'0')}. ${n.title}\n\n${n.speaker}\n\nFuentes: ${n.source}\n`).join('\n'+'='.repeat(80)+'\n\n'));
pptx.writeFile({fileName:path.join(__dirname,base+'.pptx')}).then(()=>console.log(`Created ${notes.length} slides with presenter notes.`));
