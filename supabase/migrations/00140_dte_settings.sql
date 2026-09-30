-- =====================================================
-- LAN-09 (base) · Datos fiscales para la factura electrónica (DTE)
--
-- Solo lo necesario para ARMAR el DTE de un estado de cuenta aprobado:
--   * `dte_settings` (una fila): datos del emisor (Budi), establecimiento y
--     punto de venta, ambiente (00 pruebas / 01 producción) y si los precios
--     de la plataforma ya incluyen IVA.
--   * `organization_fiscal_data`: datos del receptor por cliente y qué tipo de
--     documento se le emite (01 Factura / 03 Comprobante de Crédito Fiscal).
-- La FIRMA y la TRANSMISIÓN al Ministerio de Hacienda quedan fuera: necesitan
-- el certificado y las credenciales de la API del MH. Qué documento aplica a
-- cada cliente y el trato del IVA los confirma el contador.
-- Solo ADMIN (datos fiscales de clientes).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.dte_settings (
  id                  INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  emisor              JSONB NOT NULL DEFAULT '{}'::jsonb,
  ambiente            TEXT NOT NULL DEFAULT '00' CHECK (ambiente IN ('00', '01')),
  cod_estable         TEXT NOT NULL DEFAULT 'M001' CHECK (cod_estable ~ '^[A-Z0-9]{4}$'),
  cod_punto_venta     TEXT NOT NULL DEFAULT 'P001' CHECK (cod_punto_venta ~ '^[A-Z0-9]{4}$'),
  prices_include_iva  BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
INSERT INTO public.dte_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.organization_fiscal_data (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  dte_type        TEXT NOT NULL DEFAULT '03' CHECK (dte_type IN ('01', '03')),
  receptor        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.dte_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_fiscal_data ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dte_settings, public.organization_fiscal_data FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit ON public.dte_settings;
CREATE TRIGGER trg_audit AFTER UPDATE ON public.dte_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('updated_at,updated_by');
DROP TRIGGER IF EXISTS trg_audit ON public.organization_fiscal_data;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.organization_fiscal_data
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('updated_at,updated_by');

CREATE OR REPLACE FUNCTION public.admin_dte_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  RETURN jsonb_build_object(
    'settings', (SELECT to_jsonb(s) - 'id' - 'updated_by' FROM dte_settings s WHERE id = 1),
    'clients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'organization_id', o.id, 'name', o.name, 'type', o.type,
        'dte_type', COALESCE(f.dte_type, CASE WHEN o.type = 'MOPT' THEN '01' ELSE '03' END),
        'receptor', COALESCE(f.receptor, '{}'::jsonb), 'configured', f.organization_id IS NOT NULL)
        ORDER BY o.type, o.name)
      FROM organizations o LEFT JOIN organization_fiscal_data f ON f.organization_id = o.id
     WHERE o.type IN ('MOPT', 'INSURER')), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_dte_settings(p_emisor JSONB, p_ambiente TEXT, p_cod_estable TEXT,
                                                         p_cod_punto_venta TEXT, p_prices_include_iva BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  IF jsonb_typeof(COALESCE(p_emisor, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Datos del emisor inválidos';
  END IF;
  UPDATE dte_settings
     SET emisor = COALESCE(p_emisor, '{}'::jsonb), ambiente = p_ambiente, cod_estable = upper(btrim(p_cod_estable)),
         cod_punto_venta = upper(btrim(p_cod_punto_venta)), prices_include_iva = COALESCE(p_prices_include_iva, true),
         updated_at = now(), updated_by = auth.uid()
   WHERE id = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_org_fiscal(p_org UUID, p_dte_type TEXT, p_receptor JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org AND type IN ('MOPT', 'INSURER')) THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;
  IF jsonb_typeof(COALESCE(p_receptor, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Datos del receptor inválidos';
  END IF;
  INSERT INTO organization_fiscal_data (organization_id, dte_type, receptor, updated_by)
  VALUES (p_org, p_dte_type, COALESCE(p_receptor, '{}'::jsonb), auth.uid())
  ON CONFLICT (organization_id) DO UPDATE
    SET dte_type = EXCLUDED.dte_type, receptor = EXCLUDED.receptor, updated_at = now(), updated_by = auth.uid();
END;
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_dte_settings()', 'admin_save_dte_settings(jsonb,text,text,text,boolean)',
                           'admin_save_org_fiscal(uuid,text,jsonb)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
