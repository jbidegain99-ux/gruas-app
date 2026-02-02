# Test Users Documentation

## Overview

This document describes the test user setup for Gruas App.

## User Roles

The system supports 4 roles:
- **USER**: End users who request tow services
- **OPERATOR**: Tow truck operators who accept and complete services
- **ADMIN**: System administrators
- **MOP**: Ministry of Public Works (read-only monitoring)

## Creating Test Users

### Via Mobile App Registration

1. Open the app
2. Go to Register
3. Fill in:
   - Email (unique)
   - Password (min 6 characters)
   - Full Name
   - Phone
   - Role: Select "Usuario" or "Operador"
4. Submit

### Via Supabase Dashboard

1. Go to Authentication > Users
2. Create new user with email/password
3. The trigger `on_auth_user_created` will auto-create a profile

### Setting User Metadata (Important for Role)

When creating users via Supabase, include metadata:
```json
{
  "full_name": "Test User",
  "phone": "1234567890",
  "role": "USER"
}
```

## Test Scenarios

### Scenario 1: User Creates Request

1. Login as USER
2. Navigate to "Solicitar Grua"
3. Complete 4-step form:
   - Step 1: Enter pickup and dropoff addresses
   - Step 2: Select tow type (light/heavy) and incident type
   - Step 3: Add vehicle description (optional)
   - Step 4: Review and confirm
4. Expected: Success modal with PIN

### Scenario 2: Operator Accepts Request

1. Login as OPERATOR
2. See pending requests in home screen
3. Tap "Aceptar Servicio"
4. Expected: Request moves to "Active" tab

### Scenario 3: Complete Service Flow

1. Operator accepts request
2. Tap "Voy en Camino" (status -> en_route)
3. Tap "Ya Llegue (Verificar PIN)"
4. Enter 4-digit PIN from user
5. On success, status -> active
6. Tap "Completar Servicio"
7. Expected: Request moves to completed

## Database Verification

### Check Request Created
```sql
SELECT id, status, pickup_address, dropoff_address, tow_type
FROM service_requests
ORDER BY created_at DESC
LIMIT 5;
```

### Check Audit Trail
```sql
SELECT event_type, actor_role, created_at
FROM request_events
WHERE request_id = 'UUID'
ORDER BY created_at;
```

### Check User Profile
```sql
SELECT id, full_name, phone, role
FROM profiles
WHERE id = 'USER_ID';
```

## Important Notes

1. **Operator Provider**: Operators need a `provider_id` to accept requests. Admins must assign this.

2. **PIN Verification**: The PIN is only shown once at request creation. Users must note it.

3. **RLS Policies**: All data access is controlled by Row Level Security. Users can only see their own data.

## Troubleshooting

### "No requests visible for operator"
- Ensure operator has role = 'OPERATOR'
- Check if there are requests with status = 'initiated'
- Verify operator doesn't have an active service already

### "Request creation fails with 23502"
- This was a bug where dropoff coordinates were missing
- Fixed by adding default coordinates when not geocoded

### "Provider ID required"
- Operators need to be assigned to a provider via admin panel
- Without this, they cannot accept requests
