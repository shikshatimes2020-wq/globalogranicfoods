const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

const https = require('https');
const http = require('http');
const SELF_URL = process.env.RENDER_EXTERNAL_URL || '';
if (SELF_URL) {
  setInterval(() => {
    const lib = SELF_URL.startsWith('https') ? https : http;
    lib.get(SELF_URL + '/api/health', (res) => {
      console.log(`[Keep-Alive] ping → ${res.statusCode}`);
    }).on('error', (e) => console.error('[Keep-Alive] error:', e.message));
  }, 14 * 60 * 1000);
}

const MONGO_URI = process.env.MONGO_URI;
const mongoOptions = {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  minPoolSize: 2,
  heartbeatFrequencyMS: 10000,
};
function connectDB() {
  mongoose.connect(MONGO_URI, mongoOptions).catch(err => {
    console.error('MongoDB initial connect error:', err.message);
    setTimeout(connectDB, 5000);
  });
}
mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected — retrying in 5s');
  setTimeout(connectDB, 5000);
});
mongoose.connection.on('connected', () => console.log('✅ MongoDB connected'));
connectDB();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const storage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'globalorganicfoods', allowed_formats: ['jpg','jpeg','png','webp'] },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── Video upload storage (Cloudinary, resource_type: video) ──────────────────
const videoStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'globalorganicfoods/videos',
    resource_type: 'video',
    allowed_formats: ['mp4','mov','avi','mkv','webm','ogg','m4v','3gp'],
    chunk_size: 6000000,   // 6 MB chunks — required for large uploads (>100 MB)
    eager_async: true,     // don't block response on transcoding
  }),
});
const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 200 * 1024 * 1024 },   // 200 MB max
  fileFilter: (req, file, cb) => {
    const ok = /\.(mp4|mov|avi|mkv|webm|ogg|m4v|3gp)$/i.test(file.originalname)
               || /^video\//.test(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('শুধু MP4, MOV, AVI, MKV, WebM ফরম্যাট সাপোর্ট করে'), false);
  },
});

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000','http://localhost:5500','http://127.0.0.1:5500'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.log('Blocked origin:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Increase timeout for large video uploads
app.use((req, res, next) => {
  if (req.path === '/api/admin/upload-video') {
    req.setTimeout(5 * 60 * 1000);   // 5 min timeout for video uploads
    res.setTimeout(5 * 60 * 1000);
  }
  next();
});

const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const Admin = mongoose.model('Admin', AdminSchema);

const ProductSchema = new mongoose.Schema({
  id:          { type: String, required: true, unique: true },
  name:        { type: String, required: true },
  badge:       String,
  badgeClass:  String,
  subtitle:    String,
  img:         String,
  imgs:        [String],
  basePrice:   Number,
  baseOld:     Number,
  baseDiscount:Number,
  prices: {
    '2kg':   { price: Number, old: Number, dis: Number },
    '1kg':   { price: Number, old: Number, dis: Number },
    '500gm': { price: Number, old: Number, dis: Number },
  },
  desc:        String,
  benefits:    [String],
  ingredients: [String],
  usage:       [String],
  video:       { type: String, default: '' },   // YouTube/Vimeo URL or Cloudinary video URL
  videoUrl:    { type: String, default: '' },   // alias used by admin panel
  videoType:   { type: String, enum: ['youtube','vimeo','cloudinary','direct',''], default: '' },
  isActive:    { type: Boolean, default: true },
  order:       { type: Number, default: 0 },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now },
});
const Product = mongoose.model('Product', ProductSchema);

const OrderSchema = new mongoose.Schema({
  orderNumber:  { type: String, unique: true },
  productId:    String,
  productName:  String,
  weight:       String,
  quantity:     Number,
  unitPrice:    Number,
  deliveryCharge: Number,
  totalPrice:   Number,
  customerName: String,
  phone:        String,
  address:      String,
  deliveryArea: String,
  status:       { type: String, enum: ['pending','confirmed','processing','shipped','delivered','cancelled'], default: 'pending' },
  notes:        String,
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now },
});
const Order = mongoose.model('Order', OrderSchema);

const SiteSettingsSchema = new mongoose.Schema({
  key:   { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed,
  updatedAt: { type: Date, default: Date.now },
});
const SiteSettings = mongoose.model('SiteSettings', SiteSettingsSchema);

// ── NEW: Pack Sizes Schema ──────────────────────────────────────────────────
const PackSizeSchema = new mongoose.Schema({
  size:        { type: String, required: true, unique: true },
  label:       { type: String, required: true },
  order:       { type: Number, default: 0 },
  isActive:    { type: Boolean, default: true },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now },
});
const PackSize = mongoose.model('PackSize', PackSizeSchema);

// ── NEW: Site Pages Schema (About, Contact, etc.) ──────────────────────────
const SitePageSchema = new mongoose.Schema({
  slug:        { type: String, required: true, unique: true },  // 'about', 'contact', etc.
  title:       { type: String, required: true },
  content:     { type: String, required: true },                // HTML content
  seoTitle:    String,
  seoDesc:     String,
  isActive:    { type: Boolean, default: true },
  updatedAt:   { type: Date, default: Date.now },
});
const SitePage = mongoose.model('SitePage', SitePageSchema);

const JWT_SECRET = process.env.JWT_SECRET || 'globalorganic_secret_2026';
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  try {
    req.admin = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

async function generateOrderNumber() {
  const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const ts = Date.now().toString().slice(-4);
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3,'0');
  const base = `GOF-${today}-${ts}${rand}`;
  const exists = await Order.findOne({ orderNumber: base });
  if (exists) {
    return generateOrderNumber(); // retry
  }
  return base;
}

// ── SEED DEFAULT PACK SIZES ──────────────────────────────────────────────────
async function seedDefaults() {
  try {
    // Seed default pack sizes if not exist
    const count = await PackSize.countDocuments();
    if (count === 0) {
      const defaultSizes = [
        { size: '2kg', label: '২ কেজি', order: 0, isActive: true },
        { size: '1kg', label: '১ কেজি', order: 1, isActive: true },
        { size: '500gm', label: '৫০০ গ্রাম', order: 2, isActive: true },
      ];
      await PackSize.insertMany(defaultSizes);
      console.log('✅ Default pack sizes seeded');
    }

    // Seed default pages if not exist
    const pageCount = await SitePage.countDocuments();
    if (pageCount === 0) {
      const defaultPages = [
        {
          slug: 'about',
          title: 'আমাদের সম্পর্কে',
          content: '<p>আমরা বিশ্বমানের জৈব পণ্য সরবরাহ করি।</p>',
          seoTitle: 'গ্লোবাল অর্গানিক ফুডস - আমাদের সম্পর্কে',
          seoDesc: 'আমাদের সম্পর্কে জানুন এবং আমাদের মিশন ও ভিশন দেখুন।',
          isActive: true,
        },
        {
          slug: 'contact',
          title: 'যোগাযোগ করুন',
          content: '<p>আমাদের সাথে যোগাযোগ করুন যেকোনো প্রশ্ন বা পরামর্শের জন্য।</p><p>ইমেইল: info@globalorganicfoods.com</p><p>ফোন: +880 1234-567890</p>',
          seoTitle: 'যোগাযোগ করুন - গ্লোবাল অর্গানিক ফুডস',
          seoDesc: 'আমাদের সাথে যোগাযোগ করুন এবং আপনার প্রশ্নের উত্তর পান।',
          isActive: true,
        },
      ];
      await SitePage.insertMany(defaultPages);
      console.log('✅ Default site pages seeded');
    }
  } catch (err) {
    console.error('Seed error:', err.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION ENDPOINTS
// ────────────────────────────────────────────────────────────────────────────

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });
    let admin = await Admin.findOne({ username });
    if (!admin) {
      const hashed = await bcrypt.hash(password, 10);
      admin = await Admin.create({ username, password: hashed });
      console.log(`✅ Default admin created: ${username}`);
    }
    const matches = await bcrypt.compare(password, admin.password);
    if (!matches) return res.status(401).json({ success: false, message: 'ভুল পাসওয়ার্ড' });
    const token = jwt.sign({ id: admin._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, admin: { id: admin._id, username: admin.username } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// PRODUCTS ENDPOINTS
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find({ isActive: true }).sort({ order: 1 });
    res.json({ success: true, products });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/admin/products', authMiddleware, async (req, res) => {
  try {
    const products = await Product.find().sort({ order: 1 });
    res.json({ success: true, products });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findOne({ id: req.params.id, isActive: true });
    if (!product) return res.status(404).json({ success: false, message: 'পণ্য পাওয়া যায়নি' });
    res.json({ success: true, product });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/admin/products', authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    if (!data.id || !data.name) return res.status(400).json({ success: false, message: 'id and name required' });
    const exists = await Product.findOne({ id: data.id });
    if (exists) return res.status(400).json({ success: false, message: 'Product ID already exists' });
    const product = await Product.create(data);
    res.json({ success: true, product });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/admin/products/:id', authMiddleware, async (req, res) => {
  try {
    const updateData = { ...req.body, updatedAt: new Date() };
    delete updateData._id;
    const product = await Product.findOneAndUpdate(
      { id: req.params.id },
      { $set: updateData },
      { new: true, runValidators: false }
    );
    if (!product) return res.status(404).json({ success: false, message: 'পণ্য পাওয়া যায়নি' });
    res.json({ success: true, product });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/admin/products/:id', authMiddleware, async (req, res) => {
  try {
    await Product.findOneAndDelete({ id: req.params.id });
    res.json({ success: true, message: 'Deleted' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/admin/upload', authMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    const urls = req.files.map(f => f.path);
    res.json({ success: true, urls });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/admin/upload-video', authMiddleware, (req, res, next) => {
  uploadVideo.any()(req, res, (err) => {
    if (err) {
      console.error('[upload-video] multer error:', err.message);
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const file = req.files && req.files[0];
    if (!file) {
      return res.status(400).json({ success: false, message: 'কোনো ভিডিও ফাইল পাওয়া যায়নি। ফিল্ড নাম "video" বা "file" হতে হবে।' });
    }
    const url = file.path;
    const publicId = file.filename;
    console.log('[upload-video] success:', publicId, url.slice(0, 60));
    res.json({ success: true, url, urls: [url], publicId });
  } catch (e) {
    console.error('[upload-video] error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/admin/image', authMiddleware, async (req, res) => {
  try {
    const { publicId } = req.body;
    await cloudinary.uploader.destroy(publicId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// PACK SIZES ENDPOINTS (NEW)
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/pack-sizes', async (req, res) => {
  try {
    const sizes = await PackSize.find({ isActive: true }).sort({ order: 1 });
    res.json({ success: true, sizes });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/admin/pack-sizes', authMiddleware, async (req, res) => {
  try {
    const sizes = await PackSize.find().sort({ order: 1 });
    res.json({ success: true, sizes });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/admin/pack-sizes', authMiddleware, async (req, res) => {
  try {
    const { size, label, order, isActive } = req.body;
    if (!size || !label) return res.status(400).json({ success: false, message: 'size এবং label আবশ্যক' });
    const exists = await PackSize.findOne({ size });
    if (exists) return res.status(400).json({ success: false, message: 'এই সাইজ ইতিমধ্যে বিদ্যমান' });
    const packSize = await PackSize.create({ size, label, order: order || 0, isActive: isActive !== false });
    res.json({ success: true, packSize });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/admin/pack-sizes/:id', authMiddleware, async (req, res) => {
  try {
    const { label, order, isActive } = req.body;
    const packSize = await PackSize.findByIdAndUpdate(
      req.params.id,
      { label, order, isActive, updatedAt: new Date() },
      { new: true }
    );
    if (!packSize) return res.status(404).json({ success: false, message: 'প্যাক সাইজ পাওয়া যায়নি' });
    res.json({ success: true, packSize });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/admin/pack-sizes/:id', authMiddleware, async (req, res) => {
  try {
    await PackSize.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// SITE PAGES ENDPOINTS (NEW) - About, Contact, etc.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/pages/:slug', async (req, res) => {
  try {
    const page = await SitePage.findOne({ slug: req.params.slug, isActive: true });
    if (!page) return res.status(404).json({ success: false, message: 'পৃষ্ঠা পাওয়া যায়নি' });
    res.json({ success: true, page });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/admin/pages', authMiddleware, async (req, res) => {
  try {
    const pages = await SitePage.find().sort({ slug: 1 });
    res.json({ success: true, pages });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/admin/pages', authMiddleware, async (req, res) => {
  try {
    const { slug, title, content, seoTitle, seoDesc, isActive } = req.body;
    if (!slug || !title || !content) return res.status(400).json({ success: false, message: 'slug, title এবং content আবশ্যক' });
    const exists = await SitePage.findOne({ slug });
    if (exists) return res.status(400).json({ success: false, message: 'এই slug ইতিমধ্যে বিদ্যমান' });
    const page = await SitePage.create({ slug, title, content, seoTitle, seoDesc, isActive: isActive !== false });
    res.json({ success: true, page });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/admin/pages/:id', authMiddleware, async (req, res) => {
  try {
    const { title, content, seoTitle, seoDesc, isActive } = req.body;
    const page = await SitePage.findByIdAndUpdate(
      req.params.id,
      { title, content, seoTitle, seoDesc, isActive, updatedAt: new Date() },
      { new: true }
    );
    if (!page) return res.status(404).json({ success: false, message: 'পৃষ্ঠা পাওয়া যায়নি' });
    res.json({ success: true, page });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/admin/pages/:id', authMiddleware, async (req, res) => {
  try {
    await SitePage.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// ORDERS ENDPOINTS
// ────────────────────────────────────────────────────────────────────────────

app.post('/api/orders', async (req, res) => {
  try {
    const { productId, productName, weight, quantity, unitPrice, deliveryCharge, totalPrice, customerName, phone, address, deliveryArea, notes } = req.body;
    if (!customerName || !phone || !address) return res.status(400).json({ success: false, message: 'নাম, ফোন ও ঠিকানা আবশ্যক' });

    let order, orderNumber, attempts = 0;
    while (attempts < 5) {
      try {
        orderNumber = await generateOrderNumber();
        order = await Order.create({ orderNumber, productId, productName, weight, quantity, unitPrice, deliveryCharge, totalPrice, customerName, phone, address, deliveryArea, notes });
        break;
      } catch (dupErr) {
        if (dupErr.code === 11000 && dupErr.keyPattern?.orderNumber) {
          attempts++;
          await new Promise(r => setTimeout(r, 50 * attempts));
          continue;
        }
        throw dupErr;
      }
    }
    if (!order) throw new Error('অর্ডার নম্বর তৈরি করা যায়নি, পুনরায় চেষ্টা করুন');
    res.json({ success: true, order, orderNumber });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/admin/orders', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search) query.$or = [
      { customerName: new RegExp(search, 'i') },
      { phone: new RegExp(search, 'i') },
      { orderNumber: new RegExp(search, 'i') },
    ];
    const total = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    res.json({ success: true, orders, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/admin/orders/:id', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { new: true });
    res.json({ success: true, order });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/admin/orders/:id', authMiddleware, async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// STATS & SETTINGS ENDPOINTS
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/admin/stats', authMiddleware, async (req, res) => {
  try {
    const [totalOrders, pendingOrders, deliveredOrders, cancelledOrders, productCount] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: 'pending' }),
      Order.countDocuments({ status: 'delivered' }),
      Order.countDocuments({ status: 'cancelled' }),
      Product.countDocuments({ isActive: true }),
    ]);

    const revenueResult = await Order.aggregate([
      { $match: { status: { $in: ['delivered','confirmed','processing','shipped'] } } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } }
    ]);
    const totalRevenue = revenueResult[0]?.total || 0;

    const last7Days = new Date(); last7Days.setDate(last7Days.getDate() - 7);
    const recentOrders = await Order.find({ createdAt: { $gte: last7Days } }).sort({ createdAt: -1 }).limit(10);

    const dailySales = await Order.aggregate([
      { $match: { createdAt: { $gte: last7Days } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 }, revenue: { $sum: '$totalPrice' } } },
      { $sort: { _id: 1 } }
    ]);

    const topProducts = await Order.aggregate([
      { $group: { _id: '$productName', count: { $sum: '$quantity' }, revenue: { $sum: '$totalPrice' } } },
      { $sort: { count: -1 } }, { $limit: 5 }
    ]);

    res.json({ success: true, stats: { totalOrders, pendingOrders, deliveredOrders, cancelledOrders, productCount, totalRevenue, recentOrders, dailySales, topProducts } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await SiteSettings.find();
    const obj = {};
    settings.forEach(s => obj[s.key] = s.value);
    res.json({ success: true, settings: obj });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/admin/settings', authMiddleware, async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await SiteSettings.findOneAndUpdate({ key }, { value, updatedAt: new Date() }, { upsert: true });
    }
    res.json({ success: true, message: 'Settings updated' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  try { await seedDefaults(); } catch (e) { console.error('Seed error:', e.message); }
});