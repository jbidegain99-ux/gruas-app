# Real-time Tracking System Investigation & QA Report

## 📋 Investigation Objective

**CRITICAL TASK:** Investigate and fix real-time map tracking issues in production mode. Demo mode works perfectly, but real-time mode has two major problems:

1. **Map shows straight dotted line instead of curved route following streets**
2. **Infinite loop in console logs causing performance issues**

## 🎯 Current System State Analysis

### Demo Mode vs Real-time Mode Toggle
**File to check:** `apps/mobile/config/demo.ts`

**Current expected state:**
```typescript
export const DEMO_CONFIG = {
  ENABLED: __DEV__, // Should be false for real-time mode investigation
  SIMULATION_SPEED: 2.0,
  UPDATE_INTERVAL_MS: 2000,
  INITIAL_ETA_MINUTES: 12,
  AVERAGE_SPEED_KMH: 30,
};
```

**ACTION REQUIRED:** Set `ENABLED: false` to disable demo mode and enable real-time tracking.

---

## 🔍 Detailed Investigation Checklist

### Phase 1: Environment Configuration Verification

**1.1 Demo Mode Status**
- [ ] Check `apps/mobile/config/demo.ts` - should be `ENABLED: false`
- [ ] Verify demo mode guards in key files are inactive
- [ ] Confirm we're testing real-time mode, not simulation

**1.2 Dependencies & Imports**
- [ ] Verify all location tracking hooks are properly imported
- [ ] Check Google Maps API integration is active
- [ ] Confirm Supabase Realtime subscriptions are configured

### Phase 2: Map Rendering Investigation (Issue #1)

**2.1 Route Polyline Source Analysis**
**Primary file:** `apps/mobile/app/(user)/index.tsx`

**Questions to investigate:**
- Where does the route polyline come from in real-time mode?
- Is `request.route_polyline` populated in the database for real requests?
- Is the Google Directions API being called when needed?
- Is `decodePolyline()` function working correctly?

**Code areas to examine:**
```typescript
// Check if this shows curved route or straight line
<MapView.Polyline
  coordinates={routeCoordinates} // ← What's in this array?
  strokeColor="#F5A25B" // Budi orange
  strokeWidth={4}
/>
```

**Expected vs Actual:**
- **Expected:** routeCoordinates contains 50-200+ decoded polyline points
- **Actual:** routeCoordinates contains only 2 points (operator → user) = straight line

**2.2 Polyline Data Flow Investigation**
Track data flow:
1. **Database:** Does `service_requests.route_polyline` exist?
2. **Edge Function:** Is `supabase/functions/get-eta/index.ts` being called?
3. **Decoding:** Is `apps/mobile/lib/geoUtils.ts` `decodePolyline()` working?
4. **State:** Is decoded polyline properly stored in component state?
5. **Rendering:** Are correct coordinates passed to MapView.Polyline?

**2.3 Fallback Logic Analysis**
Check fallback hierarchy:
1. Stored polyline from database
2. ETA polyline from get-eta function
3. Straight-line fallback (20 intermediate points)

**Issue hypothesis:** System is falling back to straight line instead of using actual route.

### Phase 3: Infinite Loop Investigation (Issue #2)

**3.1 useEffect Dependencies Analysis**
**Primary files to examine:**
- `apps/mobile/app/(user)/index.tsx`
- `apps/mobile/hooks/useETA.ts`
- `apps/mobile/hooks/useOperatorLocation.ts`

**Common infinite loop patterns to check:**
```typescript
// BAD - object reference changes every render
useEffect(() => {
  calculateETA();
}, [operatorLocation]); // ← operatorLocation is new object each time

// GOOD - primitive dependencies
useEffect(() => {
  calculateETA();
}, [operatorLocation?.latitude, operatorLocation?.longitude]);
```

**3.2 Real-time Subscription Cleanup**
Check Supabase Realtime subscriptions:
```typescript
// Must have proper cleanup
useEffect(() => {
  const subscription = supabase
    .channel('operator_location')
    .on('postgres_changes', ...)
    .subscribe();

  return () => {
    subscription.unsubscribe(); // ← Critical for preventing loops
  };
}, []);
```

**3.3 Interval Management**
Check location update intervals:
```typescript
// Check for intervals without cleanup
useEffect(() => {
  const interval = setInterval(() => {
    updateLocation();
  }, 2000); // ← Too frequent for production

  return () => clearInterval(interval); // ← Must exist
}, []);
```

### Phase 4: Performance Analysis

**4.1 Update Frequency Audit**
**Current (problematic) frequencies:**
- ETA calculation: Every 2 seconds (causes infinite loop)
- Location updates: Every 2 seconds (too frequent)

**Target frequencies:**
- ETA calculation: Every 60 seconds
- Operator location updates: Every 15 seconds
- User location updates: Only when app becomes active

**4.2 API Call Optimization**
- Google Directions API calls per minute: Should be <1 per active request
- Supabase updates per minute: Should be <4 per active operator
- Console.log spam: Should be minimal (not continuous)

---

## 🐛 Specific Bugs to Investigate

### Bug 1: Straight Line Route Display
**Symptoms:**
- User sees straight dotted line from operator to pickup location
- NOT showing curved route following actual streets
- Looks unprofessional and inaccurate

**Investigation steps:**
1. Check if route_polyline exists in service_requests table
2. Verify get-eta Edge Function is called for real requests
3. Confirm decodePolyline function works with real Google polylines
4. Ensure MapView.Polyline receives decoded coordinates, not fallback

**Files to examine:**
- `apps/mobile/app/(user)/index.tsx` - MapView.Polyline component
- `supabase/functions/get-eta/index.ts` - Route fetching logic
- `apps/mobile/lib/geoUtils.ts` - Polyline decoding
- `apps/mobile/hooks/useETA.ts` - ETA calculation and route data

### Bug 2: Console Log Infinite Loop
**Symptoms:**
- Console continuously logs location tracking attempts
- Logs show repeated: "Finding location", "Calculating distance", "Calculating route"
- Performance degradation and battery drain

**Investigation steps:**
1. Add render counting to identify component causing re-renders
2. Check useEffect dependencies in all hooks
3. Verify Supabase subscription cleanup
4. Confirm intervals have proper cleanup functions

**Files to examine:**
- `apps/mobile/app/(user)/index.tsx` - Main component useEffects
- `apps/mobile/hooks/useETA.ts` - ETA calculation loop
- `apps/mobile/hooks/useOperatorLocation.ts` - Real-time subscription
- `apps/mobile/hooks/useOperatorLocationTracking.ts` - GPS tracking

---

## 📊 Testing Protocol

### Pre-Investigation Setup
```bash
# 1. Navigate to project
cd /home/jose/gruas-app

# 2. Disable demo mode
# Edit apps/mobile/config/demo.ts -> ENABLED: false

# 3. Start app with cache clear
pnpm --filter mobile start -c --tunnel
```

### Testing Scenarios

**Scenario 1: User with Active Request**
1. Login as user with active service request
2. Check map loads immediately (no white screen)
3. Verify user location marker appears (red pin)
4. **CRITICAL:** Check if route is curved or straight line
5. Monitor console for infinite loop logs
6. Verify ETA displays and updates reasonably

**Scenario 2: Operator Location Updates**
1. Have operator move location (physically or in simulator)
2. Verify user screen shows updated operator position
3. Check update frequency is reasonable (not every 2 seconds)
4. Confirm route polyline remains curved during updates

### Debug Logging Strategy
Add strategic console.logs to identify issues:

```typescript
// In apps/mobile/app/(user)/index.tsx
let renderCount = 0;
console.log('[UserIndex] RENDER:', ++renderCount, {
  hasRoutePolyline: !!request?.route_polyline,
  routeCoordinatesLength: routeCoordinates.length,
  operatorLat: operatorLocation?.latitude,
  userLat: userLocation?.latitude
});

// In useETA hook
console.log('[useETA] Effect running:', {
  operatorLocation: operatorLocation?.latitude,
  userLocation: userLocation?.latitude,
  timestamp: Date.now()
});

// In MapView.Polyline
console.log('[Polyline] Rendering:', {
  coordinatesCount: routeCoordinates.length,
  isCurved: routeCoordinates.length > 2,
  firstCoord: routeCoordinates[0],
  lastCoord: routeCoordinates[routeCoordinates.length - 1]
});
```

---

## 🎯 Expected Outcomes

### Issue #1 Resolution: Curved Route Display
**Success criteria:**
- [ ] Map shows curved polyline following actual streets
- [ ] Route updates when operator moves significantly (>500m)
- [ ] Fallback to straight line only when route data unavailable
- [ ] Route polyline uses Budi orange color (#F5A25B)

### Issue #2 Resolution: Performance Optimization
**Success criteria:**
- [ ] Console logs are minimal (not continuous)
- [ ] ETA updates every 60 seconds, not every 2 seconds
- [ ] Location updates every 15 seconds for operators
- [ ] No "Maximum update depth exceeded" errors
- [ ] Smooth 60fps performance on map interaction

### Overall System Health
**Success criteria:**
- [ ] Real-time tracking works as well as demo mode
- [ ] Battery usage is reasonable (<10% per hour)
- [ ] Network requests are optimized
- [ ] User experience is smooth and professional

---

## 🔧 Debugging Commands Reference

### Git Status Check
```bash
git status
git diff
```

### Start Development Server
```bash
pnpm --filter mobile start --tunnel
```

### Database Migration (if needed)
```bash
npx supabase db push
```

### View Supabase Edge Function Logs
```bash
npx supabase functions logs get-eta --follow
```

---

## 📝 Investigation Report Template

After completing the investigation, provide a report with:

### 1. Root Cause Analysis
- Primary cause of straight line display
- Primary cause of infinite loop
- Contributing factors

### 2. Code Issues Identified
- Specific files with problems
- Exact line numbers where issues occur
- useEffect dependencies that need fixing
- Cleanup functions that are missing

### 3. Fix Implementation Plan
- Step-by-step fix for polyline rendering
- Step-by-step fix for infinite loop
- Performance optimizations needed

### 4. Testing Results
- Before/after performance metrics
- Visual confirmation of curved routes
- Console log frequency reduction

### 5. Files Modified List
- Complete list of files that need changes
- Brief description of changes for each file

---

## 🚀 Next Steps After Investigation

1. **Immediate fixes** for critical issues
2. **Performance optimization** implementation
3. **End-to-end testing** with real devices
4. **Code commit** with fixes
5. **Production readiness** verification

---

## 🔒 Important Notes

- **Keep demo mode functional** - don't break simulation while fixing real-time
- **Maintain backward compatibility** - existing features should continue working
- **API cost optimization** - minimize Google Maps API calls
- **Battery life consideration** - reasonable update frequencies
- **Error handling** - graceful fallbacks for network/GPS issues

---

## 📞 Context Reference

- **Project:** Budi (formerly GruasApp) - Roadside assistance app
- **Market:** Central America (El Salvador)
- **Tech Stack:** React Native + Expo SDK 54, Supabase, Google Maps API
- **Current Phase:** Post-rebrand, fixing real-time tracking before production
- **Development Environment:** WSL + Claude Code integration

**This investigation should result in production-ready real-time tracking that matches the quality and smoothness of the demo mode implementation.**
