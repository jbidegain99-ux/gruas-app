-- =====================================================
-- 00044 — Modelo de pólizas, afiliados y cobertura  (B-08, Fase 1)
--
-- Es la capa que convierte "app de grúas" en "asistencia de seguro": a partir de
-- aquí cada servicio puede nacer de una cobertura válida en vez de un pago suelto.
--
--   insurers ─┬─ coverage_plans ── coverage_rules
--             └─ policies ── members ── coverage_usage ── service_requests
--
-- POR QUE LAS REGLAS SON FILAS Y NO COLUMNAS
-- El de-risk de este item (B-02: validar el modelo con una aseguradora real)
-- sigue pendiente, asi que todavia no sabemos con certeza que reglas vende una
-- poliza de asistencia en El Salvador. Si `coverage_plans` tuviera columnas
-- rigidas (`max_servicios_anio`, `km_incluidos`, ...), cada hallazgo del
-- discovery costaria una migracion y un cambio de tipos. Con `coverage_rules`
-- —una fila por regla, opcionalmente por tipo de servicio— ajustar la cobertura
-- es cambiar datos de configuracion. B-12 construira el motor que las evalua.
--
-- SOBRE LA PII
-- `members` guarda datos de afiliados (nombre, documento, telefono) que ni
-- siquiera son usuarios de la app. Es exactamente lo que motivo adelantar B-07
-- (Decreto 144) antes de esta fase. Por eso el RLS nace cerrado: admin, y el
-- titular solo lo suyo. Operador y MOP NO tienen acceso a ninguna de estas
-- tablas, ni lo tendran: no lo necesitan para prestar el servicio.
-- El portal de la aseguradora (B-17) traera su propio rol y sus politicas.
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Aseguradoras
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.insurers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  tax_id        TEXT,                      -- NIT
  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 2. Planes de cobertura (el producto que vende la aseguradora)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coverage_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id  UUID NOT NULL REFERENCES public.insurers(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,               -- 'ORO', 'BASICO', ...
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (insurer_id, code)
);

-- ---------------------------------------------------------------
-- 3. Reglas de cobertura — parametrizables
-- ---------------------------------------------------------------
-- `service_type` NULL significa "aplica a todos los tipos"; una fila con el tipo
-- concreto lo sobrescribe. Asi se expresa "4 gruas al año, bateria ilimitada,
-- cerrajeria no cubierta" sin tocar el esquema.
CREATE TABLE IF NOT EXISTS public.coverage_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      UUID NOT NULL REFERENCES public.coverage_plans(id) ON DELETE CASCADE,
  service_type TEXT,
  rule_key     TEXT NOT NULL CHECK (rule_key IN (
                 'covered',             -- 1 = incluido, 0 = excluido
                 'services_per_year',   -- tope de eventos por año (NULL/ausente = sin tope)
                 'included_km',         -- km de arrastre cubiertos; el excedente va a copago
                 'max_covered_amount'   -- tope en USD que asume la aseguradora por evento
               )),
  rule_value   NUMERIC(12, 2),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UNIQUE normal no sirve aqui: en SQL dos NULL no se consideran iguales, asi que
-- `UNIQUE (plan_id, service_type, rule_key)` dejaria meter varias reglas
-- generales repetidas. Se normaliza el NULL a '*' dentro del indice.
CREATE UNIQUE INDEX IF NOT EXISTS coverage_rules_unicas
  ON public.coverage_rules (plan_id, COALESCE(service_type, '*'), rule_key);

-- ---------------------------------------------------------------
-- 4. Pólizas
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.policies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id    UUID NOT NULL REFERENCES public.insurers(id) ON DELETE RESTRICT,
  plan_id       UUID NOT NULL REFERENCES public.coverage_plans(id) ON DELETE RESTRICT,
  policy_number TEXT NOT NULL,
  holder_name   TEXT NOT NULL,
  starts_on     DATE NOT NULL,
  ends_on       DATE,                      -- NULL = sin fecha de fin pactada
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'expired', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (insurer_id, policy_number),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

-- ---------------------------------------------------------------
-- 5. Afiliados / beneficiarios
-- ---------------------------------------------------------------
-- `profile_id` es NULL hasta que la persona se registra en la app: la aseguradora
-- carga su padron (B-10) mucho antes de que sus afiliados descarguen Budi. El
-- match posterior se hace por `document_number`.
CREATE TABLE IF NOT EXISTS public.members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id       UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  profile_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  document_number TEXT NOT NULL,           -- DUI del afiliado
  full_name       TEXT NOT NULL,
  phone           TEXT,
  relationship    TEXT NOT NULL DEFAULT 'holder'
                  CHECK (relationship IN ('holder', 'beneficiary')),
  starts_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_on         DATE,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (policy_id, document_number),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS members_profile_idx  ON public.members (profile_id);
CREATE INDEX IF NOT EXISTS members_document_idx ON public.members (document_number);

-- ---------------------------------------------------------------
-- 6. Consumo de cobertura
-- ---------------------------------------------------------------
-- Una fila por servicio que consumio cobertura. `request_id` es UNIQUE: un mismo
-- servicio no puede descontar dos veces del plan.
CREATE TABLE IF NOT EXISTS public.coverage_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  request_id      UUID NOT NULL UNIQUE REFERENCES public.service_requests(id) ON DELETE CASCADE,
  service_type    TEXT NOT NULL,
  used_on         DATE NOT NULL DEFAULT CURRENT_DATE,
  km_used         NUMERIC(10, 2),
  amount_covered  NUMERIC(10, 2) NOT NULL DEFAULT 0,   -- lo que asume la aseguradora
  amount_copay    NUMERIC(10, 2) NOT NULL DEFAULT 0,   -- lo que paga el afiliado
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El motor de B-12 preguntara "cuantos eventos lleva este afiliado en el año":
-- este indice es exactamente esa consulta.
CREATE INDEX IF NOT EXISTS coverage_usage_member_fecha_idx
  ON public.coverage_usage (member_id, used_on DESC);

-- ---------------------------------------------------------------
-- 7. updated_at
-- ---------------------------------------------------------------
CREATE TRIGGER update_insurers_updated_at       BEFORE UPDATE ON public.insurers       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_coverage_plans_updated_at BEFORE UPDATE ON public.coverage_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_coverage_rules_updated_at BEFORE UPDATE ON public.coverage_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_policies_updated_at       BEFORE UPDATE ON public.policies       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_members_updated_at        BEFORE UPDATE ON public.members        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------
-- 8. Helpers de pertenencia (SECURITY DEFINER)
-- ---------------------------------------------------------------
-- Mismo motivo que is_admin() / is_mop() en la 00024 y que
-- participa_en_algun_servicio() en la 00043: si una politica de `policies`
-- consultara `members` en linea, dispararia la RLS de `members`, cuya politica
-- vuelve a mirar `policies`. Recursion. Estas funciones la cortan.

CREATE OR REPLACE FUNCTION public.is_my_policy(p_policy_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m
     WHERE m.policy_id = p_policy_id AND m.profile_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_my_plan(p_plan_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m
      JOIN policies p ON p.id = m.policy_id
     WHERE p.plan_id = p_plan_id AND m.profile_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_my_insurer(p_insurer_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m
      JOIN policies p ON p.id = m.policy_id
     WHERE p.insurer_id = p_insurer_id AND m.profile_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_my_policy(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_plan(UUID)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_insurer(UUID)  TO authenticated;

-- ---------------------------------------------------------------
-- 9. RLS — cerrado por defecto
-- ---------------------------------------------------------------
ALTER TABLE public.insurers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_usage ENABLE ROW LEVEL SECURITY;

-- El admin administra todo el padron.
CREATE POLICY "Admin gestiona aseguradoras"     ON public.insurers       FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin gestiona planes"           ON public.coverage_plans FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin gestiona reglas"           ON public.coverage_rules FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin gestiona polizas"          ON public.policies       FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin gestiona afiliados"        ON public.members        FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin gestiona consumo"          ON public.coverage_usage FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- El afiliado ve su cobertura, en solo lectura: quien la modifica es la
-- aseguradora a traves del admin, nunca el titular.
CREATE POLICY "Afiliado ve su ficha"            ON public.members        FOR SELECT USING (profile_id = auth.uid());
CREATE POLICY "Afiliado ve su poliza"           ON public.policies       FOR SELECT USING (is_my_policy(policies.id));
CREATE POLICY "Afiliado ve su plan"             ON public.coverage_plans FOR SELECT USING (is_my_plan(coverage_plans.id));
CREATE POLICY "Afiliado ve las reglas de su plan" ON public.coverage_rules FOR SELECT USING (is_my_plan(coverage_rules.plan_id));
CREATE POLICY "Afiliado ve su aseguradora"      ON public.insurers       FOR SELECT USING (is_my_insurer(insurers.id));
CREATE POLICY "Afiliado ve su consumo"          ON public.coverage_usage FOR SELECT
  USING (EXISTS (SELECT 1 FROM members m WHERE m.id = coverage_usage.member_id AND m.profile_id = auth.uid()));

-- Defensa en profundidad: las default privileges de Supabase conceden grants a
-- toda tabla nueva de `public`, y `anon` no pinta nada en el padron de afiliados.
REVOKE ALL ON public.insurers, public.coverage_plans, public.coverage_rules,
              public.policies, public.members, public.coverage_usage FROM anon;

COMMENT ON TABLE public.coverage_rules IS
  'Reglas de cobertura como datos (no columnas) para que el discovery de B-02 se absorba cambiando filas. El motor que las evalua es B-12.';
COMMENT ON TABLE public.members IS
  'Padron de afiliados. Contiene PII de personas que pueden no ser usuarias de la app: RLS cerrado (admin + titular). Ver docs/PROTECCION_DATOS.md.';
