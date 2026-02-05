# GruasApp Phase 2 - Bug Fixes Plan

## Diagnosis Summary

After reviewing the code, all Phase 2 features ARE implemented in the codebase:
- `apps/mobile/app/(user)/index.tsx` - Contains ETA, Chat, and Rating integrations
- `apps/mobile/components/RatingModal.tsx` - Rating component exists
- `apps/mobile/components/ChatScreen.tsx` - Chat component exists
- `apps/mobile/hooks/useETA.ts` - ETA hook exists

**The problem is that the CONDITIONS to show these features are too restrictive.**

---

## Problem 1: ETA Not Visible

**Root Cause:** The `showETA` condition requires `operatorLocation && operatorLocation.is_online`.
If the operator hasn't published location yet OR `is_online` is false, ETA never shows.

**Fix:** Show ETA section whenever operator is assigned, show "Waiting for location" state.

---

## Problem 2: Chat Not Visible  

**Root Cause:** Chat button is nested inside `operatorSection` block which only renders when `activeRequest.operator_name` exists.

**Fix:** Move chat button to be independent of operator section.

---

## Problem 3: Rating Not Appearing

**Root Cause:** Query uses `completed_at` column and strict status check.

**Fix:** Make query more robust.

---

## Problem 4: Login Email Spacing Bug

**Root Cause:** Possible style caching after logout.

**Fix:** Explicitly set `letterSpacing: 0` on login input.

---

## Execution Order

1. [x] Create plan
2. [ ] Fix Problem 4 (Login)
3. [ ] Fix Problem 1 (ETA)
4. [ ] Fix Problem 2 (Chat)
5. [ ] Fix Problem 3 (Rating)
6. [ ] TypeScript verification
7. [ ] Update lessons.md
