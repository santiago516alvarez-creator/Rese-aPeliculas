import express from 'express';
import path from 'path';
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


const PUERTO = Number(process.env.PORT ?? 3000);
app.listen(PUERTO, () => console.log(`Servidor en http://localhost:${PUERTO}`));