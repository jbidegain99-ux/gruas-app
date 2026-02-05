# GruasApp - Estado de 4 Bugs Criticos (5 Feb 2026)

## Bug 1: Chat del solicitante - SOLUCIONADO (v2 - Fix de visibilidad)

**Problema original:** El chat modal se abria como un segundo `<Modal>` mientras el modal de detalle ya estaba abierto. Dos modales visibles simultaneamente en React Native causa que el segundo modal sea invisible (renderizado detras del primero), congelando la pantalla.

**Solucion implementada (v2):** Se renderiza el ChatScreen DENTRO del modal de detalle existente, en vez de abrir un segundo modal.

Cambios realizados (v2 - 5 Feb 2026):
- `apps/mobile/app/(user)/history.tsx`:
  - Modificado `renderDetailModal()` para mostrar ChatScreen dentro del modal de detalle cuando `chatModalVisible` es true
  - Eliminado el modal de chat separado (que causaba dos modales simultaneos)
  - Eliminado import no usado de `SafeAreaView`
- `apps/mobile/components/ChatScreen.tsx`:
  - Movidos console.logs del cuerpo del render a un `useEffect` con dependencias correctas
  - Esto elimina los 25+ logs "ChatScreen RENDER" que aparecian por re-renders del padre

---

## Bug 2: Foto del vehiculo - MIGRACION PENDIENTE

**Estado:** El codigo esta listo, pero la migracion no se ha ejecutado.

El usuario debe ejecutar en Supabase SQL Editor el contenido de `supabase/migrations/00020_add_vehicle_photos.sql`

---

## Bug 3: ETA no se muestra - YA FUNCIONA

**Estado:** Funciona correctamente.

El ETA se muestra en la pantalla principal (`index.tsx`) cuando:
- La solicitud tiene status `assigned` o `en_route`
- El operador esta online y enviando ubicacion GPS

---

## Bug 4: Cancelacion y historial - MIGRACION PENDIENTE

**Estado:** El codigo esta listo, pero la migracion puede no estar aplicada.

El usuario debe ejecutar en Supabase SQL Editor el contenido de `supabase/migrations/00016_cancel_service_request.sql`

---

## Migraciones Pendientes de Aplicar en Supabase SQL Editor

### 1. Migration 00016 (Cancelacion)
```sql
-- Migration: Add cancellation columns and RPC function

-- Add columns for cancellation tracking
ALTER TABLE service_requests
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT DEFAULT NULL;

ALTER TABLE service_requests
ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES profiles(id) DEFAULT NULL;

-- RPC: cancel_service_request
CREATE OR REPLACE FUNCTION cancel_service_request(
  p_request_id UUID,
  p_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_request service_requests;
  v_user_id UUID;
  v_user_role user_role;
BEGIN
  v_user_id := auth.uid();

  -- Get user role
  SELECT role INTO v_user_role FROM profiles WHERE id = v_user_id;

  -- Get the request
  SELECT * INTO v_request FROM service_requests WHERE id = p_request_id;

  IF v_request IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solicitud no encontrada');
  END IF;

  -- Check if request can be cancelled
  IF v_request.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Esta solicitud ya no puede ser cancelada');
  END IF;

  -- Verify user has permission to cancel
  IF v_user_role = 'USER' AND v_request.user_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tienes permiso para cancelar esta solicitud');
  END IF;

  IF v_user_role = 'OPERATOR' AND v_request.operator_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tienes permiso para cancelar esta solicitud');
  END IF;

  -- Cancel the request
  UPDATE service_requests
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = v_user_id,
    cancellation_reason = p_reason
  WHERE id = p_request_id;

  -- Create audit event
  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (
    p_request_id,
    v_user_id,
    v_user_role::TEXT,
    'REQUEST_CANCELLED',
    jsonb_build_object('reason', p_reason, 'cancelled_by_role', v_user_role)
  );

  RETURN jsonb_build_object('success', true, 'message', 'Solicitud cancelada exitosamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION cancel_service_request(UUID, TEXT) TO authenticated;
```

### 2. Migration 00020 (Fotos de vehiculo)
```sql
-- Migration: Add vehicle photo support
-- 1. Add column to service_requests
-- 2. Create storage bucket for service photos
-- 3. Update create_service_request RPC to accept photo URL

-- Add vehicle_photo_url column
ALTER TABLE service_requests
ADD COLUMN IF NOT EXISTS vehicle_photo_url TEXT DEFAULT NULL;

-- Create storage bucket for service photos (public for easy access)
INSERT INTO storage.buckets (id, name, public)
VALUES ('service-photos', 'service-photos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for service-photos bucket
-- Allow authenticated users to upload their own photos
CREATE POLICY "Users can upload service photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'service-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow anyone to read service photos (bucket is public)
CREATE POLICY "Anyone can view service photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'service-photos');

-- Allow users to delete their own photos
CREATE POLICY "Users can delete their service photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'service-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Drop old function signature and recreate with new parameter
DROP FUNCTION IF EXISTS create_service_request(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, tow_type, TEXT, TEXT);

CREATE OR REPLACE FUNCTION create_service_request(
  p_dropoff_address TEXT,
  p_dropoff_lat DOUBLE PRECISION,
  p_dropoff_lng DOUBLE PRECISION,
  p_incident_type TEXT,
  p_notes TEXT DEFAULT NULL,
  p_pickup_address TEXT DEFAULT NULL,
  p_pickup_lat DOUBLE PRECISION DEFAULT NULL,
  p_pickup_lng DOUBLE PRECISION DEFAULT NULL,
  p_tow_type tow_type DEFAULT 'light',
  p_vehicle_doc_path TEXT DEFAULT NULL,
  p_vehicle_photo_url TEXT DEFAULT NULL,
  p_vehicle_plate TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_pin TEXT;
  v_pin_hash TEXT;
  v_request_id UUID;
  v_request service_requests;
BEGIN
  v_user_id := auth.uid();

  -- Verify user is authenticated
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Generate 4-digit PIN
  v_pin := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  v_pin_hash := crypt(v_pin, gen_salt('bf'));

  -- Create the request
  INSERT INTO service_requests (
    user_id,
    pickup_lat,
    pickup_lng,
    pickup_address,
    dropoff_lat,
    dropoff_lng,
    dropoff_address,
    tow_type,
    incident_type,
    vehicle_plate,
    vehicle_doc_path,
    vehicle_photo_url,
    notes,
    pin_hash,
    status
  ) VALUES (
    v_user_id,
    COALESCE(p_pickup_lat, 13.6929),
    COALESCE(p_pickup_lng, -89.2182),
    COALESCE(p_pickup_address, 'San Salvador'),
    p_dropoff_lat,
    p_dropoff_lng,
    p_dropoff_address,
    p_tow_type,
    p_incident_type,
    p_vehicle_plate,
    p_vehicle_doc_path,
    p_vehicle_photo_url,
    p_notes,
    v_pin_hash,
    'initiated'
  ) RETURNING * INTO v_request;

  v_request_id := v_request.id;

  -- Create audit event
  INSERT INTO request_events (request_id, actor_id, actor_role, event_type, payload)
  VALUES (
    v_request_id,
    v_user_id,
    'USER',
    'REQUEST_CREATED',
    jsonb_build_object(
      'pickup_address', p_pickup_address,
      'dropoff_address', p_dropoff_address,
      'tow_type', p_tow_type,
      'incident_type', p_incident_type,
      'has_photo', p_vehicle_photo_url IS NOT NULL
    )
  );

  -- Return request info with PIN (PIN is only returned once at creation)
  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'pin', v_pin,
    'status', 'initiated',
    'message', 'Guarda este PIN. Lo necesitarás cuando llegue la grúa.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION create_service_request(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, tow_type, TEXT, TEXT, TEXT) TO authenticated;

-- Update get_available_requests_for_operator to include vehicle_photo_url
CREATE OR REPLACE FUNCTION get_available_requests_for_operator()
RETURNS JSONB AS $$
DECLARE
  v_requests JSONB;
BEGIN
  -- Verify caller is operator
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'OPERATOR'
  ) THEN
    RAISE EXCEPTION 'Only operators can view available requests';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', sr.id,
      'pickup_lat', sr.pickup_lat,
      'pickup_lng', sr.pickup_lng,
      'pickup_address', sr.pickup_address,
      'dropoff_lat', sr.dropoff_lat,
      'dropoff_lng', sr.dropoff_lng,
      'dropoff_address', sr.dropoff_address,
      'tow_type', sr.tow_type,
      'incident_type', sr.incident_type,
      'created_at', sr.created_at,
      'user_name', p.full_name,
      'user_phone', p.phone,
      'vehicle_photo_url', sr.vehicle_photo_url,
      'notes', sr.notes
    ) ORDER BY sr.created_at ASC
  ) INTO v_requests
  FROM service_requests sr
  JOIN profiles p ON p.id = sr.user_id
  WHERE sr.status = 'initiated';

  RETURN COALESCE(v_requests, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_available_requests_for_operator() TO authenticated;
```

---

## Resumen

| Bug | Estado | Accion |
|-----|--------|--------|
| Bug 1 (Chat) | SOLUCIONADO (v2) | Fix dual-modal invisible: ChatScreen ahora se renderiza dentro del modal de detalle |
| Bug 2 (Fotos) | PENDIENTE | Ejecutar migration 00020 en Supabase |
| Bug 3 (ETA) | FUNCIONA | No requiere accion |
| Bug 4 (Cancelacion) | PENDIENTE | Ejecutar migration 00016 en Supabase |
