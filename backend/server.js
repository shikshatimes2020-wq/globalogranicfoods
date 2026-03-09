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

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500', '*'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
  const count = await Order.countDocuments();
  return `GOF-${today}-${String(count + 1).padStart(4,'0')}`;
}

async function seedDefaults() {
  const adminExists = await Admin.findOne({ username: 'admin' });
  if (!adminExists) {
    const hashed = await bcrypt.hash('admin123', 10);
    await Admin.create({ username: 'admin', password: hashed });
    console.log('✅ Default admin created  →  admin / admin123');
  }

  const productCount = await Product.countDocuments();
  if (productCount === 0) {
    const defaultProducts = [
      { id:'gastro', name:'গ্যাস্ট্রো কেয়ার', badge:'HOT', badgeClass:'badge-hot', subtitle:'পেটের যত্নে প্রাকৃতিক ভেষজ পাউডার', img:'https://images.unsplash.com/photo-1556740749-887f6717d7e4?w=600&q=80', imgs:['https://images.unsplash.com/photo-1556740749-887f6717d7e4?w=800','https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=800','https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800','https://images.unsplash.com/photo-1490474418585-ba9bad8fd0ea?w=800'], basePrice:1050, baseOld:1300, baseDiscount:19, prices:{'2kg':{price:1050,old:1300,dis:19},'1kg':{price:550,old:650,dis:15},'500gm':{price:300,old:340,dis:12}}, desc:'গ্যাস্ট্রো কেয়ার একটি সম্পূর্ণ প্রাকৃতিক ও ভেষজ পাউডার যা পেটের বিভিন্ন সমস্যা সমাধানে বিশেষভাবে তৈরি।', benefits:['গ্যাস্ট্রিক ও অ্যাসিডিটি দূর করে','হজম শক্তি বৃদ্ধি করে','পেট ফাঁপা ও বদহজম কমায়'], ingredients:['অর্জুন ছাল — 20%','আমলকী — 15%','হরিতকী — 15%'], usage:['সকালে খালি পেটে ১ চামচ','রাতে খাওয়ার পর ১ চামচ'], order:1 },
      { id:'beetroot', name:'বিটরুট পাউডার', badge:'BEST', badgeClass:'badge-best', subtitle:'রক্তশূন্যতা দূর করে, হিমোগ্লোবিন বৃদ্ধি করে', img:'https://images.unsplash.com/photo-1598032895397-b9472444bf93?w=600&q=80', imgs:['https://images.unsplash.com/photo-1598032895397-b9472444bf93?w=800'], basePrice:380, baseOld:450, baseDiscount:16, prices:{'2kg':{price:750,old:900,dis:18},'1kg':{price:380,old:450,dis:16},'500gm':{price:220,old:250,dis:12}}, desc:'বিটরুট পাউডার প্রাকৃতিক উপায়ে রক্তশূন্যতা দূর করতে কার্যকরী।', benefits:['রক্তশূন্যতা দূর করে','হিমোগ্লোবিন বৃদ্ধি করে'], ingredients:['খাঁটি বিটরুট — 100%'], usage:['প্রতিদিন সকালে ১ চামচ'], order:2 },
      { id:'panchabhut', name:'পঞ্চভূত প্লাস', badge:null, subtitle:'পাঁচটি প্রাকৃতিক উপাদানের সমন্বয়ে গঠিত', img:'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=600&q=80', imgs:['https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=800'], basePrice:510, baseOld:600, baseDiscount:15, prices:{'2kg':{price:980,old:1200,dis:18},'1kg':{price:510,old:600,dis:15},'500gm':{price:280,old:320,dis:12}}, desc:'পঞ্চভূত প্লাস পাঁচটি মূল্যবান ভেষজ উপাদানের সমন্বয়ে গঠিত।', benefits:['রোগ প্রতিরোধ ক্ষমতা বৃদ্ধি','শারীরিক দুর্বলতা দূর করে'], ingredients:['অশ্বগন্ধা — 25%','শতমূলী — 20%'], usage:['সকালে দুধের সাথে ১ চামচ'], order:3 },
      { id:'arjun', name:'অর্জুন হার্ট কেয়ার', badge:null, subtitle:'হৃদযন্ত্রের সুরক্ষায়', img:'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=600&q=80', imgs:['https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=800'], basePrice:460, baseOld:550, baseDiscount:16, prices:{'2kg':{price:900,old:1100,dis:18},'1kg':{price:460,old:550,dis:16},'500gm':{price:250,old:280,dis:12}}, desc:'অর্জুন হার্ট কেয়ার হৃদযন্ত্রের সুরক্ষার জন্য প্রাকৃতিক পণ্য।', benefits:['হৃদপিন্ড শক্তিশালী করে','উচ্চ রক্তচাপ নিয়ন্ত্রণ করে'], ingredients:['অর্জুন ছাল — 100%'], usage:['সকালে গরম দুধের সাথে'], order:4 },
      { id:'alkushi', name:'দুধে শোধিত আলকুশি', badge:'NEW', badgeClass:'badge-new', subtitle:'যৌন শক্তি বৃদ্ধিতে আয়ুর্বেদিক ফর্মুলা', img:'https://images.unsplash.com/photo-1616683693504-3ea7e9ad6fec?w=600&q=80', imgs:['https://images.unsplash.com/photo-1616683693504-3ea7e9ad6fec?w=800'], basePrice:595, baseOld:700, baseDiscount:15, prices:{'2kg':{price:1150,old:1400,dis:18},'1kg':{price:595,old:700,dis:15},'500gm':{price:330,old:380,dis:12}}, desc:'দুধে শোধিত আলকুশি একটি প্রাচীন আয়ুর্বেদিক পদ্ধতিতে তৈরি পণ্য।', benefits:['যৌন শক্তি বৃদ্ধি করে','শারীরিক স্ট্যামিনা বাড়ায়'], ingredients:['আলকুশি বীজ — 60%','গরুর দুধ — 40%'], usage:['সকালে গরম দুধের সাথে ১ চামচ'], order:5 },
    ];
    await Product.insertMany(defaultProducts);
    console.log('✅ Default products seeded');
  }

  const settingsCount = await SiteSettings.countDocuments();
  if (settingsCount === 0) {
    await SiteSettings.insertMany([
      { key: 'siteName', value: 'গ্লোবাল অর্গানিক ফুডস্' },
      { key: 'phone', value: '01711386880' },
      { key: 'whatsapp', value: '8801711386880' },
      { key: 'email', value: 'support@globalorganicfoods.com' },
      { key: 'address', value: 'ঢাকা, বাংলাদেশ' },
      { key: 'announcement', value: 'বিশেষ অফার! সারা বাংলাদেশে ফ্রি হোম ডেলিভারি এবং 15% ছাড় পাচ্ছেন আজই' },
      { key: 'deliveryInside', value: 80 },
      { key: 'deliveryOutside', value: 130 },
      { key: 'freeDelivery', value: true },
      { key: 'returnDays', value: 7 },
    ]);
    console.log('✅ Default settings seeded');
  }
}

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', time: new Date().toISOString(), db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const match = await bcrypt.compare(password, admin.password);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const token = jwt.sign({ id: admin._id, username: admin.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, username: admin.username });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const admin = await Admin.findById(req.admin.id);
    const match = await bcrypt.compare(currentPassword, admin.password);
    if (!match) return res.status(400).json({ success: false, message: 'Current password incorrect' });
    admin.password = await bcrypt.hash(newPassword, 10);
    await admin.save();
    res.json({ success: true, message: 'Password updated' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/auth/verify', authMiddleware, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
    res.json({ success: true, products });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findOne({ id: req.params.id, isActive: true });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, product });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/admin/products', authMiddleware, async (req, res) => {
  try {
    const products = await Product.find().sort({ order: 1, createdAt: 1 });
    res.json({ success: true, products });
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
    const product = await Product.findOneAndUpdate(
      { id: req.params.id },
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    if (!product) return res.status(404).json({ success: false, message: 'Not found' });
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

app.delete('/api/admin/image', authMiddleware, async (req, res) => {
  try {
    const { publicId } = req.body;
    await cloudinary.uploader.destroy(publicId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { productId, productName, weight, quantity, unitPrice, deliveryCharge, totalPrice, customerName, phone, address, deliveryArea } = req.body;
    if (!customerName || !phone || !address) return res.status(400).json({ success: false, message: 'Missing required fields' });
    const orderNumber = await generateOrderNumber();
    const order = await Order.create({ orderNumber, productId, productName, weight, quantity, unitPrice, deliveryCharge, totalPrice, customerName, phone, address, deliveryArea });
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  try { await seedDefaults(); } catch (e) { console.error('Seed error:', e.message); }
});