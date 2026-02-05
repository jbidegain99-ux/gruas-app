# GruasApp Phase 2 - Bug Fixes Plan (Updated)

## Diagnosis Summary - CRITICAL ISSUE FOUND

The frontend code exists and is correct, BUT **the Supabase RPC functions were never created in the database**.

Errors seen:
- `PGRST202: Could not find the function public.rate_service`
- `PGRST202: Could not find the function public.send_message`
- `PGRST202: Could not find the function public.upsert_operator_location`

**Root Cause:** Migrations were defined in code but never applied to production Supabase.

---

## Solution: Run Migration in SQL Editor

**File:** `supabase/migrations/00019_fix_missing_rpcs.sql`

This migration creates:
1. `rate_service(p_request_id, p_stars, p_comment)` - For rating services
2. `send_message(p_request_id, p_message)` - For chat messages
3. `upsert_operator_location(p_lat, p_lng, p_is_online)` - For GPS tracking

**How to apply:**
1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `supabase/migrations/00019_fix_missing_rpcs.sql`
3. Run the SQL

---

## Frontend Fix: Rating Modal Loop

**Problem:** When user taps "Omitir", the modal closes but reappears because `fetchActiveRequest` finds the same unrated request.

**Fix Applied:**
- Added `dismissedRatingRequests` ref to track dismissed request IDs
- Check this set before showing modal
- Add request ID to set when user taps "Omitir"

**File:** `apps/mobile/app/(user)/index.tsx`

---

## Execution Status

1. [x] Read frontend files to understand RPC parameters
2. [x] Create migration file with all 3 RPCs
3. [x] Fix rating modal loop in frontend
4. [x] TypeScript verification passed
5. [ ] **USER ACTION REQUIRED:** Run SQL migration in Supabase
6. [ ] Test all features end-to-end
