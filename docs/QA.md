# QA Testing Guide - Gruas App El Salvador

## Overview

This document provides comprehensive testing instructions for the Gruas App platform, covering the web admin portal, MOP portal, and mobile application.

## Test Accounts

Create these test users in Supabase for testing:

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| ADMIN | admin@test.com | testpassword123 | Full system access |
| MOP | mop@test.com | testpassword123 | Audit/oversight access |
| OPERATOR | operator@test.com | testpassword123 | Assign to a provider |
| USER | user@test.com | testpassword123 | Standard user |

## Web Application Testing

### 1. Landing Page (/)

- [ ] Page loads with "Gruas App" branding
- [ ] "El Salvador" subtitle visible
- [ ] "Iniciar Sesión" button navigates to /login
- [ ] "Registrarse" button navigates to /register
- [ ] Responsive design works on mobile viewports

### 2. Authentication

#### Login (/login)
- [ ] Email field accepts input
- [ ] Password field masks input
- [ ] Empty form shows validation errors
- [ ] Invalid credentials show error message
- [ ] Successful login redirects based on role:
  - ADMIN → /admin
  - MOP → /mop
  - USER → /
  - OPERATOR → /

#### Register (/register)
- [ ] All fields visible: Name, Email, Phone, Password
- [ ] Validates required fields
- [ ] Validates email format
- [ ] Password minimum length enforced
- [ ] Successful registration creates user profile
- [ ] Auto-login after registration

### 3. Admin Portal (/admin)

#### Dashboard
- [ ] Shows key statistics (total users, active requests, etc.)
- [ ] Sidebar navigation works
- [ ] User info displayed in sidebar

#### Providers (/admin/providers)
- [ ] Table displays all providers
- [ ] "Agregar Proveedor" button opens form
- [ ] Can create new provider with:
  - Name (required)
  - Tow type (light/heavy/both)
  - Contact phone
  - Contact email
  - Address
- [ ] Can edit existing provider
- [ ] Can toggle provider active/inactive status
- [ ] Can delete provider (with confirmation)

#### Requests (/admin/requests)
- [ ] Table displays service requests
- [ ] Status badges show correct colors
- [ ] Sortable by date

#### Pricing (/admin/pricing)
- [ ] Table displays pricing rules
- [ ] Shows all pricing components:
  - Base exit fee
  - Included km
  - Price per km (light)
  - Price per km (heavy)
- [ ] "Activar" button only shows for inactive rules
- [ ] Only one rule can be active at a time
- [ ] Clicking "Activar" atomically activates rule
- [ ] Loading state shown during activation
- [ ] "Nueva Tarifa" button opens form
- [ ] Can edit existing rules

#### Users (/admin/users)
- [ ] Table displays all users
- [ ] Shows user avatar (first letter)
- [ ] Shows role with color badge
- [ ] Shows assigned provider for operators
- [ ] "Editar Rol" opens modal
- [ ] Can change user role
- [ ] Provider dropdown appears when selecting OPERATOR role
- [ ] Provider assignment required for operators
- [ ] Stats cards show role counts

### 4. MOP Portal (/mop)

#### Dashboard
- [ ] Basic stats visible
- [ ] Green branding (emerald)

#### Requests (/mop/requests)
- [ ] Table displays all service requests
- [ ] Status filter buttons work:
  - Todas
  - Pendiente
  - Asignada
  - En Camino
  - Activa
  - Completada
  - Cancelada
- [ ] "Ver Detalle" opens modal
- [ ] Detail modal shows:
  - Request ID
  - Status
  - User info
  - Pickup/dropoff addresses
  - Price
  - Distance
  - Timestamps
- [ ] Audit trail shows event history with:
  - Event type (labeled in Spanish)
  - Timestamp
  - Actor name
  - Metadata (if any)
- [ ] Timeline visual connects events
- [ ] Modal closes with X button

## Mobile Application Testing

### 1. Welcome Screen

- [ ] "Gruas App" logo/title visible
- [ ] "Iniciar Sesión" button works
- [ ] "Registrarse" button works

### 2. Authentication

- [ ] Login flow matches web
- [ ] Register flow matches web
- [ ] Role-based routing:
  - OPERATOR → Operator screens
  - USER → User screens

### 3. User Flow

#### Home Screen
- [ ] Shows greeting with user's first name
- [ ] If no active request:
  - Shows CTA card "Solicitar Grúa"
  - Shows info cards (Rápido, Precios Justos)
- [ ] If active request:
  - Shows status badge with correct color
  - Shows incident type
  - Shows tow type
  - Shows addresses
  - Shows operator name when assigned
  - Shows PIN when status is "en_route"
  - Shows price estimate
- [ ] Pull-to-refresh updates data
- [ ] Real-time updates when request status changes

#### Request Service (4-step wizard)
**Step 1: Location**
- [ ] "Usar mi ubicación actual" button requests permissions
- [ ] Gets GPS coordinates
- [ ] Shows reverse-geocoded address
- [ ] Manual address input works
- [ ] Destination address input works
- [ ] "Siguiente" disabled until both addresses filled

**Step 2: Service Type**
- [ ] Light/Heavy toggle selection
- [ ] Incident type grid with 8 options
- [ ] Selection required to proceed

**Step 3: Vehicle Details**
- [ ] Optional vehicle description field
- [ ] Optional notes field
- [ ] "Tomar Foto" opens camera
- [ ] "Galería" opens image picker
- [ ] Photo preview shown

**Step 4: Summary**
- [ ] Shows all entered data
- [ ] Shows estimated price (from pricing rules)
- [ ] Shows estimated distance
- [ ] "Confirmar Solicitud" creates request via RPC
- [ ] Generates 4-digit PIN
- [ ] Success alert with request ID
- [ ] Navigates to home showing active request

#### History Screen
- [ ] Lists past completed/cancelled requests
- [ ] Shows key details per request

### 4. Operator Flow

#### Available Requests
- [ ] Shows greeting with operator name
- [ ] If no active service:
  - Lists available requests
  - Each card shows:
    - Tow type badge
    - Time since creation
    - Incident type
    - Pickup/dropoff addresses
    - Customer name
  - "Aceptar Servicio" button
- [ ] If has active service:
  - Shows message about active service
  - "Ver Servicio Activo" button
- [ ] Pull-to-refresh updates list
- [ ] Real-time updates when new requests appear

#### Active Service
- [ ] Progress indicator shows 3 steps
- [ ] Service card shows:
  - Incident type
  - Tow type badge
  - Pickup address (tappable for maps)
  - Dropoff address (tappable for maps)
  - Vehicle description (if any)
  - Notes (if any)
  - Client name
  - "Llamar" button
  - Price estimate

**Status Progression:**
- [ ] **Assigned**: "Voy en Camino" button (purple)
  - Confirmation dialog
  - Updates status to en_route
- [ ] **En Route**: "Ya Llegué" button (blue)
  - Opens PIN verification modal
  - 4-digit input
  - Validates against stored PIN
  - Wrong PIN shows error
  - Correct PIN updates status to active
- [ ] **Active**: "Completar Servicio" button (green)
  - Confirmation dialog
  - Updates status to completed
  - Sets completed_at timestamp
  - Shows success alert
  - Returns to available requests

#### Maps Navigation
- [ ] Tapping address opens Google Maps with destination

#### Call Customer
- [ ] "Llamar" button opens phone dialer
- [ ] Shows error if no phone number

### 5. Real-time Updates

- [ ] User home updates when operator accepts request
- [ ] User sees status changes in real-time
- [ ] Operator list updates when new requests created
- [ ] Both apps use Supabase Realtime

## Database Verification

### After Seed Data Applied
```sql
-- Verify providers
SELECT id, name, tow_type_supported, is_active FROM providers;
-- Expected: 3 providers

-- Verify pricing rules
SELECT id, name, base_exit_fee, is_active FROM pricing_rules;
-- Expected: 2 rules, 1 active

-- Verify profiles have correct roles
SELECT id, email, role, provider_id FROM profiles;
```

### After User Actions
```sql
-- Verify service request created with PIN
SELECT id, status, verification_pin, user_id FROM service_requests
ORDER BY created_at DESC LIMIT 1;

-- Verify audit events logged
SELECT * FROM request_events WHERE request_id = '<id>'
ORDER BY created_at;
```

## E2E Tests

Run Playwright tests:
```bash
cd apps/web
pnpm test:e2e
```

Test files:
- `e2e/example.spec.ts` - Basic page loads
- `e2e/admin.spec.ts` - Admin portal tests
- `e2e/mop.spec.ts` - MOP portal tests

## Common Issues & Troubleshooting

### Login returns 406 error
- Profile doesn't exist for user
- Run trigger to auto-create profiles on signup
- Or manually insert profile

### Pricing activation fails
- Check RLS policies allow admin updates
- Verify user has ADMIN role in profiles table

### Mobile location permission denied
- Must accept location permission
- Check device settings

### Real-time updates not working
- Verify Supabase Realtime is enabled
- Check RLS policies allow SELECT

### PIN verification fails
- Ensure PIN is exactly 4 digits
- PIN is stored in verification_pin column
- Check operator is entering correct PIN from user

## Performance Checklist

- [ ] Page loads under 3 seconds
- [ ] Tables paginate large datasets
- [ ] Images optimized/lazy loaded
- [ ] API calls debounced where appropriate
- [ ] Real-time subscriptions cleaned up on unmount

## Security Checklist

- [ ] All admin routes require ADMIN role
- [ ] All MOP routes require MOP or ADMIN role
- [ ] RLS policies enforce data access
- [ ] No sensitive data in client-side storage
- [ ] HTTPS enforced in production
- [ ] PIN hashing in production (bcrypt)
