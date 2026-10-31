import express from 'express';
import path from 'path';
import { ResultSetHeader } from 'mysql2';
import { pool } from './db.js';

const app = express();
const RAIZ = path.join(__dirname, '..', '..');

app.use(express.json());

app.use('/img', express.static(path.join(RAIZ, 'img')));
app.use('/dist', express.static(path.join(RAIZ, 'dist')));
app.get('/', (_req, res) => res.sendFile(path.join(RAIZ, 'index.html')));
app.get('/estilos.css', (_req, res) => res.sendFile(path.join(RAIZ, 'estilos.css')));

app.get('/api/salud', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Sin conexión a la base de datos' });
  }
});

app.get('/api/peliculas', async (req, res) => {
  try {
    const { q, genero, estado, filtro, usuario_id } = req.query;
    let sql = 'SELECT p.* FROM peliculas p WHERE 1=1';
    const params: (string | number)[] = [];

    if (typeof q === 'string' && q) { sql += ' AND p.titulo LIKE ?'; params.push(`%${q}%`); }
    if (typeof genero === 'string' && genero) { sql += ' AND p.genero = ?'; params.push(genero); }
    if (typeof estado === 'string' && estado) { sql += ' AND p.estado = ?'; params.push(estado); }
    if (filtro === 'recomendadas') sql += ' AND p.es_recomendada = 1';
    if (filtro === 'favoritos' && usuario_id) {
      sql += ' AND p.id IN (SELECT pelicula_id FROM likes WHERE usuario_id = ?)';
      params.push(Number(usuario_id));
    }
    if (filtro === 'espera' && usuario_id) {
      sql += ' AND p.id IN (SELECT pelicula_id FROM lista_espera WHERE usuario_id = ?)';
      params.push(Number(usuario_id));
    }
    sql += filtro === 'masvistas' ? ' ORDER BY p.vistas_contador DESC' : ' ORDER BY p.id DESC';

    const [filas] = await pool.execute(sql, params);
    res.json(filas);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar películas' });
  }
});

// GET /api/peliculas/generos (para llenar el desplegable)
app.get('/api/generos', async (_req, res) => {
  try {
    const [filas] = await pool.query('SELECT DISTINCT genero FROM peliculas ORDER BY genero');
    res.json(filas);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar géneros' });
  }
});

// GET /api/resenias?pelicula_id=4
app.get('/api/resenias', async (req, res) => {
  try {
    const peliculaId = Number(req.query.pelicula_id);
    if (!peliculaId) return res.status(400).json({ error: 'Falta pelicula_id' });
    const [filas] = await pool.execute(
      `SELECT r.id, r.puntuacion, r.comentario, r.fecha, u.nick
       FROM resenias r JOIN usuarios u ON u.id = r.usuario_id
       WHERE r.pelicula_id = ? ORDER BY r.fecha DESC`, [peliculaId]);
    res.json(filas);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar reseñas' });
  }
});

// POST /api/resenias { usuario_id, pelicula_id, puntuacion, comentario }
app.post('/api/resenias', async (req, res) => {
  try {
    const { usuario_id, pelicula_id, puntuacion, comentario } = req.body;
    const nota = Number(puntuacion);
    if (!usuario_id || !pelicula_id || !Number.isInteger(nota) || nota < 1 || nota > 10) {
      return res.status(400).json({ error: 'Datos inválidos (puntuación de 1 a 10)' });
    }
    const [r] = await pool.execute<ResultSetHeader>(
      'INSERT INTO resenias (usuario_id, pelicula_id, puntuacion, comentario) VALUES (?, ?, ?, ?)',
      [usuario_id, pelicula_id, nota, String(comentario ?? '')]);
    res.status(201).json({ id: r.insertId });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar la reseña' });
  }
});

// GET /api/confiteria
app.get('/api/confiteria', async (_req, res) => {
  try {
    const [filas] = await pool.query('SELECT * FROM confiteria');
    res.json(filas);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar confitería' });
  }
});

// GET /api/promociones
app.get('/api/promociones', async (_req, res) => {
  try {
    const [filas] = await pool.query('SELECT * FROM promociones ORDER BY fecha_fin');
    res.json(filas);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar promociones' });
  }
});

// GET /api/usuarios/:id/perfil (datos + actividad reciente)
app.get('/api/usuarios/:id/perfil', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [usuarios] = await pool.execute(
      `SELECT u.id, u.nick, u.nombre, u.email, u.foto_perfil, u.edad,
        (SELECT COUNT(*) FROM resenias WHERE usuario_id = u.id) AS vistas,
        (SELECT COUNT(*) FROM likes WHERE usuario_id = u.id) AS likes,
        (SELECT COUNT(*) FROM lista_espera WHERE usuario_id = u.id) AS espera,
        (SELECT COUNT(*) FROM resenias WHERE usuario_id = u.id AND comentario <> '') AS contribuido
       FROM usuarios u WHERE u.id = ?`, [id]);
    const lista = usuarios as any[];
    if (lista.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const [actividad] = await pool.execute(
      `SELECT p.titulo, r.puntuacion, r.comentario, r.fecha
       FROM resenias r JOIN peliculas p ON p.id = r.pelicula_id
       WHERE r.usuario_id = ? ORDER BY r.fecha DESC`, [id]);
    res.json({ usuario: lista[0], actividad });
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar el perfil' });
  }
});

// Inicio del servidor (fuera de las rutas)
const PUERTO = Number(process.env.PORT ?? 3000);
app.listen(PUERTO, () => {
  console.log(`Servidor corriendo en http://localhost:${PUERTO}`);
});