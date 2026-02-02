# Lessons Learned - Gruas App Development

## Session: 2026-02-02

### Bug Fix: Error 23502 NOT NULL Violation

**Issue**: Request creation showed success modal but failed with database error 23502.

**Root Cause**:
1. Frontend (`request.tsx`) was NOT sending `p_dropoff_lat` and `p_dropoff_lng` parameters
2. RPC `create_service_request()` expected these parameters
3. Table `service_requests` has `dropoff_lat` and `dropoff_lng` as NOT NULL columns
4. Result: Insert fails due to NULL in NOT NULL column

**Lesson**: Always verify parameter names match between:
- Frontend call
- RPC function signature
- Database table schema

**Fix Applied**:
- Added `dropoffCoords` state to frontend
- Pass `p_dropoff_lat` and `p_dropoff_lng` in RPC call
- Use default San Salvador coordinates (13.6929, -89.2182) when not geocoded

---

### Bug Fix: Operator Not Seeing Requests

**Issue**: Operator home screen showed "No hay solicitudes disponibles" even when requests existed.

**Root Cause**:
1. Frontend called RPC with `{ p_operator_id: user.id }`
2. RPC `get_available_requests_for_operator()` accepts NO parameters (uses `auth.uid()` internally)
3. Passing unexpected parameter caused silent failure

**Lesson**: Read function signatures carefully. If RPC uses `auth.uid()`, don't pass user ID as parameter.

**Fix Applied**:
- Removed `p_operator_id` parameter from RPC call
- Added error logging for debugging

---

### Bug Fix: Incorrect Event Insert Schema

**Issue**: Manual event insert in operator code used wrong field names.

**Root Cause**:
- Code used `created_by` instead of `actor_id`
- Code used `metadata` instead of `payload`
- Code used string `'assigned'` instead of enum `'OPERATOR_ACCEPTED'`

**Lesson**:
1. Check actual table schema before writing inserts
2. DB triggers often handle audit logging - check if manual insert is needed
3. In this case, `log_service_request_changes()` trigger auto-logs status changes

**Fix Applied**:
- Removed manual insert (trigger handles it)
- Added comment explaining auto-logging

---

### Architecture: RLS Policies

**Learning**: Supabase RLS is powerful but requires careful policy design.

**Key Patterns Used**:
1. Users see only their own data: `auth.uid() = user_id`
2. Operators see pending + their assigned: Multiple policies with `OR` conditions
3. Admins bypass via EXISTS subquery check
4. MOP has read-only access via SELECT policy only

**Gotcha**: RPC functions with `SECURITY DEFINER` bypass RLS - use carefully.

---

### UX: Error Handling in Modals

**Issue**: Success modal showed before verifying actual success.

**Lesson**:
1. Check `error === null` first
2. Also verify `data.success === true` for RPCs that return status
3. Handle both network errors (catch) and API errors (response)
4. Provide clear retry option

**Pattern Applied**:
```typescript
if (error) {
  Alert.alert('Error', error.message, [{ text: 'Reintentar' }]);
  return;
}
if (!data || data.success !== true) {
  Alert.alert('Error', 'Operation failed');
  return;
}
// Only now show success
Alert.alert('Success', 'Operation completed');
```

---

### Code Organization: Shared Types

**Learning**: Using `@gruas-app/shared` package for types ensures consistency.

**Types Defined**:
- `UserRole`
- `TowType`
- `ServiceRequestStatus`
- `RequestEventType`
- All entity interfaces

**Benefit**: Changes in one place propagate to all apps.

---

### Real-time Updates

**Pattern**: Supabase Channels for live updates.

```typescript
const channel = supabase
  .channel('channel-name')
  .on('postgres_changes', { event: '*', table: 'service_requests' }, callback)
  .subscribe();

// Cleanup
return () => supabase.removeChannel(channel);
```

**Gotcha**: Channel name must be unique per subscription.

---

## Rules to Follow

1. **Verify RPC signatures** before calling - parameters must match exactly
2. **Check NOT NULL columns** when debugging insert errors
3. **Use DB triggers** for audit logging rather than manual inserts
4. **Test error paths** - not just happy path
5. **Default values** for optional location data (use city center)
6. **Keep UI honest** - only show success when truly successful
7. **Clean up subscriptions** to prevent memory leaks
8. **Use const** over let when variable isn't reassigned (ESLint enforces)
9. **Match field names** between frontend and backend exactly
10. **Document test scenarios** for QA reproducibility
