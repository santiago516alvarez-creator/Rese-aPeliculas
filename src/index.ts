interface Pelicula {
  id: number; titulo: string; genero: string; anio: number; sinopsis: string;
  imagen_url: string; estado: 'estreno' | 'cartelera' | 'finalizado';
}
interface Producto { id: number; nombre_producto: string; descripcion: string; precio: string; imagen_url: string; }
interface Promocion { id: number; titulo: string; descripcion: string; imagen_url: string; fecha_fin: string; }
interface Resenia { id: number; puntuacion: number; comentario: string; fecha: string; nick: string; }
interface Usuario { id: number; nick: string; nombre: string; email: string; foto_perfil: string; edad: number;
  vistas: number; likes: number; espera: number; contribuido: number; }
interface Actividad { titulo: string; puntuacion: number; comentario: string; fecha: string; }

const USUARIO_ID = 1;
let peliculaActual = 0;
let filtroActual = '';

function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

async function obtener<T>(url: string): Promise<T> {
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`Error ${respuesta.status}`);
  return respuesta.json() as Promise<T>;
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
}

function renderizarProductos(contenedorId: string, peliculas: Pelicula[]): void {
  const contenedor = $(contenedorId);
  contenedor.innerHTML = '';
  if (peliculas.length === 0) { contenedor.textContent = 'Sin resultados.'; return; }
  peliculas.forEach(p =>
    contenedor.appendChild(crearTarjeta(p.imagen_url, p.titulo, `${p.genero} · ${p.anio}`, () => abrirDetalle(p)))
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

async function cargarInicio(): Promise<void> {
  try {
    renderizarProductos('grilla-estrenos', await obtener<Pelicula[]>('/api/peliculas?estado=estreno'));
    renderizarProductos('grilla-finalizando', await obtener<Pelicula[]>('/api/peliculas?estado=finalizado'));
    renderizarPromos(await obtener<Promocion[]>('/api/promociones'));
    renderizarConfiteria(await obtener<Producto[]>('/api/confiteria'));
  } catch (error) {
    console.error(error);
  }
}

async function cargarCatalogo(): Promise<void> {
  const genero = ($('select-genero') as HTMLSelectElement).value;
  const q = ($('buscador') as HTMLInputElement).value.trim();
  const params = new URLSearchParams({ usuario_id: String(USUARIO_ID) });
  if (filtroActual) params.set('filtro', filtroActual);
  if (genero) params.set('genero', genero);
  if (q) params.set('q', q);
  try {
    renderizarProductos('grilla-catalogo', await obtener<Pelicula[]>(`/api/peliculas?${params}`));
  } catch (error) {
    console.error(error);
  }
}

async function cargarGeneros(): Promise<void> {
  const select = $('select-genero') as HTMLSelectElement;
  const generos = await obtener<{ genero: string }[]>('/api/generos');
  generos.forEach(g => select.add(new Option(g.genero, g.genero)));
}

async function abrirDetalle(p: Pelicula): Promise<void> {
  peliculaActual = p.id;
  $('detalle-titulo').textContent = `${p.titulo} (${p.anio})`;
  $('detalle-sinopsis').textContent = p.sinopsis;
  mostrarVista('detalle');
  await cargarResenias();
}

async function cargarResenias(): Promise<void> {
  const lista = $('lista-resenias');
  lista.innerHTML = '';
  const resenias = await obtener<Resenia[]>(`/api/resenias?pelicula_id=${peliculaActual}`);
  if (resenias.length === 0) { lista.textContent = 'Aún no hay reseñas.'; return; }
  resenias.forEach(r => {
    const li = document.createElement('li');
    li.textContent = `${r.nick} — ${r.puntuacion}/10: ${r.comentario}`;
    lista.appendChild(li);
  });
}

async function cargarPerfil(): Promise<void> {
  const datos = await obtener<{ usuario: Usuario; actividad: Actividad[] }>(`/api/usuarios/${USUARIO_ID}/perfil`);
  const u = datos.usuario;
  ($('perfil-foto') as HTMLImageElement).src = u.foto_perfil;
  $('perfil-nombre').textContent = u.nombre;
  $('perfil-nick').textContent = `@${u.nick}`;
  $('perfil-email').textContent = u.email;
  $('perfil-edad').textContent = `${u.edad} años`;

  const contadores = $('perfil-contadores');
  contadores.innerHTML = '';
  const items: [string, number][] = [['Películas vistas', u.vistas], ['Likes', u.likes],
    ['Lista de espera', u.espera], ['Contribuido', u.contribuido]];
  items.forEach(([etiqueta, valor]) => {
    const div = document.createElement('div');
    div.textContent = `${etiqueta}: ${valor}`;
    contadores.appendChild(div);
  });

  const cuerpo = $('perfil-actividad');
  cuerpo.innerHTML = '';
  datos.actividad.forEach(a => {
    const fila = document.createElement('tr');
    [a.titulo, String(a.puntuacion), a.comentario, new Date(a.fecha).toLocaleDateString()].forEach(texto => {
      const celda = document.createElement('td');
      celda.textContent = texto;
      fila.appendChild(celda);
    });
    cuerpo.appendChild(fila);
  });
}

document.querySelectorAll<HTMLButtonElement>('.menu button').forEach(boton => {
  boton.addEventListener('click', () => {
    const vista = boton.dataset.vista ?? 'inicio';
    mostrarVista(vista);
    if (vista === 'catalogo') cargarCatalogo();
    if (vista === 'perfil') cargarPerfil();
    if (vista === 'inicio') cargarInicio();
  });
});

document.querySelectorAll<HTMLButtonElement>('.filtros button').forEach(boton => {
  boton.addEventListener('click', () => { filtroActual = boton.dataset.filtro ?? ''; cargarCatalogo(); });
});

$('select-genero').addEventListener('change', cargarCatalogo);
$('btn-volver').addEventListener('click', () => mostrarVista('catalogo'));

$('form-busqueda').addEventListener('submit', (e: Event) => {
  e.preventDefault();
  mostrarVista('catalogo');
  cargarCatalogo();
});

$('form-resenia').addEventListener('submit', async (e: Event) => {
  e.preventDefault();
  const mensaje = $('mensaje-resenia');
  const puntuacion = Number(($('resenia-puntos') as HTMLInputElement).value);
  const comentario = ($('resenia-comentario') as HTMLTextAreaElement).value;
  try {
    const respuesta = await fetch('/api/resenias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: USUARIO_ID, pelicula_id: peliculaActual, puntuacion, comentario })
    });
    if (!respuesta.ok) throw new Error('No se pudo guardar');
    mensaje.textContent = '¡Reseña guardada!';
    ($('form-resenia') as HTMLFormElement).reset();
    await cargarResenias();
  } catch (error) {
    mensaje.textContent = 'Error al guardar la reseña.';
  }
});

cargarInicio();
cargarGeneros();