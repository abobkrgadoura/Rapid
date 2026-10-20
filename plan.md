# Rapid Logistics — System Architecture

Gig-economy logistics and shipping platform. Merchants create shipments, freelance and in-house drivers fulfill them, customers track delivery, and the platform settles cash and earnings through a driver wallet.

Stack: Next.js App Router, Tailwind CSS, shadcn/ui, Supabase (Auth, Postgres, Row Level Security).

## Roles

| Role | Who | Access |
| --- | --- | --- |
| Admin | Platform owner | Users, orders, wallets, settlements, commission settings, webhooks |
| Merchant | Shipper / store | Create and manage their own shipments, view fees and status |
| Driver | Courier | Assigned jobs, QR proof of pickup/delivery, maps, personal wallet. `employment_type` is `freelance` or `in_house` |
| Customer | Recipient | Public tracking page for their shipment only |

Freelance and in-house drivers share the `driver` role. Both use the same wallet rules. Employment type is stored on the profile for payroll and reporting; it does not bypass RBAC.

Authorization is deny-by-default. The session determines the role. Supabase RLS and Next.js middleware both enforce it.

## Financial engine

Each order stores three money components:

- **Product price** — belongs to the merchant.
- **Delivery fee** — gross shipping charge.
- **Platform commission** — the platform’s cut, taken from the delivery fee.

Driver earning on an order:

```text
driver_earning = delivery_fee - platform_commission
```

Cash the driver collects on a COD order:

```text
cash_collected = product_price + delivery_fee
```

### Wallet sign convention

One wallet per driver. Balance is a signed amount.

- **Positive** — platform owes the driver.
- **Negative** — driver owes the platform.
- **Zero** — settled.

### COD — driver owes the platform

The driver holds the cash. They keep their earning in that cash and must hand the rest to the platform (product price for the merchant, plus commission).

```text
driver_owes = product_price + platform_commission
```

Check: `cash_collected - driver_owes = driver_earning`.

Wallet effect: debit by `driver_owes`. A transaction row records the debt. When the driver settles cash with the platform, a settlement transaction credits the wallet back toward zero.

The platform then remits `product_price` to the merchant and retains `platform_commission`.

### Prepaid — platform owes the driver

The customer has already paid. The driver collects no cash. The platform pays the driver their net earning.

```text
platform_owes_driver = delivery_fee - platform_commission
```

Wallet effect: credit by `platform_owes_driver`. A payout transaction later debits the wallet back toward zero when the platform pays the driver.

### Ledger rule

Every balance change is one wallet update plus one transaction (order reference, type, signed amount, balance after). Types: `cod_debt`, `prepaid_earning`, `settlement`, `payout`, `adjustment`.

## Core features

- **Merchant portal** — create shipments, set product price and payment type (COD or prepaid), print/share the tracking reference, follow order status.
- **Driver PWA** — assigned stops, QR scan for pickup and delivery proof, map view of the route, wallet balance and transaction history. Installable, mobile-first.
- **Admin dashboard** — user and role management, live orders, commission configuration, wallet balances, settlement and payout actions.
- **Customer tracking page** — public status timeline looked up by tracking code. No account required to view that shipment’s status.
- **WhatsApp webhooks** — inbound provider callbacks update order status and notify the merchant or customer. Verify signatures and treat the webhook as untrusted input.

## Database schema

Supabase Auth owns credentials. `profiles` is the app user record, keyed by `auth.users.id`.

### profiles (Users)

| Column | Notes |
| --- | --- |
| id | UUID, PK, FK to `auth.users` |
| role | `admin` \| `merchant` \| `driver` \| `customer` |
| employment_type | `freelance` \| `in_house` \| null (drivers only) |
| full_name | |
| phone | |
| email | |
| created_at | |

### orders

| Column | Notes |
| --- | --- |
| id | UUID, PK |
| tracking_code | Unique public reference |
| merchant_id | FK profiles |
| customer_id | FK profiles, nullable |
| driver_id | FK profiles, nullable until assigned |
| status | created, assigned, picked_up, in_transit, delivered, cancelled |
| payment_type | `cod` \| `prepaid` |
| product_price | Numeric |
| delivery_fee | Numeric |
| platform_commission | Numeric |
| pickup_address | |
| dropoff_address | |
| created_at | |

### wallets

| Column | Notes |
| --- | --- |
| id | UUID, PK |
| driver_id | FK profiles, unique |
| balance | Signed numeric. Positive = platform owes driver |
| currency | Default `EGP` |
| updated_at | |

### transactions

| Column | Notes |
| --- | --- |
| id | UUID, PK |
| wallet_id | FK wallets |
| order_id | FK orders, nullable for settlement, payout, adjustment |
| type | `cod_debt` \| `prepaid_earning` \| `settlement` \| `payout` \| `adjustment` |
| amount | Signed numeric, same sign as the balance change |
| balance_after | Snapshot after this row |
| created_at | |

RLS: merchants read and insert their own orders; drivers read orders assigned to them and their own wallet and transactions; customers read tracking by code through a narrow policy or a security-definer function; admins read and write all rows. Wallet writes happen only through a server-side function that inserts the transaction in the same database operation.
