# Gruas App - Product Requirements Document (El Salvador)

## 1. Vision

Create a mixed platform (State + private providers) to request tow truck services via app, assign operators by zone using real-time GPS, enable map tracking, user-operator communication, PIN-controlled status changes, dynamic pricing calculation, and complete audit trail.

## 2. Product Objective

- Reduce response times and friction (100% digital request)
- Increase traceability and control (audit per event)
- Enable mixed operation: MOP informed + integrated private providers

## 3. Roles (4)

### User (Usuario final)
- Creates account, validates identity (DUI/license)
- Requests service, tracks tow truck
- Chat/call with operator
- 4-digit PIN to activate service
- History and ratings

### MOP (Ministry of Public Works)
- Views list of services/requests
- Receives WhatsApp notification with summary (notification only, no approval required)

### Operator (Operador de grúa)
- App with GPS on
- Sees requests by zone
- Chooses which to attend
- Changes status
- Can cancel

### Admin
- Web panel to manage everything
- Providers, dynamic pricing rules
- Audit, forced cancellation/separation

## 4. MVP Scope

### A) Identity and Profile (End User)
- Registration/login
- Profile must include DUI + DUI photo or license for reuse in each request
- Document upload: ID and vehicle circulation card (photo)

### B) Create Service Request
- Form saves:
  - Location (pickup) + destination (dropoff)
  - Vehicle data (optional plate) + circulation card photo
  - Incident/accident type (text or catalog)
  - Attachments (ID + circulation)
- Request created in "pending" queue by zone

### C) Zone Queue + Operator Selection
- Requests enter "pending" segmented by location
- Operator with GPS sees zone requests and chooses which to attend

### D) Assignment + Tracking + Communication
- On accept, user sees assigned tow truck and real-time map tracking
- In-app chat user-operator + call button (MVP: direct call; pro version: masking)

### E) Status + PIN (Operational Security)
Base states required:
- `initiated` (iniciado)
- `active` (activo)
- `completed` (completado)

Key rule: To change to active, operator must enter 4-digit PIN provided by end user.

### F) Distances and Billing (Dynamic)
Calculate distance:
- tow truck → pickup
- pickup → dropoff

Pricing: exit fee $60 + first 25km, 2 tow types: light/heavy.
All values must be parameterizable in Admin (no hardcode).

Tracking:
- Leg 1: realtime (arrival)
- Leg 2: no realtime needed; only record final distance/time

### G) Cancellations
- If tow truck "never arrives", operator can cancel and user returns to queue for new tow
- If operator cannot cancel (emergency), Admin can cancel/separate from portal

### H) Admin Web Portal
- Manage providers
- Manage dynamic pricing rules
- View requests, statuses, and audit (timeline per request)
- Force cancellations/separation
- Basic exportable reports (CSV)

### I) MOP Portal + WhatsApp
- MOP Portal: list of attended/created requests
- WhatsApp notification to MOP with case summary (card format). No authorization required, informational only.

## 5. Non-Functional Requirements

- **Security**: RLS mandatory; private documents; PIN never in plain text
- **Traceability**: every change creates audited event
- **Real-time**: tracking and chat with low latency
- **Initial Scalability**: MVP with Supabase + Vercel without complex infra
- **Observability**: function logs + error tracking (Sentry recommended)

## 6. Business Rules

### Pricing (Parameterizable)
- `exit_fee` (default 60)
- `included_km` (default 25)
- `km_rate_light`
- `km_rate_heavy`
- `currency` USD

### Assignment
- MVP: operator chooses and accepts
- (Optional future): auto-assignment by proximity + rating

### PIN
- Generate 4-digit PIN when creating request
- Save hash (bcrypt/argon2)
- Validate server-side before allowing active state

## 7. Data Model (Minimum)

### Tables (Supabase Postgres):
- `profiles` (role, DUI, name, phone)
- `service_requests`
- `request_events` (audit)
- `request_messages` (chat)
- `operator_locations` (last location)
- `providers`
- `pricing_rules`
- `ratings`

### Storage Buckets:
- `id-documents`
- `vehicle-documents`

## 8. Definition of Done (DoD)

- CI green: lint + typecheck + tests
- Deploy on Vercel (web) working
- Supabase migrations applied + minimum seed
- E2E flows demonstrable:
  - User creates account + uploads ID/circulation + creates request + sees status
  - Operator sees zone list + accepts + tracking on user side
  - Chat works
  - Incorrect PIN does NOT activate; correct PIN DOES activate
  - Complete calculates leg 2 distance + total pricing with admin rules
  - Operator cancellation re-queues; admin forces cancel
  - MOP sees list + receives WhatsApp summary
- `/docs/evidence` folder with evidence (screenshots + logs + test results)
