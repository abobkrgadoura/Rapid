# Rapid Logistics � Task Checklist

## Phase 1: Initialize Next.js Project & Install Dependencies

- [x] Create the Next.js App Router project
- [x] Install and configure Tailwind CSS
- [x] Initialize shadcn/ui
- [x] Install the Supabase client packages
- [x] Add environment variable placeholders for Supabase

## Phase 2: Supabase DB Schema & Auth Setup

- [x] Create the `profiles` table and role enum
- [x] Create the `orders` table
- [x] Create the `wallets` and `transactions` tables
- [x] Enable Row Level Security policies for each role
- [x] Configure Supabase Auth and profile creation on signup

## Phase 3: RBAC Middleware & Routing

- [x] Add session-based role resolution
- [x] Protect Admin, Merchant, Driver, and Customer route groups
- [x] Deny access by default when the role does not match the route

## Phase 4: Financial Logic & Wallet System

- [x] Implement COD debit (driver owes product price + platform commission)
- [x] Implement Prepaid credit (platform owes delivery fee ? platform commission)
- [x] Record every balance change as a transaction in the same operation
- [x] Add driver settlement and payout entries
- [x] Batch-scan manifests into picked_up in one database transaction
- [x] Issue and verify a 4-digit prepaid delivery OTP stored on the order
- [x] Add a haversine utility for driver-to-destination distance in meters

## Phase 5: Build UI (Admin, Merchant, Driver, Customer)

Admin, merchant, driver PWA, and public tracking are in place. The user confirmed the end-to-end delivery test passed against a database with 0003 applied, and explicitly moved on to Phase 6. The WhatsApp webhook was not built in Phase 5; it ships in Phase 6 (below).

- [x] Admin dashboard
- [x] Merchant portal
- [x] Driver PWA (QR scanner, maps, wallet)
  - [x] Migration 0003 written: lifecycle timestamps, delivery GPS columns, `start_delivery` / `complete_delivery`, OTP column-grant fix
  - [x] Server actions: start delivery, mark delivered, lookup + confirm delivery orchestration
  - [x] Driver dashboard (wallet header, Pending Pickups, My Deliveries)
  - [x] Simulated QR scanner modal (tracking code, OTP for prepaid, GPS, ledger post)
  - [x] PWA manifest, icons, and mobile viewport
- [x] Customer tracking page
  - [x] Migration 0003 written: `track_order_details` public RPC
  - [x] Vertical timeline and driver details card
- [x] Apply `supabase/migrations/0003_phase5_driver_tracking.sql` to the Supabase project (confirmed by the user)
- [x] Verify the driver delivery flow end to end against a database with 0003 applied (confirmed by the user: end-to-end delivery test successful)
- [x] WhatsApp webhook endpoint (moved to Phase 6, built there)

## Phase 6: Hub & Spoke Logistics, Privacy Controls, Batch Scanning, WhatsApp

Flow: Merchant -> Pickup Driver (batch scan) -> Admin Hub (scan) -> Delivery Driver (scan) -> Customer. `orders.driver_id` is now strictly the delivery driver; `orders.pickup_driver_id` is the pickup driver. A pickup driver never reads customer data.

- [x] Migration `0004_phase6_hub_privacy_gps.sql` written
  - [x] `at_hub` added to `order_status`; `pickup_driver_id`, `pickup_gps_url`, `dropoff_gps_url` on `orders`; `company_name` on `profiles`
  - [x] Order guard / role-ref triggers and the "assigned requires driver" check updated for the two-driver model
  - [x] RPCs: `pickup_merchant_groups`, `scan_pickup_parcel`, `confirm_batch_pickup`, `receive_order_at_hub`, `start_delivery_from_hub`; `complete_delivery` now requires `in_transit`; legacy `start_delivery` / `process_batch_pickup` revoked
- [x] `createOrder` accepts and validates the two GPS links (form + action)
- [x] Smart Pickup Driver UI: merchant-grouped cards (company, address, pending count, Call, Navigate), batch scanner modal ("Scanned N of M"), `confirmBatchPickup`
- [x] Warehouse Hub admin page `/admin/hub` with `receiveOrderAtHub`
- [x] Delivery Driver UI: Pickups / Deliveries tabs, `startDeliveryFromHub` ("Load from Hub"), customer details + COD + dropoff navigate on Deliveries
- [x] WhatsApp webhook route `/api/webhooks/whatsapp` + the four templates, wired to order events (needs `SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_WEBHOOK_SECRET`, `WHATSAPP_VERIFY_TOKEN`; see `.env.example`)
- [x] Code checks: `tsc`, `eslint`, `next build` clean; webhook smoke-tested (auth, validation, all four templates)
- [ ] Apply `supabase/migrations/0004_phase6_hub_privacy_gps.sql` to the Supabase project (the driver page, hub page, and order creation with GPS links fail until it is applied)
- [ ] Verify the hub flow end to end against a database with 0004 applied (needs two driver accounts, one pickup and one delivery, plus an admin; test COD and prepaid)

## Phase 7: Merchant Dashboard Shell & Settings Hub

Started on the user's explicit instruction while two Phase 6 items (apply 0004, hub end-to-end test) are still open. Out of scope by decision: Capital Financing, Tax Invoices, FlexShip, tiered pricing.

- [x] Migration `0005_phase7_merchant_settings.sql` written: `logo_url`, `website_url`, `business_category`, `preferences jsonb` on `profiles`, with validation and a merchant-only write guard
- [x] Merchant shell (`src/app/merchant/layout.tsx` + `MerchantShell`): RTL sidebar with collapse and mobile drawer, top bar (profile menu, notifications, red "+ ????? ?????" CTA)
  - [x] Routes the shell links to exist: `/merchant/orders`, `/merchant/orders/new`, `/merchant/pickups` and `/merchant/wallet` (the last two are "??????" placeholders; merchants have no pickup or wallet data yet)
- [x] Settings Hub (`/merchant/settings`): tabs for company data, shipping preferences, AWB format
- [x] `AwbPreview` component reacting to the A6 / A4 choice
- [x] Server action `updateMerchantProfile` in `src/actions/merchant.ts`
- [x] RTL fixes in shared UI (logical properties in select, dropdown, tabs, switch, button, badge, field, table); Arabic font fallback; `brand` button variant
- [x] Code checks: `tsc`, `eslint`, `next build` clean; shell, tabs, AWB preview (A6 and A4), profile menu and switch checked in the browser
- [ ] Apply `supabase/migrations/0005_phase7_merchant_settings.sql` to the Supabase project (the settings page cannot load or save until it is applied; the SQL has not been run against a database yet)
- [ ] Verify saving all three settings tabs as a merchant against a database with 0005 applied

## Phase 8: Premium Arabic Localization, Smart Form Defaults, and Bosta-Style UI

Started on the user's explicit instruction while Phase 6 (apply 0004, hub end-to-end) and Phase 7 (apply 0005, settings save) are still open. Pickup and return addresses are stored in `profiles.preferences` (migration 0005 already allows unknown JSON keys). No new migration.

- [x] Smart order form: pre-fill pickup and return from the merchant profile, Arabic Bosta layout, toast + redirect to `/merchant/orders`
- [x] Arabic Bosta sign-in, including the forgot-password link (checked in the browser: heading, full-width button, Arabic error, recovery page)
- [x] Post-registration onboarding at `/merchant/onboarding`: expected monthly volume, with the single-shipment card disabled. Merchants who can load preferences and have not chosen a volume are sent there
- [x] AWB A6/A4 bottom band shows the return location from merchant settings
- [x] Dark sidebar kept; navigation grouped like Bosta (create order, overview, shipments, finance, settings)
- [x] Code checks: `tsc` and `eslint` clean. Browser checked sign-in and password recovery, and confirmed `/merchant/onboarding` redirects to login when signed out. The order form, onboarding cards, AWB, and sidebar still need a signed-in merchant session to click through

## Phase 9: Premium Theme, Orders Desk, Settings Parity, AWB

Started on the user's explicit instruction while Phase 6 (apply 0004, hub end-to-end) and Phase 7 (apply 0005, settings save) are still open. No new migration: AWB language/layout, platform language, and team members are unknown JSON keys already allowed by migration 0005. Secondary phone is stored on the existing dropoff lines.

- [x] Premium charcoal / zinc surfaces and deep indigo brand in `globals.css` and `tailwind.config.ts`
- [x] Orders desk: delivery, exchange, and return actions; status tabs; tracking search; customer filter
- [x] Order form: blank customer fields, optional secondary phone, pickup and return from `profiles`
- [x] Settings tabs: platform, shipping, personal, company locations, team, and AWB language plus A4 layout
- [x] AWB sticker: closed black border, large barcode, region, boxed COD, notes, mini barcode, return line
- [x] Code checks: `tsc` and `eslint` clean. Browser confirmed the indigo brand on the sign-in screen. Merchant orders, the order form, settings, and the AWB preview still need a signed-in session in this browser to click through

## Phase 9 corrections: language, order intents, blank customer, AWB sheet

Started on the user's explicit instruction while Phase 6 (apply 0004, hub end-to-end) and Phase 7 (apply 0005, settings save) are still open. No new migration.

- [x] Locale context so the settings language toggle translates the merchant sidebar, buttons, and settings immediately
- [x] Separate delivery, return, and exchange forms on `/merchant/orders/new`
- [x] Customer dropoff starts blank, with an optional secondary phone
- [x] Deep indigo primary and zinc-50 background
- [x] AWB outer black border, five A4 layout radios, A6 portrait and A4 landscape preview
- [x] Code checks: `tsc` and `eslint` clean. Browser confirmed the indigo-900 button and zinc-50 background on the sign-in screen. Merchant order forms, the language toggle, and the AWB preview still need a signed-in merchant session in this browser to click through

## Phase 9.1: Order routing and A4 label canvas

Started on the user's explicit instruction while Phase 6 (apply 0004, hub end-to-end) and Phase 7 (apply 0005, settings save) are still open. No new migration.

- [x] Order rows route to `/merchant/orders/[id]`
- [x] Order detail shows status, customer, product, and timeline
- [x] A4 preview is a true 210�297 mm sheet; four different waybills fill a 2�2 grid
- [x] Code checks: `tsc` and `eslint` clean. Browser measured the A4 canvas at 794�1123 px (210�297 mm) for one, two, and four labels, with the return line inside each sticker. Clicking an order row still needs a signed-in merchant session; signed-out visits to `/merchant/orders/[id]` redirect to login

## Phase 9.3: Distinct landscape A4 label

Started on the user's explicit instruction while Phase 6 (apply 0004, hub end-to-end) and Phase 7 (apply 0005, settings save) are still open. No new migration.

- [x] Keep the portrait 10�15 cm thermal sticker as `A6Label`
- [x] Add a landscape 20�14 cm `A4LandscapeLabel` (barcode and return on the left, COD and parties on the right)
- [x] Place one landscape label on the top half of the 21�29.7 cm sheet, or two stacked so they fill it
- [x] Code checks: `tsc` and `eslint` clean. Browser measured the A4 canvas at 794�1123 px (21�29.7 cm). One landscape label is 756�529 px (20�14 cm) at the top of the sheet. Two identical labels share one tracking code; two different labels use two codes; the pair sits flush to the top and bottom of the sheet. The portrait A6 sticker stays 2:3. Signed-out `/merchant/settings` still redirects to login, so the check used a temporary preview route that was removed afterward

## Phase 9.4: AWB internal grid, address landmark, field separation

Started on the user's explicit instruction while Phase 6 (apply 0004, hub end-to-end) and Phase 7 (apply 0005, settings save) are still open. No new migration.

- [x] Merchant cell shows only the merchant label and the store name
- [x] Dedicated address cell for zone, street, and landmark on both labels
- [x] Package badges for opening the shipment and the piece count
- [x] Rebuild the A6 portrait rows and the A4 landscape columns to that grid
- [x] Code checks: `tsc` and `eslint` clean. Browser confirmed the merchant cell is only the store name, the customer cell is name plus both phones, and the address cell holds zone, street, and landmark. A6 keeps Rapid on the left, the zone in the center, and delivery on the right, with the cut line and page count outside the border. A4 keeps the 20�14 cm landscape label, a rounded frame, the gray collection cell, and the created date above the dashed line. The temporary preview route was removed afterward

## Phase 9.5: AWB visual proportions, QR enlargement, compact spacing

Started on the user's explicit instruction while Phase 6 (apply 0004, hub end-to-end) and Phase 7 (apply 0005, settings save) are still open. No new migration.

- [x] Thin the label frame to 1.5px with rounded corners, and keep internal rules at 1px
- [x] Enlarge the COD amount box on A6 and A4 landscape
- [x] Add a 1px vertical rule between the merchant and customer cells
- [x] Tighten the address and package-description blocks
- [x] Put notes and the order reference on their own row, and place the enlarged QR beside the mini barcode

## Phase 10: Public Customer Tracking Portal and AWB QR Link

Started on the user's explicit instruction while Phase 6 (apply 0004, hub end-to-end), Phase 7 (apply 0005, settings save), and Phase 9.5 (AWB proportions) are still open.

- [x] Migration `0006_phase10_public_tracking.sql` written: `track_order_details` returns only the public fields (no OTP, commission, street address, GPS, or phone)
- [x] Privacy-safe loader in `src/lib/data/tracking.ts` (exact tracking code). Until 0006 is applied, the server builds the same projection and does not send the raw address to the browser
- [x] Public search page `/track`
- [x] Shipment page `/track/[code]` with the five-step timeline, payment summary, and Arabic not-found state
- [x] AWB QR encodes `/track/{code}`
- [x] Login and onboarding "أريد تتبع طلبي" links to `/track`
- [x] Code checks: `tsc` and `eslint` clean. Browser checked `/track` search (invalid code and a real code), a COD card and a prepaid card, the Arabic not-found state, the login link, and the waybill QR payload. Signed-out `/merchant/onboarding` still redirects to login
- [ ] Apply `supabase/migrations/0006_phase10_public_tracking.sql` so anonymous clients can no longer call the old `track_order_details` and receive a driver's phone

## Phase 11: Enterprise Admin Control Tower, Hub Barcode Scanner, Fleet Dispatching, Staff CRUD

Started on the user's explicit instruction while Phase 6 (apply 0004, hub end-to-end), Phase 7 (apply 0005, settings save), and Phase 9.5 (AWB proportions) are still open. Migration `0006` already exists (Phase 10), so this one is `0007`.

- [x] Migration `0007_phase11_staff_management.sql`: `staff_type` enum, `profiles.staff_type / is_active / hub_zone`, privilege guard, inactive accounts lose their role, `returned` order status, admin RPCs (dispatch, status override, deactivate, delete)
- [x] Admin shell: RTL Arabic charcoal/indigo layout ("Rapid — برج المراقبة والعمليات") with the five operational views
- [x] Control Tower KPIs on `/admin` (pending pickup, at hub, out for delivery, delivered, returned/exceptions, active COD)
- [x] Hub barcode station `/admin/hub`: inbound scan, outbound dispatch scan, recently scanned feed
- [x] Orders and bulk dispatching `/admin/orders`: Arabic status tabs, search, bulk assign, inspection drawer with status override
- [x] Staff and fleet management `/admin/staff`: add, edit, deactivate, reactivate, delete (service-role provisioning with a fallback)
- [x] Financials moved to `/admin/finance`
- [x] Code checks: `tsc`, `eslint`, `next build`
- [ ] Apply `supabase/migrations/0007_phase11_staff_management.sql` to the Supabase project (staff pages, dispatching, and the scanner's outbound mode need it)

Note: the Phase 11 screens are written and pass tsc, eslint and next build, but none were exercised against a live database or a signed-in admin session. The 0007 SQL file is written but unapplied and untested, so it stays open until it is applied.

## Phase 11.5: Sudan-First Launch, Admin Settings & KYC

Sudan is the launch country. Egypt is postponed. Currency is SDG (ج.س), phones use +249, and the default geography is Sudanese states and cities.

- [x] Sudan localization: SDG / ج.س, +249 phone validation and placeholders, Khartoum-time and Sudan state/city examples across merchant, admin, tracking, and AWB
- [x] Migration `0008_phase11_5_sudan_kyc.sql`: country code, driver KYC, cash custody ceiling, pickup fee, zone prices, and the pickup-fee rule
- [x] Admin Settings `/admin/settings`: Pricing and Fleet Rules tabs
- [x] Zone pricing matrix (state/city fee in SDG) and the pickup-fee rule (fee when the merchant has fewer than 3 shipments, otherwise 0)
- [x] Driver KYC and cash ceiling on `/admin/staff`: vehicle, emergency phone, cash limit, document placeholders, and the custody bar that blocks new COD orders when the ceiling is exceeded
- [ ] Apply `supabase/migrations/0008_phase11_5_sudan_kyc.sql` to the Supabase project (settings save, KYC columns, and the cash-ceiling block need it)

## Phase 12: Financial Engine & Wallets

Merchant wallets, a company vault, and the Arabic finance screens. Driver cash custody (`current_cash_in_hand`) is separate from the driver wallet balance: settling it receipts the vault and zeros the cash. Merchant payouts debit the merchant ledger.

- [x] Merchant wallet dashboard (`/merchant/wallet`): available, pending COD, total revenue, ledger table, payout request
- [x] Driver settlements (`/admin/finance`): drivers holding cash, `settleDriverCash`
- [x] Merchant payouts (`/admin/finance`): positive merchant balances, `payoutMerchant`
- [x] Money formatting defaults to SDG / ج.س with thousands separators
- [ ] Apply `supabase/migrations/0009_phase12_financial_engine.sql` to the Supabase project (merchant wallets, the vault, settlement, and payout need it)

## Phase 13.1: Order details, AWB sync, merchant pickups, exception proofs

`0009` is the Phase 12 financial engine, so this migration is `0010`. A failed delivery stays on the current order status and is recorded as an attempt (`exception_reason`, `failed_attempts`, `order_exception_logs`) so the existing status machines stay intact.

- [x] Migration `0010_phase13_orders_exceptions_driver_pro.sql`: address and parcel columns, attempt proofs, partial delivery, driver nav/earnings preferences, pickup requests with a handover QR token
- [x] Merchant order form: secondary address, parcel size, pieces, product photo, opening permission, delivery notes vs private notes
- [x] AWB preview composes street + building + floor + apartment, and prints only delivery notes
- [x] Merchant pickups desk: ready and collected-today counts, pickup-fee banner, request pickup, handover QR
- [x] Merchant order page and admin order drawer show WhatsApp, call-log, and door proofs plus partial delivery
- [ ] Apply `supabase/migrations/0010_phase13_orders_exceptions_driver_pro.sql` to the Supabase project (the new order columns, pickup requests, and proof viewer stay empty until it is applied)
- [ ] Run `supabase/repair/0010_0014_idempotent.sql` in the Supabase SQL editor when 0010–0014 columns already exist but the functions, triggers, and policies never landed (`request_merchant_pickup` is what `/merchant/pickups` calls)

## Phase 13.2: Pro Driver PWA

Delivery and pickup driver surfaces on `/driver`: settings, earnings, smart routing, WhatsApp, partial delivery, fortified exception proofs, continuous pickup scan, and a handover QR. Migration `0011` follows `0010`.

- [x] Migration `0011_phase13_2_driver_pro.sql`: proof data-URLs, driver locale and active vehicle, partial-delivery ledger, 60-second / out-of-range attempt flag, pickup fee on merchant groups
- [x] Driver settings drawer (language, maps app, dark mode, alert sound and vibration, active vehicle)
- [x] Deliveries: cash custody, today's earnings, GPS / zone / COD sort, WhatsApp, full and partial handoff
- [x] Fortified exception report (reason, GPS, WhatsApp / call-log / door proofs, suspicious flag)
- [x] Pickups: zone clusters, continuous scanner, digital handover QR
- [x] Suspicious-attempt badge on `/admin` and `/admin/orders`, active vehicle on the staff profile
- [ ] Apply `supabase/migrations/0011_phase13_2_driver_pro.sql` to the Supabase project (settings columns, partial ledger, proof data-URLs, and the tighter attempt flag need it)

## Phase 14: Admin Exception Review & Operations

Arabic driver settings, an admin exceptions desk, and an admin override for customer phone, address, COD, and delivery notes. Status changes and the COD override go through security-definer functions that re-check the admin role.

- [x] Driver settings: show "دراجة نارية" for the motorcycle type, and Arabic copy for the active vehicle heading, its description, and the settings button
- [x] Admin exceptions desk at `/admin/exceptions`: open attempts, proof review, accept (hub or RTO) and reject (clear the flag and alert the driver)
- [x] Admin order edit: phone, address, COD, and delivery notes, written to `order_history`
- [ ] Apply `supabase/migrations/0012_phase14_admin_operations.sql` to the Supabase project (exception review, order edit, history, and driver alerts need it)

## Phase 14.1: Admin Settings (Lang/Theme) & Support System

Started on the user's explicit instruction while earlier "apply migration" items are still open.

- [x] Admin Control Tower language toggle (Arabic RTL / English LTR) and dark/light theme, persisted for the signed-in browser
- [x] Admin navigation, page headers, and primary buttons follow the selected language
- [x] Migration `0013_phase14_1_support_tickets.sql`: `support_tickets` with merchant insert and admin status updates
- [x] Merchant support desk at `/merchant/support`
- [x] Admin support desk at `/admin/support`
- [x] Fix the admin page heading so server pages pass a page name, and the client heading picks the lucide icon itself
- [ ] Apply `supabase/migrations/0013_phase14_1_support_tickets.sql` to the Supabase project (creating and listing tickets need it)

## Phase 16: Live Notification Infrastructure

In-app bell for merchants and admins, plus the Meta Cloud API sender. Started on the user's explicit instruction while earlier "apply migration" items are still open.

- [x] Migration `0014_phase16_notifications.sql`: `notifications` table, own-row select/update RLS, and a trigger that notifies the merchant when an order becomes delivered or returned
- [x] In-app `<NotificationBell />` in the Admin and Merchant headers (unread badge, latest list, mark all as read)
- [x] WhatsApp sender `src/lib/whatsapp-sender.ts`: `sendWhatsAppMessage` and `notifyCustomerOutForDelivery`
- [ ] Apply `supabase/migrations/0014_phase16_notifications.sql` to the Supabase project (the bell stays empty until it is applied)

## Phase 16.2: Automated WhatsApp Triggers & Meta API Wireup

Started on the user's explicit instruction while the Phase 16 "apply 0014" item is still open. `in_transit` is the stored status for خارج للتوصيل. The delivered WhatsApp goes out on the first transition to delivered. The merchant wallet notice is written only after the delivery ledger posts, so a failed post can retry without messaging the customer twice.

- [x] Meta Cloud API sender `src/lib/whatsapp.ts`: `sendWhatsAppTemplateMessage`, with a skip-and-warn path when the token or phone number id is missing
- [x] Helpers `sendOutForDeliveryWhatsApp` and `sendDeliveredWhatsApp`
- [x] `in_transit` (hub load, outbound dispatch, delivery assignment, admin override) sends the out-for-delivery template and inserts the merchant notice "تحديث الشحنة"
- [x] Successful delivery posts the delivered template and a merchant notice that the shipment was delivered and the wallet balance was updated
- [x] `.env.example` lists `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`

## Phase 17: Phone or email sign-in

Merchants and staff can sign in with a phone number and a password. Local Egyptian and Sudanese numbers are stored as E.164. Supabase test phone numbers skip the SMS provider; if confirmation is still required, registration asks for that test code.

- [x] Shared formatter: international `+`, Egypt `010` / `011` / `012` / `015`, Sudan `09` / `01`
- [x] Login accepts a phone number or an email
- [x] Merchant registration with `signUp({ phone, password })`
- [x] Admin staff provisioning accepts a phone, with email optional
- [x] Check the login and registration forms in the browser (staff form still needs a signed-in admin)

## Order phones: Sudan and Egypt

Customer and secondary phones on the order form accept Sudan (+249) and Egypt (+20), so a Meta WhatsApp test number can be entered.

- [x] Accept +249 and +20, plus the matching local forms, on the customer phone and the secondary phone
- [x] Arabic errors name both +249 and +20

## Phase 18: Merchant print AWB and pending-order edit

Print the real waybill from the orders desk, and let a merchant correct a shipment only while it is still `pending`.

- [x] "طباعة البوليصة" on each orders-table row and on the order page, opening `/merchant/orders/[id]/awb`
- [x] "تعديل الطلب" only while status is `pending`: phone, secondary phone, dropoff address, pieces, and COD
- [x] Migration `0015_merchant_pending_order_edit.sql`: merchant update policy limited to pending rows, trigger locks the other money fields, and `merchant_edit_pending_order` re-checks the merchant and the status
- [ ] Apply `supabase/migrations/0015_merchant_pending_order_edit.sql` to the Supabase project (until then the edit action falls back to a pending-only update and does not write `order_history`)

## Mobile touch targets

Started on the user's explicit instruction while earlier "apply migration" items are still open. Phone taps were ignored on controls a desktop mouse could click.

- [x] Keep taps on buttons, tabs, and menu rows: no press-shift, no backdrop-filter on sticky or fixed chrome, 44px targets, icons out of the hit path
