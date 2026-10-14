# TronMarket API

Base URL: `http://localhost:5000/api` (see `.env.example`).
Auth: `Authorization: Bearer <accessToken>`; access tokens live 15 minutes and are
renewed via the httpOnly refresh cookie (`POST /api/auth/refresh`).

## Auth & account
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | Creates an unverified account + email OTP |
| POST | `/auth/verify-otp` | public | Verifies email, starts a session |
| POST | `/auth/login` | public | Returns `requiresTwoFactor` + `pendingToken` when 2FA is on |
| POST | `/auth/2fa/login` | public | Second login step `{ pendingToken, code }` |
| POST | `/auth/google` | public | `{ idToken }`; 503 unless `GOOGLE_CLIENT_ID` is set |
| POST | `/auth/refresh` | cookie | Rotates the refresh session, returns a new access token |
| POST | `/auth/logout` | any | Revokes the refresh session + blacklists the access token |
| GET | `/auth/me` | user | Current session user |
| GET/PUT | `/auth/profile` | user | Profile incl. saved addresses & wishlist ids |
| POST/PUT/DELETE | `/auth/addresses[/:addressId]` | user | Saved address book |
| POST | `/auth/email-change/request` · `/verify` | user | OTP to the new address; applying it rotates all sessions |
| DELETE | `/auth/me` | user | Self-deletion (password required, soft delete) |
| POST | `/auth/2fa/setup` · `/verify` · `/disable` | user | TOTP (authenticator app) management |

## Catalog
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/products` | public | `search` (name/brand/category/description), `category`, `brand`, `min`, `max`, `featured=1`, `sort=newest\|price-asc\|price-desc\|name\|rating`, `page`, `limit` |
| GET | `/products/:id` | public | Owners/admins can preview drafts & unmoderated listings |
| GET | `/products/:id/related` | public | Same category/brand |
| GET | `/products/:id/reviews` | public | Reviews + rating summary |
| POST/DELETE | `/products/:id/reviews[/:reviewId]` | user | One review per user per product; `verifiedPurchase` is derived server-side |
| GET | `/products/seller/low-stock?threshold=5` | seller | Low-stock alerts |
| GET | `/categories` | public | Storefront category list |
| GET/POST | `/wishlist[/:productId/toggle]` | user | Favourites |

## Orders, coupons, returns
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/orders` | user | Accepts `couponCode`; discount + shipping are computed server-side |
| POST | `/coupons/validate` | user | Preview a coupon against the cart subtotal (no redemption) |
| GET/POST | `/orders/:id/return` | user | Read/open a return or dispute for an order |
| GET | `/orders/returns/mine` | user | My return requests |
| PUT | `/orders/:id/status` | seller/admin | `shipped` accepts `carrier` + `trackingNumber` |

## Payouts
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/payouts/mine` | seller | Earned / paid out / outstanding + history |
| GET | `/payouts` | admin | All seller balances + payout history |
| POST | `/payouts/:sellerId/mark-paid` | admin | Records a payout against delivered earnings |

## Admin (`/api/admin`, admin only)
`GET /analytics` (revenue series, top products/sellers, queue counts) ·
`GET/PATCH /moderation[/:id]` (product approval queue) ·
`GET/POST/PUT/DELETE /coupons[/:id]` ·
`GET /returns` + `PATCH /returns/:id` (`decision: approve|reject|refund`) ·
`GET /refunds` (refund queue) ·
`POST /categories`, `PUT/DELETE /categories/:id` ·
`PATCH /users/:id/seller-verified` (verification badge) ·
`POST /products/bulk` (`activate|deactivate|draft|feature|unfeature|delete`) ·
`GET /exports/orders.csv|products.csv|users.csv` ·
existing users/orders/seller-applications/audit-logs endpoints.
