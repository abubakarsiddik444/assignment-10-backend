const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const { MongoClient, ObjectId } = require("mongodb");
const seedRecipes = require("./data/recipes.json");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const mongoUri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET;
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const cookieName = process.env.JWT_COOKIE_NAME || "recipehub_token";
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;

function respondWithStripeError(res, error, action) {
  const authenticationFailure =
    error.type === "StripeAuthenticationError" || error.code === "api_key_expired";
  const connectionFailure = error.type === "StripeConnectionError";
  const safeMessage = String(error.message || "Unknown Stripe error").replace(
    /\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]+\b|\bwhsec_[A-Za-z0-9]+\b/g,
    "[redacted Stripe key]",
  );

  console.error(`Stripe ${action} failed.`, {
    type: error.type,
    code: error.code,
    statusCode: error.statusCode,
    requestId: error.requestId,
    message: safeMessage,
  });

  if (authenticationFailure) {
    return res.status(503).json({
      message: "Stripe rejected the backend secret key. Check STRIPE_SECRET_KEY in the backend .env and restart the backend.",
    });
  }
  if (connectionFailure) {
    return res.status(503).json({
      message: "Could not connect to Stripe. Check your network connection and try again.",
    });
  }
  return res.status(502).json({
    message: `Stripe could not ${action}: ${safeMessage}${error.requestId ? ` (request ${error.requestId})` : ""}`,
  });
}

const additionalSeedRecipes = [
  ["Smoky Shakshuka Toast", "Breakfast", "Middle Eastern"],
  ["Cardamom Date Porridge", "Breakfast", "British"],
  ["Spinach Feta Egg Muffins", "Breakfast", "Greek"],
  ["Cinnamon Apple French Toast", "Breakfast", "French"],
  ["Savory Mushroom Breakfast Hash", "Breakfast", "American"],
  ["Coconut Chia Breakfast Cups", "Breakfast", "Caribbean"],
  ["Herbed Potato Breakfast Tacos", "Breakfast", "Mexican"],
  ["Almond Pear Overnight Oats", "Breakfast", "American"],
  ["Lemon Herb Chicken Pilaf", "Dinner", "Turkish"],
  ["Slow-Roasted Tomato Gnocchi", "Dinner", "Italian"],
  ["Ginger Beef Rice Bowls", "Dinner", "Korean"],
  ["Cumin-Roasted Cauliflower Steaks", "Dinner", "North African"],
  ["Creamy Tuscan White Beans", "Dinner", "Italian"],
  ["Sesame Ginger Noodle Bowl", "Dinner", "Chinese"],
  ["Paprika Chicken with Couscous", "Dinner", "Moroccan"],
  ["Miso Butter Mushroom Rice", "Dinner", "Japanese"],
  ["Crispy Potato and Lentil Bake", "Dinner", "Indian"],
  ["Dark Chocolate Orange Tartlets", "Dessert", "French"],
  ["Honey Pistachio Yogurt Cake", "Dessert", "Greek"],
  ["Vanilla Berry Bread Pudding", "Dessert", "American"],
  ["Brown Butter Peach Crisp", "Dessert", "American"],
  ["Coconut Lime Rice Pudding", "Dessert", "Thai"],
  ["Ginger Pear Upside-Down Cake", "Dessert", "British"],
  ["Strawberry Cardamom Shortcakes", "Dessert", "Indian"],
  ["Salted Caramel Date Bites", "Dessert", "Middle Eastern"],
  ["Crispy Tofu Sesame Greens", "Vegan", "Chinese"],
  ["Roasted Pumpkin Chickpea Stew", "Vegan", "Ethiopian"],
  ["Lemon Tahini Grain Bowl", "Vegan", "Mediterranean"],
  ["Spicy Peanut Sweet Potato Noodles", "Vegan", "Thai"],
  ["Smoky Black Bean Stuffed Peppers", "Vegan", "Mexican"],
  ["Coconut Spinach Lentil Soup", "Vegan", "Indian"],
  ["Mushroom Barley Herb Pilaf", "Vegan", "Eastern European"],
  ["Charred Broccoli Hummus Plate", "Vegan", "Mediterranean"],
  ["Crispy Fish Taco Sliders", "Street Food", "Mexican"],
  ["Gochujang Cauliflower Bao", "Street Food", "Korean"],
  ["Spiced Lamb Pita Pockets", "Street Food", "Lebanese"],
  ["Crispy Plantain Arepas", "Street Food", "Colombian"],
  ["Masala Corn Chaat Cups", "Street Food", "Indian"],
  ["Ginger Chicken Lettuce Wraps", "Street Food", "Chinese"],
  ["Grilled Halloumi Flatbread", "Street Food", "Cypriot"],
  ["Tamarind Potato Samosa Chaat", "Street Food", "Indian"],
  ["Garlic Butter Cod with Greens", "Seafood", "French"],
  ["Chili Lime Shrimp Skewers", "Seafood", "Mexican"],
  ["Coconut Curry Mussels", "Seafood", "Thai"],
  ["Sesame Crusted Tuna Salad", "Seafood", "Japanese"],
  ["Herbed Salmon with Barley", "Seafood", "Nordic"],
  ["Saffron Tomato Clam Stew", "Seafood", "Spanish"],
  ["Crispy Haddock with Pea Mash", "Seafood", "British"],
  ["Lemon Dill Crab Cakes", "Seafood", "American"],
  ["Ginger Scallop Rice Noodles", "Seafood", "Vietnamese"],
].map(([recipeName, category, cuisineType], index) => {
  const ingredientsByCategory = {
    Breakfast: ["eggs", "rolled oats", "seasonal fruit", "fresh herbs"],
    Dinner: ["seasonal vegetables", "whole grains", "aromatic spices", "fresh herbs"],
    Dessert: ["seasonal fruit", "vanilla", "brown sugar", "lemon zest"],
    Vegan: ["chickpeas", "leafy greens", "seasonal vegetables", "toasted spices"],
    "Street Food": ["warm flatbread", "crunchy vegetables", "lime", "chili"],
    Seafood: ["fresh seafood", "lemon", "olive oil", "garden herbs"],
  };
  const imageIds = [
    "photo-1547592180-85f173990554",
    "photo-1473093295043-cdd812d0e601",
    "photo-1512621776951-a57141f2eefd",
    "photo-1565557623262-b51c2513a641",
    "photo-1551504734-5ee1c4a1479b",
    "photo-1467003909585-2f8a72700288",
  ];
  return {
    id: `community-recipe-${String(index + 1).padStart(2, "0")}`,
    recipeName,
    recipeImage: `https://images.unsplash.com/${imageIds[index % imageIds.length]}?auto=format&fit=crop&w=1200&q=80`,
    category,
    cuisineType,
    difficultyLevel: index % 3 === 0 ? "Medium" : "Easy",
    preparationTime: `${20 + (index % 7) * 5} min`,
    ingredients: ingredientsByCategory[category],
    instructions: `Prepare ${recipeName.toLowerCase()} by cooking the ingredients until tender and aromatic, then finish with fresh herbs and serve warm.`,
    authorName: "RecipeHub Community",
    authorEmail: "community@recipehub.test",
    likesCount: 0,
    isFeatured: false,
    status: "published",
    price: 2.49 + (index % 6) * 0.5,
  };
});

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
    gender: user.gender || "",
    role: user.role || "user",
    isBlocked: Boolean(user.isBlocked),
    isPremium: Boolean(user.isPremium),
  };
}

function publicRecipe(recipe) {
  if (!recipe) return recipe;
  const result = { ...recipe };
  delete result.likedBy;
  return result;
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

  const recipes = [...seedRecipes, ...additionalSeedRecipes].map((recipe) => ({
    ...recipe,
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

app.patch("/api/users/me", requireAuth, async (req, res) => {
  const updates = {};
  if (req.body.name !== undefined) {
    if (typeof req.body.name !== "string" || !req.body.name.trim() || req.body.name.length > 100) {
      return res.status(400).json({ message: "Name must contain 1-100 characters" });
    }
    updates.name = req.body.name.trim();
  }
  if (req.body.image !== undefined) {
    if (typeof req.body.image !== "string") {
      return res.status(400).json({ message: "Image URL must be a string" });
    }
    if (req.body.image) {
      try {
        const imageUrl = new URL(req.body.image);
        if (!["http:", "https:"].includes(imageUrl.protocol)) throw new Error("Invalid protocol");
      } catch {
        return res.status(400).json({ message: "Image must be a valid HTTP or HTTPS URL" });
      }
    }
    updates.image = req.body.image;
  }
  if (req.body.gender !== undefined) {
    if (!["Female", "Male", "Other"].includes(req.body.gender)) {
      return res.status(400).json({ message: "Gender must be Female, Male, or Other" });
    }
    updates.gender = req.body.gender;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ message: "At least one profile field is required" });
  }
  updates.updatedAt = new Date();
  await collections.users.updateOne({ _id: req.user._id }, { $set: updates });
  res.json({ user: publicUser({ ...req.user, ...updates }) });
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
  const limit = Math.min(Math.max(parseInt(req.query.limit || "9", 10), 1), 100);
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
  res.json({
    recipes: recipes.map(publicRecipe),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

app.get("/api/recipes/my", requireAuth, async (req, res) => {
  const recipes = await collections.recipes
    .find({ authorEmail: req.user.email, status: { $ne: "deleted" } })
    .sort({ createdAt: -1 })
    .toArray();
  res.json({ recipes: recipes.map(publicRecipe) });
});

app.get("/api/recipes/:id", async (req, res) => {
  const recipe = await collections.recipes.findOne({
    ...recipeQueryId(req.params.id),
    status: { $ne: "deleted" },
  });
  if (!recipe) return res.status(404).json({ message: "Recipe not found" });
  res.json({ recipe: publicRecipe(recipe) });
});

app.post("/api/recipes", requireAuth, async (req, res) => {
  if (!req.user.isPremium) {
    const ownCount = await collections.recipes.countDocuments({
      authorEmail: req.user.email,
      status: { $ne: "deleted" },
    });
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

app.patch("/api/recipes/:id", requireAuth, async (req, res) => {
  const updates = {
    recipeName: req.body.recipeName,
    recipeImage: req.body.recipeImage,
    category: req.body.category,
    cuisineType: req.body.cuisineType,
    difficultyLevel: req.body.difficultyLevel,
    preparationTime: req.body.preparationTime,
    ingredients: Array.isArray(req.body.ingredients)
      ? req.body.ingredients
      : String(req.body.ingredients || "").split("\n").map((item) => item.trim()).filter(Boolean),
    instructions: req.body.instructions,
  };
  if (!updates.recipeName || !updates.category || !updates.instructions) {
    return res.status(400).json({ message: "Recipe name, category, and instructions are required" });
  }
  const result = await collections.recipes.findOneAndUpdate(
    {
      ...recipeQueryId(req.params.id),
      authorEmail: req.user.email,
      status: { $ne: "deleted" },
    },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!result) {
    const exists = await collections.recipes.findOne(recipeQueryId(req.params.id));
    if (!exists || exists.status === "deleted") {
      return res.status(404).json({ message: "Recipe not found" });
    }
    return res.status(403).json({ message: "You can only edit your own recipes" });
  }
  res.json({ recipe: publicRecipe(result) });
});

app.delete("/api/recipes/:id", requireAuth, async (req, res) => {
  const result = await collections.recipes.updateOne(
    {
      ...recipeQueryId(req.params.id),
      authorEmail: req.user.email,
      status: { $ne: "deleted" },
    },
    { $set: { status: "deleted", updatedAt: new Date() } }
  );
  if (!result.matchedCount) {
    const exists = await collections.recipes.findOne(recipeQueryId(req.params.id));
    if (!exists || exists.status === "deleted") {
      return res.status(404).json({ message: "Recipe not found" });
    }
    return res.status(403).json({ message: "You can only delete your own recipes" });
  }
  res.json({ message: "Recipe deleted" });
});

app.post("/api/recipes/:id/like", requireAuth, async (req, res) => {
  const userId = String(req.user._id);
  const result = await collections.recipes.findOneAndUpdate(
    { ...recipeQueryId(req.params.id), likedBy: { $ne: userId } },
    {
      $inc: { likesCount: 1 },
      $addToSet: { likedBy: userId },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: "after" }
  );
  if (!result) {
    const recipe = await collections.recipes.findOne(recipeQueryId(req.params.id));
    if (!recipe) return res.status(404).json({ message: "Recipe not found" });
    return res.json({ recipe: publicRecipe(recipe), liked: false });
  }
  res.json({ recipe: publicRecipe(result), liked: true });
});

app.get("/api/recipes/:id/like", requireAuth, async (req, res) => {
  const recipe = await collections.recipes
    .findOne(recipeQueryId(req.params.id), { projection: { likedBy: 1, likesCount: 1 } });
  if (!recipe) return res.status(404).json({ message: "Recipe not found" });
  res.json({
    liked: (recipe.likedBy || []).includes(String(req.user._id)),
    likesCount: recipe.likesCount || 0,
  });
});

app.get("/api/recipes/:id/favorite", requireAuth, async (req, res) => {
  const recipe = await collections.recipes.findOne(recipeQueryId(req.params.id));
  if (!recipe) return res.status(404).json({ message: "Recipe not found" });
  const favorited = await collections.favorites.findOne({
    userEmail: req.user.email,
    recipeId: String(recipe._id),
  });
  res.json({ favorited: Boolean(favorited) });
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

app.put("/api/recipes/:id/favorite", requireAuth, async (req, res) => {
  const recipe = await collections.recipes.findOne(recipeQueryId(req.params.id));
  if (!recipe) return res.status(404).json({ message: "Recipe not found" });
  const filter = { userEmail: req.user.email, recipeId: String(recipe._id) };
  try {
    await collections.favorites.updateOne(
      filter,
      {
        $setOnInsert: {
          ...filter,
          userId: String(req.user._id),
          addedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  res.json({ favorited: true });
});

app.delete("/api/recipes/:id/favorite", requireAuth, async (req, res) => {
  const recipe = await collections.recipes.findOne(recipeQueryId(req.params.id));
  if (!recipe) return res.status(404).json({ message: "Recipe not found" });
  await collections.favorites.deleteOne({
    userEmail: req.user.email,
    recipeId: String(recipe._id),
  });
  res.json({ favorited: false });
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
    collections.recipes.countDocuments({
      authorEmail: req.user.email,
      status: { $ne: "deleted" },
    }),
    collections.favorites.countDocuments({ userEmail: req.user.email }),
    collections.recipes
      .aggregate([
        { $match: { authorEmail: req.user.email, status: { $ne: "deleted" } } },
        { $group: { _id: null, likes: { $sum: "$likesCount" } } },
      ])
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
  res.json({ recipes: recipes.map(publicRecipe) });
});

app.get("/api/payments/my-recipes", requireAuth, async (req, res) => {
  const payments = await collections.payments.find({ userEmail: req.user.email, recipeId: { $ne: null } }).toArray();
  const recipeIds = payments.map((payment) => asObjectId(payment.recipeId)).filter(Boolean);
  const recipes = recipeIds.length
    ? await collections.recipes.find({ _id: { $in: recipeIds } }).toArray()
    : [];
  const recipeById = new Map(recipes.map((recipe) => [String(recipe._id), recipe]));
  res.json({
    payments: payments.map((payment) => ({
      ...payment,
      recipe: publicRecipe(recipeById.get(String(payment.recipeId))),
    })),
  });
});

app.post("/api/payments/create-checkout-session", requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ message: "Stripe secret key is not configured" });
  const type = req.body.type || "premium";
  if (!["premium", "recipe"].includes(type)) {
    return res.status(400).json({ message: "Purchase type must be premium or recipe" });
  }
  const recipe = type === "recipe" && req.body.recipeId
    ? await collections.recipes.findOne(recipeQueryId(req.body.recipeId))
    : null;
  if (type === "recipe" && !recipe) {
    return res.status(404).json({ message: "Recipe not found" });
  }
  const amount = type === "premium" ? 19.99 : Number(recipe.price);
  let session;
  try {
    session = await stripe.checkout.sessions.create({
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
  } catch (error) {
    return respondWithStripeError(res, error, "start checkout");
  }
  res.json({ url: session.url });
});

app.post("/api/payments/confirm", requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ message: "Stripe secret key is not configured" });
  if (typeof req.body.sessionId !== "string" || !req.body.sessionId) {
    return res.status(400).json({ message: "Checkout session ID is required" });
  }
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(req.body.sessionId);
  } catch (error) {
    return respondWithStripeError(res, error, "verify the payment");
  }
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

app.patch("/api/admin/users/:id/role", requireAuth, requireAdmin, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }
  if (!["admin", "user"].includes(req.body.role)) {
    return res.status(400).json({ message: "Role must be admin or user" });
  }
  if (String(req.user._id) === req.params.id && req.body.role !== "admin") {
    return res.status(400).json({ message: "You cannot remove your own admin role" });
  }
  const result = await collections.users.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { role: req.body.role, updatedAt: new Date() } }
  );
  if (!result.matchedCount) return res.status(404).json({ message: "User not found" });
  res.json({ message: "User role updated" });
});

app.patch("/api/admin/users/:id/block", requireAuth, requireAdmin, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }
  if (typeof req.body.isBlocked !== "boolean") {
    return res.status(400).json({ message: "isBlocked must be a boolean" });
  }
  if (String(req.user._id) === req.params.id && req.body.isBlocked) {
    return res.status(400).json({ message: "You cannot block your own account" });
  }
  const result = await collections.users.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { isBlocked: req.body.isBlocked, updatedAt: new Date() } }
  );
  if (!result.matchedCount) return res.status(404).json({ message: "User not found" });
  res.json({ message: "User updated" });
});

app.get("/api/admin/reports", requireAuth, requireAdmin, async (req, res) => {
  const reports = await collections.reports.find().sort({ createdAt: -1 }).toArray();
  res.json({ reports });
});

app.patch("/api/admin/reports/:id", requireAuth, requireAdmin, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid report ID" });
  }
  const { status } = req.body;
  if (!["dismissed", "removed"].includes(status)) {
    return res.status(400).json({ message: "Status must be dismissed or removed" });
  }
  const reportId = new ObjectId(req.params.id);
  const report = await collections.reports.findOne({ _id: reportId });
  if (!report) return res.status(404).json({ message: "Report not found" });
  if (status === "removed" && report.recipeId) {
    await collections.recipes.updateOne(
      recipeQueryId(report.recipeId),
      { $set: { status: "deleted", updatedAt: new Date() } }
    );
  }
  await collections.reports.updateOne({ _id: reportId }, { $set: { status } });
  res.json({ message: "Report updated" });
});

app.patch("/api/admin/recipes/:id/feature", requireAuth, requireAdmin, async (req, res) => {
  if (typeof req.body.isFeatured !== "boolean") {
    return res.status(400).json({ message: "isFeatured must be a boolean" });
  }
  const result = await collections.recipes.updateOne(
    recipeQueryId(req.params.id),
    { $set: { isFeatured: req.body.isFeatured, updatedAt: new Date() } }
  );
  if (!result.matchedCount) return res.status(404).json({ message: "Recipe not found" });
  res.json({ message: "Recipe featured state updated" });
});

app.delete("/api/admin/recipes/:id", requireAuth, requireAdmin, async (req, res) => {
  const result = await collections.recipes.updateOne(
    recipeQueryId(req.params.id),
    { $set: { status: "deleted", updatedAt: new Date() } }
  );
  if (!result.matchedCount) return res.status(404).json({ message: "Recipe not found" });
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
