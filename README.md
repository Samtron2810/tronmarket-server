# TronMarket — Server

Backend API for the TronMarket e-commerce platform. Built with **Node.js**, **Express**, and **MongoDB**, with optional **Redis** caching.

---

## Features

- **User Authentication & Authorization** — Register, login, logout with JWT-based access & refresh tokens. Token blacklisting on logout (via Redis).
- **Product Management** — Create, read, update, delete products. Supports search, category filtering, price range filtering, and pagination.
- **Shopping Cart** — Add to cart, update quantities, remove items, persist cart per user.
- **Order Processing** — Place orders, view order history, track order status (pending → confirmed → shipped → delivered → cancelled).
- **Payment Integration** — Paystack checkout integration for secure payments.
- **Admin Dashboard** — Admin-only endpoints for managing users, products, orders, and inventory.
- **Image Uploads** — Upload product images to Cloudinary via Multer middleware.
- **Redis Caching** — Product queries are cached to speed up repeated requests. Invalidation on product create/update/delete.
- **Rate Limiting** — Global and route-specific rate limiters to protect against DoS attacks.
- **Input Validation** — Request body validation using Zod schemas.
- **Error Handling** — Centralised error middleware returning consistent JSON error responses.
- **Health Check** — `GET /api/health` endpoint for monitoring.

---

## Tech Stack

| Layer          | Technology                              |
| -------------- | --------------------------------------- |
| **Runtime**    | Node.js                                 |
| **Framework**  | Express                                 |
| **Database**   | MongoDB (Mongoose ODM)                  |
| **Cache**      | Redis (optional — app runs without it)  |
| **Auth**       | JSON Web Tokens (jsonwebtoken + bcrypt) |
| **Validation** | Zod                                     |
| **Payments**   | Paystack                                |
| **Uploads**    | Cloudinary + Multer                     |
| **Rate Limit** | express-rate-limit                      |

---

## Packages Used

| Package              | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `express`            | Web framework                             |
| `mongoose`           | MongoDB ODM                               |
| `redis`              | Redis client (caching / blacklist)        |
| `jsonwebtoken`       | JWT creation & verification               |
| `bcryptjs`           | Password hashing                          |
| `cookie-parser`      | Parse cookies for refresh token flow      |
| `cors`               | Cross-origin resource sharing             |
| `dotenv`             | Load environment variables                |
| `zod`                | Schema validation                         |
| `cloudinary`         | Cloudinary image management SDK           |
| `multer`             | Multipart / file upload handling          |
| `axios`              | HTTP client (used for Paystack API calls) |
| `express-rate-limit` | Rate limiting middleware                  |
| `nodemon` _(dev)_    | Auto-restart on file changes              |

---

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **MongoDB** — running instance (local or Atlas)
- **Redis** (optional) — running instance (local or cloud, e.g. Redis Cloud / Upstash)

### 1. Clone the repository

```bash
git clone https://github.com/samtron2810/tronmarket-server.git
```

### 2. Install dependencies

```bash
npm install
# or
pnpm install
```

### 3. Create environment variables

Copy the example file (if provided) or create a `.env` file in the `server/` root:

```env
# Required
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret

# Paystack (required for payments)
PAYSTACK_SECRET_KEY=your_paystack_secret_key
PAYSTACK_PUBLIC_KEY=your publick key

# Cloudinary (required for image uploads)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Redis (optional — app works without it)
REDIS_URL=your connection link from redis-cloud || redis://localhost:6379

# Client URL (for CORS)
CLIENT_URL=http://localhost:5173
```

### 4. Start the server

**Development** (with auto-reload):

```bash
npm run dev
```

**Production**:

```bash
npm start
```

The server starts on the port defined in `PORT` (defaults to `5000`).

---

## API Endpoints

### Health

| Method | Endpoint      | Auth   | Description  |
| ------ | ------------- | ------ | ------------ |
| GET    | `/api/health` | Public | Health check |

### Authentication — `/api/auth`

| Method | Endpoint             | Auth      | Rate Limited | Description               |
| ------ | -------------------- | --------- | ------------ | ------------------------- |
| POST   | `/api/auth/register` | Public    | Yes          | Register a new user       |
| POST   | `/api/auth/login`    | Public    | Yes          | Login user                |
| POST   | `/api/auth/logout`   | Protected | No           | Logout (blacklists token) |

### Products — `/api/products`

| Method | Endpoint                           | Auth   | Description                        |
| ------ | ---------------------------------- | ------ | ---------------------------------- |
| GET    | `/api/products`                    | Public | Get all products (cached)          |
| GET    | `/api/products/:id`                | Public | Get single product (cached)        |
| POST   | `/api/products`                    | Seller | Create a new product               |
| PUT    | `/api/products/:id`                | Seller | Update a product                   |
| DELETE | `/api/products/:id`                | Seller | Delete a product                   |
| GET    | `/api/products/seller/my-products` | Seller | Get seller's own products (cached) |

### Cart — `/api/cart`

| Method | Endpoint               | Auth      | Description           |
| ------ | ---------------------- | --------- | --------------------- |
| GET    | `/api/cart`            | Protected | Get user's cart       |
| POST   | `/api/cart`            | Protected | Add item to cart      |
| PUT    | `/api/cart/:productId` | Protected | Update item quantity  |
| DELETE | `/api/cart/:productId` | Protected | Remove item from cart |
| DELETE | `/api/cart`            | Protected | Clear entire cart     |

### Orders — `/api/orders`

| Method | Endpoint                                | Auth         | Rate Limited | Description                  |
| ------ | --------------------------------------- | ------------ | ------------ | ---------------------------- |
| POST   | `/api/orders`                           | Protected    | Yes          | Place a new order            |
| GET    | `/api/orders/my-orders`                 | Protected    | No           | Get current user's orders    |
| GET    | `/api/orders/seller/orders`             | Seller/Admin | No           | Get seller's received orders |
| GET    | `/api/orders`                           | Admin        | No           | Get all orders               |
| GET    | `/api/orders/:id`                       | Protected    | No           | Get order by ID              |
| PUT    | `/api/orders/:id/cancel`                | Protected    | No           | Cancel own order (customer)  |
| PUT    | `/api/orders/:id/status`                | Seller/Admin | No           | Update order status          |
| PUT    | `/api/orders/:id/deliver`               | Protected    | No           | Confirm delivery (customer)  |
| PUT    | `/api/orders/:id/seller-delivery-claim` | Seller/Admin | No           | Seller claims delivery       |
| PUT    | `/api/orders/:id/complete`              | Admin        | No           | Manually complete an order   |

### Payments — `/api/payments`

| Method | Endpoint                | Auth      | Description                         |
| ------ | ----------------------- | --------- | ----------------------------------- |
| POST   | `/api/payments/webhook` | Public    | Paystack webhook (payment callback) |
| POST   | `/api/payments/verify`  | Protected | Verify a payment                    |

### Uploads — `/api/uploads`

| Method | Endpoint       | Auth   | Description                                 |
| ------ | -------------- | ------ | ------------------------------------------- |
| POST   | `/api/uploads` | Seller | Upload product images (multipart, parallel) |

### Admin — `/api/admin`

| Method | Endpoint                                   | Auth  | Description               |
| ------ | ------------------------------------------ | ----- | ------------------------- |
| GET    | `/api/admin/users`                         | Admin | Get all users             |
| GET    | `/api/admin/users/:id`                     | Admin | Get user by ID            |
| PUT    | `/api/admin/users/:id`                     | Admin | Update user details       |
| PUT    | `/api/admin/users/:id/role`                | Admin | Update user role          |
| DELETE | `/api/admin/users/:id`                     | Admin | Delete a user             |
| GET    | `/api/admin/users/:id/products`            | Admin | Get a user's products     |
| POST   | `/api/admin/users/:id/products`            | Admin | Create product for a user |
| PUT    | `/api/admin/users/:id/products/:productId` | Admin | Update a user's product   |
| DELETE | `/api/admin/users/:id/products/:productId` | Admin | Delete a user's product   |
| GET    | `/api/admin/users/:id/orders`              | Admin | Get a user's orders       |

---

## Project Structure

```
server/
├── config/           # DB, Redis, Cloudinary, Paystack configs
├── controllers/      # Route handler logic
├── middlewares/       # Auth, validation, rate limiting, uploads, error handling
├── models/           # Mongoose schemas (User, Product, Cart, Order, Payment)
├── routes/           # Express route definitions
├── utils/            # Helpers (token generation, response builder, Cloudinary URL)
├── validations/      # Zod schemas for input validation
├── server.js         # Entry point
└── .env              # Environment variables
```

---

## Notes

- **Redis is optional.** If Redis is unavailable, the server still runs normally — caching is simply skipped.
- **Token blacklisting** requires Redis. Without it, logout still clears the client-side cookie, but the token remains technically valid until expiry.
- **Body size limit** is set to 50 MB to accommodate base64-encoded image uploads.
