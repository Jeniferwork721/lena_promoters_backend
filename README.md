# Lena Promoters — REST API Backend

Production-ready backend API service for the **Lena Promoters** Flutter application. Built with **Node.js, Express, and MySQL (`mysql2`)**.

---

## 🚀 Tech Stack Selection & Architecture

| Layer | Technology | Why This Stack? |
|---|---|---|
| **Runtime** | **Node.js (v20+)** | High-performance asynchronous non-blocking I/O, perfect for handling mobile API requests concurrently. |
| **Framework** | **Express.js** | Lightweight, robust, industry standard for RESTful microservices. |
| **Database** | **MySQL (`mysql2` pool)** | Ideal for financial transactions (₹500 lucky draw coupons, sequential numbers like `LENA-LD-8801`, plot bookings, staff audit trails). |
| **Authentication** | **JWT & Bcrypt** | Secure stateless token-based authorization for employee/staff portal. |
| **File Storage** | **Multer Disk Storage** | Upload and serve payment receipts and property media. |

---

## 📁 Project Structure

```
lena_promoters_backend/
├── src/
│   ├── config/
│   │   └── db.js                 # MySQL2 connection pool & auto table creator / seeder
│   ├── controllers/
│   │   ├── auth.controller.js     # Staff login, OTP generation, password setup
│   │   ├── property.controller.js # Plots catalog, filtering, and CRUD
│   │   ├── coupon.controller.js   # ₹500 Mega Land Lucky Draw coupon workflows
│   │   ├── siteVisit.controller.js# Site visit bookings with driver allocations
│   │   └── upload.controller.js   # Payment receipts & property brochure uploads
│   ├── middlewares/
│   │   ├── auth.middleware.js     # JWT bearer token & role verifier
│   │   ├── upload.middleware.js   # Multer file size & MIME type validation
│   │   └── errorHandler.js        # Global JSON error handler
│   ├── routes/
│   │   ├── auth.routes.js         # /api/v1/auth
│   │   ├── property.routes.js     # /api/v1/properties
│   │   ├── coupon.routes.js       # /api/v1/coupons
│   │   ├── siteVisit.routes.js    # /api/v1/site-visits
│   │   ├── upload.routes.js       # /api/v1/uploads
│   │   └── index.js               # Root API router
│   ├── scripts/
│   │   └── seed.js                # Manual seed utility
│   └── utils/
│       └── couponGenerator.js     # Atomic coupon generator (e.g. LENA-LD-8805)
├── uploads/
│   ├── receipts/                  # Payment screenshots uploaded by staff
│   └── properties/                # Property images and brochures
├── .env                           # Environment configuration
├── .env.example                   # Template configuration
├── package.json                   # Dependencies & npm scripts
├── schema.sql                     # Standalone SQL schema for cPanel/Workbench
└── server.js                      # Application entry point
```

---

## ⚡ Quick Start

### 1. Install Dependencies
```bash
cd "c:\Users\JENIFER\Flutter projects\lena_promoters_backend"
npm install
```

### 2. Configure Environment (`.env`)
Open `.env` and verify your MySQL credentials:
```env
PORT=5000
NODE_ENV=development

DB_HOST=localhost
DB_USER=root
DB_PASS=
DB_NAME=lena_promoters_db
DB_PORT=3306

JWT_SECRET=lena_promoters_jwt_secret_key_2026_super_secure
BASE_URL=http://localhost:5000
```
*(If using remote MySQL like Hostinger or AWS, update `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME` accordingly).*

### 3. Start Development Server
```bash
npm run dev
# or production mode:
npm start
```

> **Auto-Seeding**: Upon initial launch, the backend automatically creates all database tables and seeds sample staff accounts, real estate plots, active ₹500 lucky draw schemes, and sample coupons!

---

## 📡 API Reference Summary

### 1. Authentication & Staff Portal (`/api/v1/auth`)
- `POST /api/v1/auth/staff/login` — Staff password login (`emailOrPhone`, `password`)
  - **Default seeded staff**: `9840123456` or `staff@lenapromoters.com` | Password: `LenaStaff@2026`
- `POST /api/v1/auth/staff/send-otp` — Dispatches 4-digit OTP (`emailOrPhone`, `purpose`)
- `POST /api/v1/auth/staff/verify-otp-login` — OTP staff login (`emailOrPhone`, `otp`)
- `POST /api/v1/auth/staff/register-password` — Activate account and set password with OTP
- `GET /api/v1/auth/staff/profile` — Get authenticated staff profile *(Requires Bearer Token)*

### 2. Real Estate Plots (`/api/v1/properties`)
- `GET /api/v1/properties` — List plots with query filters (`city`, `search`, `isFeatured`)
- `GET /api/v1/properties/cities` — List all distinct cities / layout locations
- `GET /api/v1/properties/:id` — Single plot details
- `POST /api/v1/properties` — Create plot listing *(Staff/Admin)*
- `PUT /api/v1/properties/:id` — Update plot listing *(Staff/Admin)*
- `DELETE /api/v1/properties/:id` — Delete plot listing *(Admin only)*

### 3. ₹500 Mega Land Lucky Draw (`/api/v1/coupons`)
- `GET /api/v1/coupons/schemes` — Active lucky draw details (₹500 fee, 1,200 sq.ft plot bumper prize, ₹500 gift kit)
- `POST /api/v1/coupons/customer-apply` — Customer submits entry *(Auto-generates coupon number like `LENA-LD-8803`, status = `PENDING_STAFF_VERIFICATION`)*
- `GET /api/v1/coupons/staff/entries` — Staff dashboard metrics (`totalEntries`, `pendingCount`, `verifiedCount`, `totalCollected`) + filtered coupons list *(Staff Bearer Token required)*
- `GET /api/v1/coupons/details/:id` — Single coupon lookup by ID or coupon number
- `PUT /api/v1/coupons/staff/:id/edit-and-verify` — Staff updates details, attaches `staffName`, `staffId`, `paymentTransId`, `paymentScreenshotUrl`, and marks status `VERIFIED_AND_PAID`
- `POST /api/v1/coupons/staff/direct-entry` — Direct walk-in entry created by staff

### 4. Site Visits (`/api/v1/site-visits`)
- `POST /api/v1/site-visits` — Customer schedules visit with optional AC cab pickup
- `GET /api/v1/site-visits/by-phone/:phone` — Customer's booked visits
- `GET /api/v1/site-visits` — Staff list of all scheduled visits
- `PATCH /api/v1/site-visits/:id/status` — Assign driver/vehicle or update status

### 5. Media & Receipts (`/api/v1/uploads`)
- `POST /api/v1/uploads/receipt` — Uploads customer payment screenshot (`multipart/form-data`, key: `receipt`)
- `POST /api/v1/uploads/property-media` — Uploads property layout or brochure (`multipart/form-data`, key: `media`)

---

## 📱 Flutter Client Integration Example

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

class LenaApiService {
  // Use 10.0.2.2 for Android Emulator or your PC's local LAN IP for physical device
  static const String baseUrl = 'http://10.0.2.2:5000/api/v1';

  // 1. Customer Lucky Draw Application
  static Future<Map<String, dynamic>> applyLuckyDraw({
    required String name,
    required String dob,
    required String phone,
    required String address,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/coupons/customer-apply'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'customerName': name,
        'dateOfBirth': dob,
        'phoneNumber': phone,
        'address': address,
      }),
    );
    return jsonDecode(response.body);
  }

  // 2. Staff Login
  static Future<Map<String, dynamic>> staffLogin(String emailOrPhone, String password) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/staff/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'emailOrPhone': emailOrPhone,
        'password': password,
      }),
    );
    return jsonDecode(response.body);
  }
}
```
