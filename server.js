'use strict';
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 4040;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'ari@mohammadi.at').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SmartRepair123!';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const q = (text, params=[]) => pool.query(text, params);
const clean = v => String(v ?? '').trim();
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

async function initDb(){
  await q(`CREATE TABLE IF NOT EXISTS users(
    id SERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'admin',created_at TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS suppliers(
    id SERIAL PRIMARY KEY,name TEXT UNIQUE NOT NULL,contact TEXT DEFAULT '',phone TEXT DEFAULT '',email TEXT DEFAULT '',website TEXT DEFAULT '',note TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS articles(
    id SERIAL PRIMARY KEY,name TEXT NOT NULL,sku TEXT UNIQUE,barcode TEXT,brand TEXT DEFAULT '',category TEXT DEFAULT '',location TEXT DEFAULT '',stock INTEGER NOT NULL DEFAULT 0,min_stock INTEGER NOT NULL DEFAULT 0,purchase_price NUMERIC(12,2) DEFAULT 0,sale_price NUMERIC(12,2) DEFAULT 0,supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,last_purchase_at DATE,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS movements(
    id SERIAL PRIMARY KEY,article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,type TEXT NOT NULL CHECK(type IN ('IN','OUT')),quantity INTEGER NOT NULL,price NUMERIC(12,2) DEFAULT 0,movement_date DATE NOT NULL DEFAULT CURRENT_DATE,customer TEXT DEFAULT '',note TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS orders(
    id SERIAL PRIMARY KEY,item_name TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 1,supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,order_for TEXT NOT NULL DEFAULT 'shop',customer_name TEXT DEFAULT '',phone TEXT DEFAULT '',priority TEXT NOT NULL DEFAULT 'medium',note TEXT DEFAULT '',done BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ DEFAULT NOW())`);
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await q(`INSERT INTO users(email,password_hash) VALUES($1,$2) ON CONFLICT(email) DO NOTHING`, [ADMIN_EMAIL, hash]);
  const defaults=['Faro','Fonedy','Smart Parts','TFK','GPC','Mobilepart','Amazon','eBay','IPC Computer'];
  for(const name of defaults) await q(`INSERT INTO suppliers(name) VALUES($1) ON CONFLICT(name) DO NOTHING`,[name]);
}

function tokenFrom(req){ return req.cookies.sr_token || (req.headers.authorization||'').replace(/^Bearer\s+/,''); }
function auth(req,res,next){
  try { req.user=jwt.verify(tokenFrom(req),JWT_SECRET); next(); }
  catch { res.status(401).json({error:'Nicht angemeldet'}); }
}

app.get('/api/health', async (_req,res)=>{ try{ await q('SELECT 1'); res.json({ok:true,version:'4.3'});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post('/api/login', async (req,res)=>{
  const email=clean(req.body.email).toLowerCase(), password=clean(req.body.password);
  const r=await q('SELECT * FROM users WHERE email=$1',[email]);
  if(!r.rows[0] || !(await bcrypt.compare(password,r.rows[0].password_hash))) return res.status(401).json({error:'E-Mail oder Passwort ist falsch.'});
  const token=jwt.sign({id:r.rows[0].id,email,role:r.rows[0].role},JWT_SECRET,{expiresIn:'7d'});
  res.cookie('sr_token',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:7*864e5});
  res.json({ok:true,email});
});
app.post('/api/logout',(_req,res)=>{res.clearCookie('sr_token');res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json(req.user));

app.get('/api/dashboard',auth,async(_req,res)=>{
  const [a,s,o,m]=await Promise.all([
    q(`SELECT COUNT(*)::int count,COALESCE(SUM(stock),0)::int units,COALESCE(SUM(stock*purchase_price),0)::numeric value,COUNT(*) FILTER(WHERE stock<=min_stock)::int low FROM articles`),
    q(`SELECT COUNT(*)::int count FROM suppliers`), q(`SELECT COUNT(*)::int count FROM orders WHERE done=false`),
    q(`SELECT m.*,a.name article_name FROM movements m JOIN articles a ON a.id=m.article_id ORDER BY m.id DESC LIMIT 10`)]);
  res.json({articles:a.rows[0],suppliers:s.rows[0].count,openOrders:o.rows[0].count,movements:m.rows});
});

app.get('/api/suppliers',auth,async(_req,res)=>res.json((await q('SELECT * FROM suppliers ORDER BY name')).rows));
app.post('/api/suppliers',auth,async(req,res)=>{
  const name=clean(req.body.name); if(!name)return res.status(400).json({error:'Firmenname fehlt.'});
  const r=await q(`INSERT INTO suppliers(name,contact,phone,email,website,note) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[name,clean(req.body.contact),clean(req.body.phone),clean(req.body.email),clean(req.body.website),clean(req.body.note)]).catch(e=>{if(e.code==='23505')return null;throw e});
  if(!r)return res.status(409).json({error:'Lieferant existiert bereits.'}); res.status(201).json(r.rows[0]);
});
app.delete('/api/suppliers/:id',auth,async(req,res)=>{await q('DELETE FROM suppliers WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.get('/api/articles',auth,async(req,res)=>{
  const terms=clean(req.query.q).toLowerCase().split(/\s+/).filter(Boolean);
  const params=[]; let where='';
  if(terms.length){const clauses=terms.map(t=>{params.push(`%${t}%`);const n=params.length;return `(LOWER(COALESCE(a.name,'')||' '||COALESCE(a.sku,'')||' '||COALESCE(a.barcode,'')||' '||COALESCE(a.brand,'')||' '||COALESCE(a.category,'')||' '||COALESCE(a.location,'')) LIKE $${n})`;});where='WHERE '+clauses.join(' AND ');}
  const r=await q(`SELECT a.*,s.name supplier_name FROM articles a LEFT JOIN suppliers s ON s.id=a.supplier_id ${where} ORDER BY a.name LIMIT 100`,params); res.json(r.rows);
});
app.post('/api/articles',auth,async(req,res)=>{
  const name=clean(req.body.name); if(!name)return res.status(400).json({error:'Artikelname fehlt.'});
  const sku=clean(req.body.sku)||null;
  try{const r=await q(`INSERT INTO articles(name,sku,barcode,brand,category,location,stock,min_stock,purchase_price,sale_price,supplier_id,last_purchase_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[name,sku,clean(req.body.barcode),clean(req.body.brand),clean(req.body.category),clean(req.body.location),Math.trunc(num(req.body.stock)),Math.trunc(num(req.body.min_stock)),num(req.body.purchase_price),num(req.body.sale_price),req.body.supplier_id||null,req.body.last_purchase_at||null]);res.status(201).json(r.rows[0]);}
  catch(e){if(e.code==='23505')return res.status(409).json({error:'SKU existiert bereits.'});throw e;}
});
app.put('/api/articles/:id',auth,async(req,res)=>{
  const r=await q(`UPDATE articles SET name=$1,sku=$2,barcode=$3,brand=$4,category=$5,location=$6,min_stock=$7,purchase_price=$8,sale_price=$9,supplier_id=$10,updated_at=NOW() WHERE id=$11 RETURNING *`,[clean(req.body.name),clean(req.body.sku)||null,clean(req.body.barcode),clean(req.body.brand),clean(req.body.category),clean(req.body.location),Math.trunc(num(req.body.min_stock)),num(req.body.purchase_price),num(req.body.sale_price),req.body.supplier_id||null,req.params.id]);res.json(r.rows[0]);
});
app.delete('/api/articles/:id',auth,async(req,res)=>{await q('DELETE FROM articles WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.post('/api/movements',auth,async(req,res)=>{
  const client=await pool.connect();
  try{await client.query('BEGIN'); const type=req.body.type==='OUT'?'OUT':'IN'; const qty=Math.trunc(num(req.body.quantity)); if(qty<=0)throw new Error('Menge muss größer als 0 sein.');
    const ar=(await client.query('SELECT * FROM articles WHERE id=$1 FOR UPDATE',[req.body.article_id])).rows[0]; if(!ar)throw new Error('Artikel nicht gefunden.');
    if(type==='OUT' && ar.stock<qty)throw new Error(`Nicht genug Bestand. Verfügbar: ${ar.stock}`);
    const newStock=type==='IN'?ar.stock+qty:ar.stock-qty; const price=num(req.body.price);
    await client.query(`UPDATE articles SET stock=$1,purchase_price=CASE WHEN $2='IN' AND $3>0 THEN $3 ELSE purchase_price END,last_purchase_at=CASE WHEN $2='IN' THEN $4 ELSE last_purchase_at END,updated_at=NOW() WHERE id=$5`,[newStock,type,price,req.body.movement_date||new Date().toISOString().slice(0,10),ar.id]);
    const m=(await client.query(`INSERT INTO movements(article_id,type,quantity,price,movement_date,customer,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[ar.id,type,qty,price,req.body.movement_date||new Date().toISOString().slice(0,10),clean(req.body.customer),clean(req.body.note)])).rows[0];
    await client.query('COMMIT');res.status(201).json({...m,stock:newStock});
  }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message});}finally{client.release();}
});
app.get('/api/movements',auth,async(_req,res)=>res.json((await q(`SELECT m.*,a.name article_name,a.sku FROM movements m JOIN articles a ON a.id=m.article_id ORDER BY m.id DESC LIMIT 300`)).rows));

app.get('/api/orders',auth,async(_req,res)=>res.json((await q(`SELECT o.*,s.name supplier_name FROM orders o LEFT JOIN suppliers s ON s.id=o.supplier_id ORDER BY o.done,o.id DESC`)).rows));
app.post('/api/orders',auth,async(req,res)=>{
  const name=clean(req.body.item_name);if(!name)return res.status(400).json({error:'Artikel fehlt.'});
  const r=await q(`INSERT INTO orders(item_name,quantity,supplier_id,order_for,customer_name,phone,priority,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[name,Math.max(1,Math.trunc(num(req.body.quantity))),req.body.supplier_id||null,req.body.order_for==='customer'?'customer':'shop',clean(req.body.customer_name),clean(req.body.phone),['high','medium','low'].includes(req.body.priority)?req.body.priority:'medium',clean(req.body.note)]);res.status(201).json(r.rows[0]);
});
app.patch('/api/orders/:id',auth,async(req,res)=>{const r=await q('UPDATE orders SET done=COALESCE($1,done) WHERE id=$2 RETURNING *',[typeof req.body.done==='boolean'?req.body.done:null,req.params.id]);res.json(r.rows[0]);});
app.delete('/api/orders/:id',auth,async(req,res)=>{await q('DELETE FROM orders WHERE id=$1',[req.params.id]);res.json({ok:true});});

app.get('*',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
initDb().then(()=>app.listen(PORT,()=>console.log(`SmartRepair Lager läuft auf Port ${PORT}`))).catch(e=>{console.error('Database init failed',e);process.exit(1);});
