import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { ResultSetHeader } from 'mysql2';
import { pool } from './db.js';

const app = express();
const RAIZ = path.join(__dirname, '..', '..');

app.use(express.json());

// ===== SESIONES EN MEMORIA: token -> id de usuario =====
const sesiones = new Map<string, number>();

function leerToken(req: Request): string {
  return (req.headers.authorization ?? '').replace('Bearer ', '');
}

// Para rutas que usan la sesión si existe, pero no la exigen
function usuarioDeSesion(req: Request): number {
  return sesiones.get(leerToken(req)) ?? 0;
}

// Middleware: exige sesión válida y deja el id en res.locals.usuarioId
function requiereSesion(req: Request, res: Response, next: NextFunction): void {
  const usuarioId = sesiones.get(leerToken(req));
  if (!usuarioId) {
    res.status(401).json({ error: 'Sesión no válida o expirada' });
    return;
  }
  res.locals.usuarioId = usuarioId;
  next();
}

// ===== ARCHIVOS ESTÁTICOS =====
app.use('/img', express.static(path.join(RAIZ, 'img')));
app.use('/dist', express.static(path.join(RAIZ, 'dist')));
app.get('/', (_req, res) => res.sendFile(path.join(RAIZ, 'index.html')));
app.get('/estilos.css', (_req, res) => res.sendFile(path.join(RAIZ, 'estilos.css')));

// ===== SALUD =====
app.get('/api/salud', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Sin conexión a la base de datos' });
  }
});

// ===== PELÍCULAS =====
app.get('/api/peliculas', async (req, res) => {
  try {
    const { q, genero, estado, filtro } = req.query;
    const usuarioId = usuarioDeSesion(req);
    let sql = 'SELECT p.* FROM peliculas p WHERE 1=1';
    const params: (string | number)[] = [];

    if (typeof q === 'string' && q) { sql += ' AND p.titulo LIKE ?'; params.push(`%${q}%`); }
    if (typeof genero === 'string' && genero) { sql += ' AND p.genero = ?'; params.push(genero); }
    if (typeof estado === 'string' && estado) { sql += ' AND p.estado = ?'; params.push(estado); }
    if (filtro === 'recomendadas') sql += ' AND p.es_recomendada = 1';
    if (filtro === 'favoritos' && usuarioId) {
      sql += ' AND p.id IN (SELECT pelicula_id FROM likes WHERE usuario_id = ?)';
      params.push(usuarioId);
    }
    if (filtro === 'espera' && usuarioId) {
      sql += ' AND p.id IN (SELECT pelicula_id FROM lista_espera WHERE usuario_id = ?)';
      params.push(usuarioId);
    }
    sql += filtro === 'masvistas' ? ' ORDER BY p.vistas_contador DESC' : ' ORDER BY p.id DESC';

    const [filas] = await pool.execute(sql, params);
    res.json(filas);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar películas' });
  }
});

app.get('/api/generos', async (_req, res) => {
  try {
    const [filas] = await pool.query('SELECT DISTINCT genero FROM peliculas ORDER BY genero');
    res.json(filas);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar géneros' });
  }
});

// Una sola película (la usa el detalle: #pelicula/ID)
app.get('/api/peliculas/:id', async (req, res) => {
  try {
    const [filas] = await pool.execute('SELECT * FROM peliculas WHERE id = ?', [Number(req.params.id)]);
    const peliculas = filas as any[];
    if (peliculas.length === 0) {
      res.status(404).json({ error: 'Película no encontrada' });
      return;
    }
    res.json(peliculas[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar la película' });
  }
});

// ===== RESEÑAS =====
app.get('/api/resenias', async (req, res) => {
  try {
    const peliculaId = Number(req.query.pelicula_id);
    if (!peliculaId) {
      res.status(400).json({ error: 'Falta pelicula_id' });
      return;
    }
    const [filas] = await pool.execute(
      `SELECT r.id, r.puntuacion, r.comentario, r.fecha, u.nick
       FROM resenias r JOIN usuarios u ON u.id = r.usuario_id
       WHERE r.pelicula_id = ? ORDER BY r.fecha DESC`, [peliculaId]);
    res.json(filas);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar reseñas' });
  }
});

app.post('/api/resenias', requiereSesion, async (req, res) => {
  try {
    const { pelicula_id, puntuacion, comentario } = req.body;
    const usuario_id = res.locals.usuarioId;
    const nota = Number(puntuacion);
    if (!pelicula_id || !Number.isInteger(nota) || nota < 1 || nota > 10) {
      res.status(400).json({ error: 'Datos inválidos (puntuación de 1 a 10)' });
      return;
    }
    const [r] = await pool.execute<ResultSetHeader>(
      'INSERT INTO resenias (usuario_id, pelicula_id, puntuacion, comentario) VALUES (?, ?, ?, ?)',
      [usuario_id, pelicula_id, nota, String(comentario ?? '')]);
    res.status(201).json({ id: r.insertId });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar la reseña' });
  }
});

// ===== CONFITERÍA Y PROMOCIONES =====
app.get('/api/confiteria', async (_req, res) => {
  try {
    const [filas] = await pool.query('SELECT * FROM confiteria');
    res.json(filas);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar confitería' });
  }
});

app.get('/api/promociones', async (_req, res) => {
  try {
    const [filas] = await pool.query('SELECT * FROM promociones ORDER BY fecha_fin');
    res.json(filas);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar promociones' });
  }
});

// ===== PERFIL =====
app.get('/api/usuarios/:id/perfil', requiereSesion, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id !== res.locals.usuarioId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }
    const [usuarios] = await pool.execute(
      `SELECT u.id, u.nick, u.nombre, u.email, u.foto_perfil, u.edad,
        (SELECT COUNT(*) FROM resenias WHERE usuario_id = u.id) AS vistas,
        (SELECT COUNT(*) FROM likes WHERE usuario_id = u.id) AS likes,
        (SELECT COUNT(*) FROM lista_espera WHERE usuario_id = u.id) AS espera,
        (SELECT COUNT(*) FROM resenias WHERE usuario_id = u.id AND comentario <> '') AS contribuido
       FROM usuarios u WHERE u.id = ?`, [id]);
    const lista = usuarios as any[];
    if (lista.length === 0) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }
    res.json({ usuario: lista[0] });
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar el perfil' });
  }
});

// Cambia el nombre y/o el avatar del propio usuario
app.put('/api/usuarios/:id', requiereSesion, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id !== res.locals.usuarioId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }
    const { nombre, foto_perfil } = req.body;

    if (nombre !== undefined && (typeof nombre !== 'string' || nombre.trim() === '' || nombre.length > 30)) {
      res.status(400).json({ error: 'Nombre inválido' });
      return;
    }
    if (foto_perfil !== undefined && !/^img\/avatares\/.*\.(jpg|jpeg|png)$/i.test(foto_perfil)) {
      res.status(400).json({ error: 'Avatar inválido' });
      return;
    }

    await pool.execute(
      'UPDATE usuarios SET nombre = COALESCE(?, nombre), foto_perfil = COALESCE(?, foto_perfil) WHERE id = ?',
      [nombre?.trim() ?? null, foto_perfil ?? null, id]
    );

    const [filas] = await pool.execute(
      'SELECT id, nick, nombre, email, foto_perfil, edad FROM usuarios WHERE id = ?',
      [id]
    );
    const usuarios = filas as any[];
    res.json(usuarios[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el perfil' });
  }
});

// Pestañas del perfil: reseñas, favoritos y lista de espera
app.get('/api/usuarios/:id/pestana/:tab', requiereSesion, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id !== res.locals.usuarioId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }
    const consultas: Record<string, string> = {
      resenias: `SELECT p.id AS pelicula_id, p.titulo, r.puntuacion, r.comentario, r.fecha
                 FROM resenias r JOIN peliculas p ON p.id = r.pelicula_id
                 WHERE r.usuario_id = ? ORDER BY r.fecha DESC`,
      favoritos: `SELECT p.id AS pelicula_id, p.titulo, p.genero, p.anio
                  FROM likes l JOIN peliculas p ON p.id = l.pelicula_id
                  WHERE l.usuario_id = ? ORDER BY l.id DESC`,
      espera: `SELECT p.id AS pelicula_id, p.titulo, p.genero, p.anio
               FROM lista_espera le JOIN peliculas p ON p.id = le.pelicula_id
               WHERE le.usuario_id = ? ORDER BY le.id DESC`
    };
    const tab = String(req.params.tab);
    const sql = consultas[tab];
    if (!sql) {
      res.status(400).json({ error: 'Pestaña desconocida' });
      return;
    }
    const [filas] = await pool.execute(sql, [id]);
    res.json(filas);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar la pestaña' });
  }
});

// ===== AUTENTICACIÓN =====
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      res.status(400).json({ error: 'Completa correo y contraseña' });
      return;
    }
    const [filas] = await pool.execute(
      'SELECT id, nick, nombre, email, foto_perfil, edad FROM usuarios WHERE email = ? AND password = ?',
      [email, password]
    );
    const usuarios = filas as any[];
    if (usuarios.length === 0) {
      res.status(401).json({ error: 'Correo o contraseña incorrectos' });
      return;
    }
    const token = randomUUID();
    sesiones.set(token, usuarios[0].id);
    res.json({ usuario: usuarios[0], token });
  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

app.post('/api/auth/registro', async (req, res) => {
  try {
    const { nick, nombre, email, password, edad } = req.body;
    if ([nick, nombre, email, password].some(v => typeof v !== 'string' || !v.trim())) {
      res.status(400).json({ error: 'Completa todos los campos obligatorios' });
      return;
    }
    const [r] = await pool.execute<ResultSetHeader>(
      'INSERT INTO usuarios (nick, nombre, email, password, edad, foto_perfil) VALUES (?, ?, ?, ?, ?, ?)',
      [nick.trim(), nombre.trim(), email.trim(), password, Number(edad) || 20, 'img/avatares/Avatar1.jpeg']
    );
    const [filas] = await pool.execute(
      'SELECT id, nick, nombre, email, foto_perfil, edad FROM usuarios WHERE id = ?', [r.insertId]
    );
    const usuario = (filas as any[])[0];
    const token = randomUUID();
    sesiones.set(token, usuario.id);
    res.status(201).json({ usuario, token });
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'El correo o el nick ya están registrados' });
    } else {
      res.status(500).json({ error: 'Error en el servidor' });
    }
  }
});

app.get('/api/auth/sesion', requiereSesion, async (_req, res) => {
  try {
    const [filas] = await pool.execute(
      'SELECT id, nick, nombre, email, foto_perfil, edad FROM usuarios WHERE id = ?', [res.locals.usuarioId]
    );
    const usuarios = filas as any[];
    if (usuarios.length === 0) {
      res.status(401).json({ error: 'Sesión no válida' });
      return;
    }
    res.json(usuarios[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  sesiones.delete(leerToken(req));
  res.json({ ok: true });
});

// ===== LIKES Y LISTA DE ESPERA =====
app.get('/api/usuario/estado-pelicula', requiereSesion, async (req, res) => {
  try {
    const usuarioId = res.locals.usuarioId;
    const peliculaId = Number(req.query.pelicula_id);
    const [likeRes] = await pool.execute('SELECT id FROM likes WHERE usuario_id = ? AND pelicula_id = ?', [usuarioId, peliculaId]);
    const [esperaRes] = await pool.execute('SELECT id FROM lista_espera WHERE usuario_id = ? AND pelicula_id = ?', [usuarioId, peliculaId]);
    res.json({ like: (likeRes as any[]).length > 0, espera: (esperaRes as any[]).length > 0 });
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar el estado' });
  }
});

app.post('/api/usuario/accion', requiereSesion, async (req, res) => {
  try {
    const { pelicula_id, tipo, accion } = req.body;
    if ((tipo !== 'like' && tipo !== 'espera') || (accion !== 'add' && accion !== 'remove') || !pelicula_id) {
      res.status(400).json({ error: 'Datos inválidos' });
      return;
    }
    const tabla = tipo === 'like' ? 'likes' : 'lista_espera';
    const usuarioId = res.locals.usuarioId;
    if (accion === 'add') {
      await pool.execute(`INSERT IGNORE INTO ${tabla} (usuario_id, pelicula_id) VALUES (?, ?)`, [usuarioId, pelicula_id]);
    } else {
      await pool.execute(`DELETE FROM ${tabla} WHERE usuario_id = ? AND pelicula_id = ?`, [usuarioId, pelicula_id]);
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar la acción' });
  }
});

// ===== ARRANQUE =====
const PUERTO = Number(process.env.PORT ?? 3000);
app.listen(PUERTO, () => {
  console.log(`Servidor corriendo en http://localhost:${PUERTO}`);
});