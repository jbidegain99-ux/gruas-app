-- 00030_vehicles.sql
-- "Mis vehículos": el usuario guarda sus vehículos para no reingresarlos en cada
-- solicitud. Cada usuario gestiona solo los suyos (RLS).

CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  make text,                       -- marca
  model text,                      -- modelo
  plate text,                      -- placa
  color text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_user ON public.vehicles(user_id);

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- El dueño gestiona sus propios vehículos.
CREATE POLICY "Users manage own vehicles"
  ON public.vehicles
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles TO authenticated;
