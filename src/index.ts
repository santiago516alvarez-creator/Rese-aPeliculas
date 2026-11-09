// ===== INTERFACES =====
interface Pelicula {
  id: number; titulo: string; genero: string; anio: number; sinopsis: string;
  imagen_url: string; estado: 'estreno' | 'cartelera' | 'finalizado';
}
interface Producto { id: number; nombre_producto: string; descripcion: string; precio: string; imagen_url: string; }
interface Promocion { id: number; titulo: string; descripcion: string; imagen_url: string; fecha_fin: string; }
interface Resenia { id: number; puntuacion: number; comentario: string; fecha: string; nick: string; }
interface UsuarioSesion { id: number; nick: string; nombre: string; email: string; foto_perfil: string; edad: number; }
interface Usuario extends UsuarioSesion { vistas: number; likes: number; espera: number; contribuido: number; }
interface RespuestaAuth { usuario: UsuarioSesion; token: string; }
interface FilaPerfil {
  pelicula_id: number; titulo: string;
  genero?: string; anio?: number; puntuacion?: number; comentario?: string; fecha?: string;
}

// ===== ESTADO =====
function leerSesionGuardada(): UsuarioSesion | null {
  try {
    return JSON.parse(localStorage.getItem('usuarioSesion') || 'null');
  } catch {
    return null; // si el localStorage está corrupto, se ignora
  }
}

let usuarioActual: UsuarioSesion | null = leerSesionGuardada();
let tokenSesion: string | null = localStorage.getItem('tokenSesion');
let peliculaActual = 0;
let filtroActual = '';
let tabPerfilActual = 'resenias';
let contadorPeticionTab = 0; // para ignorar respuestas viejas al cambiar de pestaña

// ===== UTILIDADES =====
function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

// Todas las llamadas a la API pasan por aquí: agrega el token y maneja errores y sesión vencida
async function api<T>(url: string, opciones: RequestInit = {}): Promise<T> {
  const cabeceras = new Headers(opciones.headers);
  if (tokenSesion) cabeceras.set('Authorization', `Bearer ${tokenSesion}`);
  if (opciones.body) cabeceras.set('Content-Type', 'application/json');

  const respuesta = await fetch(url, { ...opciones, headers: cabeceras });

  if (respuesta.status === 401 && tokenSesion) {
    // El servidor ya no reconoce el token (por ejemplo, se reinició)
    limpiarSesionLocal();
    irA('login', true);
    throw new Error('Tu sesión expiró. Inicia sesión de nuevo.');
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error((datos as { error?: string }).error ?? `Error ${respuesta.status}`);
  }
  return datos as T;
}

function crearTarjeta(imagen: string, titulo: string, extra: string, alHacerClic?: () => void): HTMLElement {
  const tarjeta = document.createElement('article');
  tarjeta.className = 'tarjeta';
  const img = document.createElement('img');
  img.src = imagen;
  img.alt = titulo;
  const info = document.createElement('div');
  info.className = 'info';
  const h3 = document.createElement('h3');
  h3.textContent = titulo;
  const p = document.createElement('p');
  p.textContent = extra;
  info.append(h3, p);
  tarjeta.append(img, info);
  if (alHacerClic) tarjeta.addEventListener('click', alHacerClic);
  return tarjeta;
}

function mostrarVista(nombre: string): void {
  document.querySelectorAll('.vista').forEach(v => v.classList.add('oculta'));
  $(`vista-${nombre}`).classList.remove('oculta');
  window.scrollTo(0, 0);
}

// ===== SESIÓN =====
function actualizarBarraNav(): void {
  $('nav-autenticado').classList.toggle('oculta', usuarioActual === null);
  $('nav-invitado').classList.toggle('oculta', usuarioActual !== null);
}

function guardarSesion(datos: RespuestaAuth): void {
  usuarioActual = datos.usuario;
  tokenSesion = datos.token;
  localStorage.setItem('usuarioSesion', JSON.stringify(datos.usuario));
  localStorage.setItem('tokenSesion', datos.token);
  actualizarBarraNav();
}

// Borra la sesión del navegador y los datos privados que quedaron en pantalla
function limpiarSesionLocal(): void {
  usuarioActual = null;
  tokenSesion = null;
  localStorage.removeItem('usuarioSesion');
  localStorage.removeItem('tokenSesion');

  ['form-login', 'form-registro', 'form-resenia'].forEach(id => ($(id) as HTMLFormElement).reset());
  ['mensaje-login', 'mensaje-registro', 'mensaje-resenia', 'perfil-contadores', 'perfil-actividad', 'lista-resenias']
    .forEach(id => { $(id).textContent = ''; });

  tabPerfilActual = 'resenias';
  document.querySelectorAll<HTMLButtonElement>('.pestana')
    .forEach(b => b.classList.toggle('activa', b.dataset.tab === 'resenias'));
  actualizarBarraNav();
}

async function cerrarSesion(): Promise<void> {
  try {
    await api('/api/auth/logout', { method: 'POST' }); // el servidor olvida el token
  } catch {
    // aunque falle la red, cerramos la sesión en el navegador igualmente
  }
  limpiarSesionLocal();
  irA('login', true);
}

// Al abrir la página: comprueba que el token guardado siga siendo válido
async function restaurarSesion(): Promise<void> {
  if (tokenSesion) {
    try {
      usuarioActual = await api<UsuarioSesion>('/api/auth/sesion');
      localStorage.setItem('usuarioSesion', JSON.stringify(usuarioActual));
    } catch {
      limpiarSesionLocal();
    }
  } else if (usuarioActual) {
    limpiarSesionLocal(); // sesión guardada por la versión anterior, sin token
  }
  actualizarBarraNav();
  enrutar();
}

// ===== RUTAS (por hash: funciona el botón Atrás, sin recargar la página) =====
const RUTAS_VALIDAS = ['inicio', 'catalogo', 'perfil', 'pelicula', 'login', 'registro'];
const RUTAS_PUBLICAS = ['login', 'registro'];

// Cambia de ruta. Con reemplazar=true no deja la ruta anterior en el historial
function irA(ruta: string, reemplazar = false): void {
  const destino = `#${ruta}`;
  if (location.hash === destino) { enrutar(); return; } // misma ruta: solo refresca
  if (reemplazar) location.replace(destino);
  else location.hash = destino;
}

function enrutar(): void {
  const [vista, parametro] = location.hash.slice(1).split('/');
  const haySesion = usuarioActual !== null;

  if (!RUTAS_VALIDAS.includes(vista)) { irA(haySesion ? 'inicio' : 'login', true); return; }
  if (!haySesion && !RUTAS_PUBLICAS.includes(vista)) { irA('login', true); return; }
  if (haySesion && RUTAS_PUBLICAS.includes(vista)) { irA('inicio', true); return; }

  switch (vista) {
    case 'inicio': mostrarVista('inicio'); cargarInicio(); break;
    case 'catalogo': mostrarVista('catalogo'); cargarCatalogo(); break;
    case 'perfil': mostrarVista('perfil'); cargarPerfil(); break;
    case 'pelicula': abrirDetalle(Number(parametro)); break;
    default: mostrarVista(vista); // login y registro
  }
}

// ===== RENDERIZADO =====
function renderizarProductos(contenedorId: string, peliculas: Pelicula[]): void {
  const contenedor = $(contenedorId);
  contenedor.innerHTML = '';
  if (peliculas.length === 0) { contenedor.textContent = 'Sin resultados.'; return; }
  peliculas.forEach(p =>
    contenedor.appendChild(crearTarjeta(p.imagen_url, p.titulo, `${p.genero} · ${p.anio}`, () => irA(`pelicula/${p.id}`)))
  );
}

function renderizarConfiteria(productos: Producto[]): void {
  const contenedor = $('lista-confiteria');
  contenedor.innerHTML = '';
  productos.forEach(p =>
    contenedor.appendChild(crearTarjeta(p.imagen_url, p.nombre_producto, `$${p.precio} · ${p.descripcion}`)));
}

function renderizarPromos(promos: Promocion[]): void {
  const contenedor = $('lista-promos');
  contenedor.innerHTML = '';
  promos.forEach(p =>
    contenedor.appendChild(crearTarjeta(p.imagen_url, p.titulo, p.descripcion)));
}

// ===== CARGA DE DATOS =====
async function cargarInicio(): Promise<void> {
  try {
    renderizarProductos('grilla-estrenos', await api<Pelicula[]>('/api/peliculas?estado=estreno'));
    renderizarProductos('grilla-finalizando', await api<Pelicula[]>('/api/peliculas?estado=finalizado'));
    renderizarPromos(await api<Promocion[]>('/api/promociones'));
    renderizarConfiteria(await api<Producto[]>('/api/confiteria'));
  } catch (error) {
    console.error(error);
  }
}

async function cargarCatalogo(): Promise<void> {
  const genero = ($('select-genero') as HTMLSelectElement).value;
  const q = ($('buscador') as HTMLInputElement).value.trim();
  const params = new URLSearchParams();
  if (filtroActual) params.set('filtro', filtroActual);
  if (genero) params.set('genero', genero);
  if (q) params.set('q', q);
  try {
    renderizarProductos('grilla-catalogo', await api<Pelicula[]>(`/api/peliculas?${params}`));
  } catch (error) {
    console.error(error);
  }
}

async function cargarGeneros(): Promise<void> {
  const select = $('select-genero') as HTMLSelectElement;
  try {
    const generos = await api<{ genero: string }[]>('/api/generos');
    select.length = 1; // deja solo "Géneros" para no duplicar opciones
    generos.forEach(g => select.add(new Option(g.genero, g.genero)));
  } catch (error) {
    console.error(error);
  }
}

// ===== DETALLE DE PELÍCULA =====
async function abrirDetalle(id: number): Promise<void> {
  if (!id) { irA('catalogo', true); return; }
  try {
    const p = await api<Pelicula>(`/api/peliculas/${id}`);
    peliculaActual = p.id;
    $('detalle-titulo').textContent = `${p.titulo} (${p.anio})`;
    $('detalle-sinopsis').textContent = p.sinopsis;
    ($('detalle-poster') as HTMLImageElement).src = p.imagen_url;
    $('detalle-meta').textContent = `Género: ${p.genero} · Estado: ${p.estado}`;
    $('mensaje-resenia').textContent = '';
    $('btn-accion-like').classList.remove('activo');
    $('btn-accion-espera').classList.remove('activo');
    mostrarVista('detalle');
    await Promise.all([cargarResenias(), comprobarEstadoInteraccion()]);
  } catch (error) {
    console.error(error);
    if (usuarioActual) irA('catalogo', true); // película inexistente: volvemos al catálogo
  }
}

async function comprobarEstadoInteraccion(): Promise<void> {
  const estado = await api<{ like: boolean; espera: boolean }>(
    `/api/usuario/estado-pelicula?pelicula_id=${peliculaActual}`
  );
  $('btn-accion-like').classList.toggle('activo', estado.like);
  $('btn-accion-espera').classList.toggle('activo', estado.espera);
}

// Like y watchlist usan la misma lógica: solo cambia el botón si el servidor confirmó
async function alternarAccion(tipo: 'like' | 'espera', botonId: string): Promise<void> {
  const boton = $(botonId);
  const accion = boton.classList.contains('activo') ? 'remove' : 'add';
  try {
    await api('/api/usuario/accion', {
      method: 'POST',
      body: JSON.stringify({ pelicula_id: peliculaActual, tipo, accion })
    });
    boton.classList.toggle('activo');
  } catch (error) {
    console.error(error);
  }
}

async function cargarResenias(): Promise<void> {
  const lista = $('lista-resenias');
  lista.innerHTML = '';
  const resenias = await api<Resenia[]>(`/api/resenias?pelicula_id=${peliculaActual}`);
  if (resenias.length === 0) { lista.textContent = 'Aún no hay reseñas.'; return; }
  resenias.forEach(r => {
    const li = document.createElement('li');
    li.textContent = `${r.nick} — ${r.puntuacion}/10: ${r.comentario}`;
    lista.appendChild(li);
  });
}

// ===== PERFIL =====
async function cargarPerfil(): Promise<void> {
  if (!usuarioActual) return;
  try {
    const datos = await api<{ usuario: Usuario }>(`/api/usuarios/${usuarioActual.id}/perfil`);
    const u = datos.usuario;
    ($('perfil-foto') as HTMLImageElement).src = u.foto_perfil;
    $('perfil-nombre').textContent = u.nombre;
    $('perfil-nick').textContent = `@${u.nick}`;
    $('perfil-email').textContent = u.email;
    $('perfil-edad').textContent = `${u.edad} años`;

    const contadores = $('perfil-contadores');
    contadores.innerHTML = '';
    const items: [string, number][] = [['Películas vistas', u.vistas], ['Likes', u.likes], ['Lista de espera', u.espera]];
    items.forEach(([etiqueta, valor]) => {
      const div = document.createElement('div');
      div.textContent = `${etiqueta}: ${valor}`;
      contadores.appendChild(div);
    });

    await cargarPestanaPerfil(tabPerfilActual);
  } catch (error) {
    console.error(error);
  }
}

function filaMensaje(cuerpo: HTMLElement, texto: string, columnas: number): void {
  const fila = document.createElement('tr');
  const celda = document.createElement('td');
  celda.colSpan = columnas;
  celda.textContent = texto;
  fila.appendChild(celda);
  cuerpo.appendChild(fila);
}

async function cargarPestanaPerfil(tab: string): Promise<void> {
  if (!usuarioActual) return;
  const miPeticion = ++contadorPeticionTab;
  const esResenias = tab === 'resenias';
  const columnas = esResenias ? 4 : 3;
  const cuerpo = $('perfil-actividad');

  $('perfil-th-row').innerHTML = esResenias
    ? '<th>Película</th><th>Puntos</th><th>Comentario</th><th>Fecha</th>'
    : '<th>Película</th><th>Género</th><th>Año</th>';
  cuerpo.innerHTML = '';
  filaMensaje(cuerpo, 'Cargando...', columnas);

  try {
    const filas = await api<FilaPerfil[]>(`/api/usuarios/${usuarioActual.id}/pestana/${tab}`);
    if (miPeticion !== contadorPeticionTab) return; // llegó tarde: ya cambiaste de pestaña

    cuerpo.innerHTML = '';
    if (filas.length === 0) { filaMensaje(cuerpo, 'Todavía no hay nada aquí.', columnas); return; }

    filas.forEach(f => {
      const textos = esResenias
        ? [f.titulo, String(f.puntuacion ?? ''), f.comentario ?? '', f.fecha ? new Date(f.fecha).toLocaleDateString() : '']
        : [f.titulo, f.genero ?? '', String(f.anio ?? '')];
      const fila = document.createElement('tr');
      fila.className = 'fila-link';
      textos.forEach(texto => {
        const celda = document.createElement('td');
        celda.textContent = texto;
        fila.appendChild(celda);
      });
      fila.addEventListener('click', () => irA(`pelicula/${f.pelicula_id}`));
      cuerpo.appendChild(fila);
    });
  } catch (error) {
    if (miPeticion !== contadorPeticionTab) return;
    cuerpo.innerHTML = '';
    filaMensaje(cuerpo, 'No se pudo cargar la información.', columnas);
  }
}

// ===== EVENTOS =====
// Solo los botones con data-vista navegan (así "Cerrar sesión" ya no dispara el Lobby)
document.querySelectorAll<HTMLButtonElement>('.menu button[data-vista]').forEach(boton => {
  boton.addEventListener('click', () => irA(boton.dataset.vista ?? 'inicio'));
});

$('btn-cerrar-sesion').addEventListener('click', cerrarSesion);

document.querySelectorAll<HTMLButtonElement>('.filtros button').forEach(boton => {
  boton.addEventListener('click', () => { filtroActual = boton.dataset.filtro ?? ''; cargarCatalogo(); });
});

document.querySelectorAll<HTMLButtonElement>('.pestana').forEach(boton => {
  boton.addEventListener('click', () => {
    document.querySelectorAll('.pestana').forEach(b => b.classList.remove('activa'));
    boton.classList.add('activa');
    tabPerfilActual = boton.dataset.tab ?? 'resenias';
    cargarPestanaPerfil(tabPerfilActual);
  });
});

$('select-genero').addEventListener('change', cargarCatalogo);
$('btn-volver').addEventListener('click', () => irA('catalogo'));
$('btn-accion-like').addEventListener('click', () => alternarAccion('like', 'btn-accion-like'));
$('btn-accion-espera').addEventListener('click', () => alternarAccion('espera', 'btn-accion-espera'));

$('form-busqueda').addEventListener('submit', (e: Event) => {
  e.preventDefault();
  irA('catalogo');
});

$('form-resenia').addEventListener('submit', async (e: Event) => {
  e.preventDefault();
  const mensaje = $('mensaje-resenia');
  const puntuacion = Number(($('resenia-puntos') as HTMLInputElement).value);
  const comentario = ($('resenia-comentario') as HTMLTextAreaElement).value;
  try {
    await api('/api/resenias', {
      method: 'POST',
      body: JSON.stringify({ pelicula_id: peliculaActual, puntuacion, comentario })
    });
    mensaje.textContent = '¡Reseña guardada!';
    ($('form-resenia') as HTMLFormElement).reset();
    await cargarResenias();
  } catch (error) {
    mensaje.textContent = 'Error al guardar la reseña.';
  }
});

// ===== LOGIN Y REGISTRO =====
$('form-login').addEventListener('submit', async (e: Event) => {
  e.preventDefault();
  const mensaje = $('mensaje-login');
  mensaje.textContent = '';
  const email = ($('login-email') as HTMLInputElement).value;
  const password = ($('login-password') as HTMLInputElement).value;
  try {
    const datos = await api<RespuestaAuth>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    guardarSesion(datos);
    ($('form-login') as HTMLFormElement).reset();
    irA('inicio', true); // reemplaza #login en el historial
  } catch (error) {
    mensaje.textContent = error instanceof Error ? error.message : 'No se pudo iniciar sesión.';
  }
});

$('form-registro').addEventListener('submit', async (e: Event) => {
  e.preventDefault();
  const mensaje = $('mensaje-registro');
  mensaje.textContent = '';
  const cuerpo = {
    nombre: ($('reg-nombre') as HTMLInputElement).value,
    nick: ($('reg-nick') as HTMLInputElement).value,
    email: ($('reg-email') as HTMLInputElement).value,
    password: ($('reg-password') as HTMLInputElement).value,
    edad: Number(($('reg-edad') as HTMLInputElement).value)
  };
  try {
    const datos = await api<RespuestaAuth>('/api/auth/registro', {
      method: 'POST',
      body: JSON.stringify(cuerpo)
    });
    guardarSesion(datos);
    ($('form-registro') as HTMLFormElement).reset();
    irA('inicio', true);
  } catch (error) {
    mensaje.textContent = error instanceof Error ? error.message : 'Error al registrarse.';
  }
});

// ===== ARRANQUE =====
window.addEventListener('hashchange', enrutar);
cargarGeneros();
restaurarSesion();