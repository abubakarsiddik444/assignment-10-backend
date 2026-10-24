const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const mongoUri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET;
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const cookieName = process.env.JWT_COOKIE_NAME || "recipehub_token";
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;

app.use(
  cors({
    origin: [clientOrigin, "http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

let db;
let collections;
let databaseReady = false;
let databaseError = null;

function asObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function recipeQueryId(id) {
  const objectId = asObjectId(id);
  return objectId ? { $or: [{ _id: objectId }, { id }] } : { id };
}

function publicUser(user) {
  if (!user) return null;
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    image: user.image,
    role: user.role || "user",
    isBlocked: Boolean(user.isBlocked),
    isPremium: Boolean(user.isPremium),
  };
}

function signToken(user) {
  return jwt.sign(
    { userId: String(user._id), email: user.email, role: user.role || "user" },
    jwtSecret,
    { expiresIn: "7d" }
  );
}

function setAuthCookie(res, token) {
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

async function getUserFromRequest(req) {
  const token = req.cookies?.[cookieName] || req.headers.authorization?.replace("Bearer ", "");
  if (!token) return null;

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }

  if (!payload.email) return null;
  let user = await collections.users.findOne({
    email: String(payload.email).toLowerCase(),
  });
  if (!user && payload.userId) {
    const now = new Date();
    const profile = {
      authUserId: String(payload.userId),
      name: String(payload.name || payload.email).slice(0, 100),
      email: String(payload.email).toLowerCase(),
      image: String(payload.image || ""),
      role: "user",
      isBlocked: false,
      isPremium: false,
      createdAt: now,
      updatedAt: now,
    };
    const result = await collections.users.insertOne(profile);
    user = { ...profile, _id: result.insertedId };
  }
  if (
    user?.role === "admin" &&
    payload.emailVerified !== true &&
    user.authUserId !== String(payload.userId)
  ) {
    return null;
  }
  if (!user || user.isBlocked) return null;
  return user;
}

function requireAuth(req, res, next) {
  getUserFromRequest(req).then((user) => {
    if (!user) return res.status(401).json({ message: "Authentication required" });
    req.user = user;
    next();
  }).catch(next);
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

function validatePassword(password) {
  return typeof password === "string" && /^(?=.*[a-z])(?=.*[A-Z]).{6,}$/.test(password);
}

async function seedDatabase() {
  const now = new Date();
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const email = process.env.ADMIN_EMAIL.toLowerCase();
    const admin = {
      name: process.env.ADMIN_NAME || "RecipeHub Admin",
      email,
      image: "",
      role: "admin",
      isBlocked: false,
      isPremium: true,
      password: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12),
      createdAt: now,
      updatedAt: now,
    };
    await collections.users.updateOne(
      { email },
      { $setOnInsert: admin },
      { upsert: true }
    );
  }

  const recipes = [
    ["golden-paneer-bowl", "Golden Paneer Bowl", "Dinner", "Indian", "Medium", "35 min", 842, true, 4.99],
    ["citrus-salmon-tray", "Citrus Salmon Tray", "Seafood", "Mediterranean", "Easy", "28 min", 1190, true, 5.49],
    ["mango-sticky-parfait", "Mango Sticky Parfait", "Dessert", "Thai", "Easy", "20 min", 1565, true, 3.99],
    ["smoky-bean-tacos", "Smoky Bean Tacos", "Street Food", "Mexican", "Easy", "25 min", 1324, false, 2.99],
    ["green-garden-ramen", "Green Garden Ramen", "Vegan", "Japanese", "Hard", "50 min", 986, false, 4.49],
    ["berry-oat-skillet", "Berry Oat Skillet", "Breakfast", "American", "Easy", "18 min", 764, false, 2.49],
    ["roasted-tomato-orzo", "Roasted Tomato Orzo", "Dinner", "Italian", "Easy", "32 min", 928, true, 3.49],
    ["coconut-lentil-curry", "Coconut Lentil Curry", "Vegan", "Indian", "Easy", "40 min", 1102, false, 3.99],
    ["blueberry-lemon-pancakes", "Blueberry Lemon Pancakes", "Breakfast", "American", "Easy", "22 min", 876, false, 2.49],
    ["crispy-tofu-banh-mi", "Crispy Tofu Banh Mi", "Street Food", "Vietnamese", "Medium", "30 min", 1438, true, 4.25],
    ["miso-glazed-aubergine", "Miso Glazed Aubergine", "Vegan", "Japanese", "Medium", "38 min", 1015, false, 3.75],
    ["cardamom-pear-crumble", "Cardamom Pear Crumble", "Dessert", "British", "Easy", "45 min", 1198, false, 3.25],
    ["herb-chicken-couscous", "Herb Chicken Couscous", "Dinner", "Moroccan", "Medium", "42 min", 1326, false, 4.75],
  ].map(([id, recipeName, category, cuisineType, difficultyLevel, preparationTime, likesCount, isFeatured, price]) => ({
    id,
    recipeName,
    recipeImage: "https://images.unsplash.com/photo-1543353071-873f17a7a088?auto=format&fit=crop&w=1200&q=80",
    category,
    cuisineType,
    difficultyLevel,
    preparationTime,
    ingredients: ["Fresh produce", "Spices", "Olive oil", "Herbs"],
    instructions: `Prepare ${recipeName} with fresh ingredients, balanced seasoning, and a careful finish before serving.`,
    authorName: "Nadia Rahman",
    authorEmail: "nadia@example.com",
    likesCount,
    isFeatured,
    status: "published",
    price,
    createdAt: now,
    updatedAt: now,
  }));
  await Promise.all(
    recipes.map((recipe) =>
      collections.recipes.updateOne(
        { id: recipe.id },
        { $setOnInsert: recipe },
        { upsert: true }
      )
    )
  );
}

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/health", async (req, res) => {
  if (!databaseReady) {
    return res.status(503).json({
      status: "unavailable",
      database: "disconnected",
      message: "The API is running, but MongoDB is not connected.",
      ...(databaseError ? { databaseError } : {}),
    });
  }

  try {
    await db.command({ ping: 1 });
    return res.json({ status: "ok", database: "connected" });
  } catch {
    return res.status(503).json({
      status: "unavailable",
      database: "disconnected",
      message: "The API is running, but MongoDB is not reachable.",
    });
  }
});

app.use("/api", (req, res, next) => {
  if (!databaseReady) {
    return res.status(503).json({
      message: "RecipeHub database is unavailable. Check the backend MongoDB configuration.",
    });
  }
  next();
});

app.post("/api/auth/register", async (req, res) => {
  const { name, email, image, password } = req.body;
  if (!name || !email || !validatePassword(password)) {
    return res.status(400).json({ message: "Name, valid email, and strong password are required" });
  }
  const normalizedEmail = email.toLowerCase();
  const exists = await collections.users.findOne({ email: normalizedEmail });
  if (exists) return res.status(409).json({ message: "Email already registered" });

  const now = new Date();
  const userDoc = {
    name,
    email: normalizedEmail,
    image: image || "",
    password: await bcrypt.hash(password, 10),
    role: "user",
    isBlocked: false,
    isPremium: false,
    createdAt: now,
    updatedAt: now,
  };
  const result = await collections.users.insertOne(userDoc);
  const user = { ...userDoc, _id: result.insertedId };
  setAuthCookie(res, signToken(user));
  res.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await collections.users.findOne({ email: String(email || "").toLowerCase() });
  if (!user || !(await bcrypt.compare(password || "", user.password || ""))) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  if (user.isBlocked) return res.status(403).json({ message: "This account is blocked" });
  setAuthCookie(res, signToken(user));
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(cookieName);
  res.json({ message: "Logged out" });
});

app.get("/api/auth/me", async (req, res) => {
  const user = await getUserFromRequest(req);
  res.json({ user: publicUser(user) });
});

app.get("/api/recipes", async (req, res) => {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "9", 10), 1), 30);
  const query = { status: { $ne: "deleted" } };
  if (req.query.featured === "true") query.isFeatured = true;
  if (req.query.category) {
    query.category = { $in: String(req.query.category).split(",").filter(Boolean) };
  }
  if (req.query.search) {
    query.recipeName = { $regex: String(req.query.search), $options: "i" };
  }
  const sort = req.query.sort === "popular" ? { likesCount: -1 } : { createdAt: -1 };
  const total = await collections.recipes.countDocuments(query);
  const recipes = await collections.recipes
    .find(query)
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();
  res.json({ recipes, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
});

app.get("/api/recipes/:id", async (req, res) => {
  const recipe = await collections.recipes.findOne(recipeQueryId(req.params.id));
  if (!recipe) return res.status(404).json({ message: "Recipe not found" });
  res.json({ recipe });
});

app.post("/api/recipes", requireAuth, async (req, res) => {
  if (!req.user.isPremium) {
    const ownCount = await collections.recipes.countDocuments({ authorEmail: req.user.email });
    if (ownCount >= 2) {
      return res.status(403).json({ message: "Normal users can add only 2 recipes. Become premium for unlimited recipes." });
    }
  }
  const now = new Date();
  const doc = {
    recipeName: req.body.recipeName,
    recipeImage: req.body.recipeImage || req.body.image || "",
    category: req.body.category,
    cuisineType: req.body.cuisineType,
    difficultyLevel: req.body.difficultyLevel,
    preparationTime: req.body.preparationTime,
    ingredients: Array.isArray(req.body.ingredients) ? req.body.ingredients : String(req.body.ingredients || "").split("\n").filter(Boolean),
    instructions: req.body.instructions,
    authorId: String(req.user._id),
    authorName: req.user.name,
    authorEmail: req.user.email,
    likesCount: 0,
    isFeatured: false,
    status: "published",
    price: Number(req.body.price || 2.99),
    createdAt: now,
    updatedAt: now,
  };
  if (!doc.recipeName || !doc.category || !doc.instructions) {
    return res.status(400).json({ message: "Recipe name, category, and instructions are required" });
  }
  const result = await collections.recipes.insertOne(doc);
  res.status(201).json({ recipe: { ...doc, _id: result.insertedId } });
});

app.post("/api/recipes/:id/like", requireAuth, async (req, res) => {
  const result = await collections.recipes.findOneAndUpdate(
    recipeQueryId(req.params.id),
    { $inc: { likesCount: 1 }, $set: { updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  res.json({ recipe: result });
});

app.post("/api/recipes/:id/favorite", requireAuth, async (req, res) => {
  const recipe = await collections.recipes.findOne(recipeQueryId(req.params.id));
  if (!recipe) return res.status(404).json({ message: "Recipe not found" });
  const filter = { userEmail: req.user.email, recipeId: String(recipe._id) };
  const existing = await collections.favorites.findOne(filter);
  if (existing) {
    await collections.favorites.deleteOne(filter);
    return res.json({ favorited: false });
  }
  await collections.favorites.insertOne({ ...filter, userId: String(req.user._id), addedAt: new Date() });
  res.status(201).json({ favorited: true });
});

app.post("/api/recipes/:id/report", requireAuth, async (req, res) => {
  const reason = req.body.reason;
  if (!["Spam", "Offensive Content", "Copyright Issue"].includes(reason)) {
    return res.status(400).json({ message: "Valid report reason required" });
  }
  const recipe = await collections.recipes.findOne(recipeQueryId(req.params.id));
  if (!recipe) return res.status(404).json({ message: "Recipe not found" });
  const report = {
    recipeId: String(recipe._id),
    recipeName: recipe.recipeName,
    reporterEmail: req.user.email,
    reason,
    status: "pending",
    createdAt: new Date(),
  };
  const result = await collections.reports.insertOne(report);
  res.status(201).json({ report: { ...report, _id: result.insertedId } });
});

app.get("/api/dashboard/overview", requireAuth, async (req, res) => {
  const [totalRecipes, totalFavorites, likesData] = await Promise.all([
    collections.recipes.countDocuments({ authorEmail: req.user.email }),
    collections.favorites.countDocuments({ userEmail: req.user.email }),
    collections.recipes
      .aggregate([{ $match: { authorEmail: req.user.email } }, { $group: { _id: null, likes: { $sum: "$likesCount" } } }])
      .toArray(),
  ]);
  res.json({
    totalRecipes,
    totalFavorites,
    totalLikesReceived: likesData[0]?.likes || 0,
    isPremium: Boolean(req.user.isPremium),
  });
});

app.get("/api/favorites", requireAuth, async (req, res) => {
  const favorites = await collections.favorites.find({ userEmail: req.user.email }).toArray();
  const ids = favorites.map((item) => asObjectId(item.recipeId)).filter(Boolean);
  const recipes = ids.length ? await collections.recipes.find({ _id: { $in: ids } }).toArray() : [];
  res.json({ recipes });
});

app.get("/api/payments/my-recipes", requireAuth, async (req, res) => {
  const payments = await collections.payments.find({ userEmail: req.user.email, recipeId: { $ne: null } }).toArray();
  res.json({ payments });
});

app.post("/api/payments/create-checkout-session", requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ message: "Stripe secret key is not configured" });
  const type = req.body.type || "premium";
  const recipe = req.body.recipeId ? await collections.recipes.findOne(recipeQueryId(req.body.recipeId)) : null;
  const amount = type === "premium" ? 19.99 : Number(recipe?.price || 2.99);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: req.user.email,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: type === "premium" ? "RecipeHub Premium" : recipe.recipeName },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${clientOrigin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${clientOrigin}/${type === "premium" ? "premium" : `recipes/${req.body.recipeId}`}`,
    metadata: {
      type,
      userId: String(req.user._id),
      userEmail: req.user.email,
      recipeId: recipe ? String(recipe._id) : "",
    },
  });
  res.json({ url: session.url });
});

app.post("/api/payments/confirm", requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ message: "Stripe secret key is not configured" });
  if (typeof req.body.sessionId !== "string" || !req.body.sessionId) {
    return res.status(400).json({ message: "Checkout session ID is required" });
  }
  const session = await stripe.checkout.sessions.retrieve(req.body.sessionId);
  if (
    session.metadata?.userId !== String(req.user._id) ||
    session.metadata?.userEmail !== req.user.email
  ) {
    return res.status(403).json({ message: "This checkout session belongs to another user" });
  }
  if (session.payment_status !== "paid") return res.status(400).json({ message: "Payment is not paid" });
  const payment = {
    userEmail: req.user.email,
    userId: String(req.user._id),
    amount: (session.amount_total || 0) / 100,
    recipeId: session.metadata?.recipeId || null,
    transactionId: session.payment_intent || session.id,
    paymentStatus: session.payment_status,
    paidAt: new Date(),
  };
  await collections.payments.updateOne({ transactionId: payment.transactionId }, { $setOnInsert: payment }, { upsert: true });
  if (session.metadata?.type === "premium") {
    await collections.users.updateOne({ _id: req.user._id }, { $set: { isPremium: true, updatedAt: new Date() } });
  }
  res.json({ payment });
});

app.get("/api/admin/overview", requireAuth, requireAdmin, async (req, res) => {
  const [totalUsers, totalRecipes, totalPremiumMembers, totalReports] = await Promise.all([
    collections.users.countDocuments(),
    collections.recipes.countDocuments({ status: { $ne: "deleted" } }),
    collections.users.countDocuments({ isPremium: true }),
    collections.reports.countDocuments({ status: "pending" }),
  ]);
  res.json({ totalUsers, totalRecipes, totalPremiumMembers, totalReports });
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const users = await collections.users.find({}, { projection: { password: 0 } }).sort({ createdAt: -1 }).toArray();
  res.json({ users });
});

app.patch("/api/admin/users/:id/block", requireAuth, requireAdmin, async (req, res) => {
  await collections.users.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { isBlocked: Boolean(req.body.isBlocked) } });
  res.json({ message: "User updated" });
});

app.get("/api/admin/reports", requireAuth, requireAdmin, async (req, res) => {
  const reports = await collections.reports.find().sort({ createdAt: -1 }).toArray();
  res.json({ reports });
});

app.patch("/api/admin/reports/:id", requireAuth, requireAdmin, async (req, res) => {
  await collections.reports.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: req.body.status || "dismissed" } });
  res.json({ message: "Report updated" });
});

app.patch("/api/admin/recipes/:id/feature", requireAuth, requireAdmin, async (req, res) => {
  await collections.recipes.updateOne(recipeQueryId(req.params.id), { $set: { isFeatured: Boolean(req.body.isFeatured), updatedAt: new Date() } });
  res.json({ message: "Recipe featured state updated" });
});

app.delete("/api/admin/recipes/:id", requireAuth, requireAdmin, async (req, res) => {
  await collections.recipes.updateOne(recipeQueryId(req.params.id), { $set: { status: "deleted", updatedAt: new Date() } });
  res.json({ message: "Recipe deleted" });
});

app.get("/api/admin/transactions", requireAuth, requireAdmin, async (req, res) => {
  const payments = await collections.payments.find().sort({ paidAt: -1 }).toArray();
  res.json({ payments });
});

async function connectDatabase() {
  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing from backend .env");
  }
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters in backend .env");
  }
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const connectedDb = client.db(process.env.DB_NAME || "recipehub");
    const connectedCollections = {
      users: connectedDb.collection("users"),
      recipes: connectedDb.collection("recipes"),
      favorites: connectedDb.collection("favorites"),
      reports: connectedDb.collection("reports"),
      payments: connectedDb.collection("payments"),
    };
    db = connectedDb;
    collections = connectedCollections;
    await collections.users.createIndex({ email: 1 }, { unique: true });
    await collections.favorites.createIndex({ userEmail: 1, recipeId: 1 }, { unique: true });
    await seedDatabase();
    databaseReady = true;
    databaseError = null;
    console.log("RecipeHub connected to MongoDB.");
  } catch (error) {
    db = null;
    collections = null;
    databaseReady = false;
    await client.close().catch(() => {});
    throw error;
  }
}

async function keepDatabaseConnected() {
  let retryDelay = 1000;

  while (!databaseReady) {
    try {
      await connectDatabase();
      return;
    } catch (error) {
      databaseError =
        error.code === 8000 || error.codeName === "AtlasError"
          ? "Atlas rejected MongoDB authentication. Verify the Atlas Database Access username and password."
          : error.message || "MongoDB connection failed.";
      console.error(`MongoDB unavailable: ${databaseError}`);
      console.error(`Retrying MongoDB connection in ${Math.round(retryDelay / 1000)}s.`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 60000);
    }
  }
}

function start() {
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters in backend .env");
  }

  app.listen(port, () => {
    console.log(`RecipeHub API running on http://localhost:${port}`);
    void keepDatabaseConnected();
  });
}

try {
  start();
} catch (error) {
  console.error("Failed to start RecipeHub API", error);
  process.exit(1);
}
