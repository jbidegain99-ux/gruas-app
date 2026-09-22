-- Migration: tipo de negocio del proveedor.
--
-- POR QUE
-- `providers` nacio (00003) atada al negocio de gruas por una sola columna:
-- `tow_type_supported` es NOT NULL con CHECK ('light','heavy','both'). Una
-- cerrajeria, un taller mecanico o un proveedor de combustible —que nunca
-- remolcan— igual tienen que declarar un tipo de grua. Es un dato inventado, y
-- los datos inventados terminan usandose para decidir cosas.
--
-- QUE HACE Y QUE NO
-- Agrega `business_type` y suelta la obligatoriedad de `tow_type_supported`.
-- NO duplica las capacidades del proveedor: QUE servicios presta sigue viviendo
-- en `provider_services` (M:N contra `services`, con precio propio por empresa).
-- `business_type` es a que se dedica la empresa —el segmento— y es lo que mas
-- adelante decidira que portal y que permisos recibe (B-17, B-25, B-27).
-- Confundir las dos cosas seria el error: una operadora de gruas puede ofrecer
-- cerrajeria sin dejar de ser una operadora de gruas.

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'tow';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'providers_business_type_check'
  ) THEN
    ALTER TABLE public.providers
      ADD CONSTRAINT providers_business_type_check
      CHECK (business_type IN ('tow', 'roadside', 'mechanic', 'locksmith', 'fuel', 'other'));
  END IF;
END $$;

COMMENT ON COLUMN public.providers.business_type IS
  'A que se dedica la empresa: tow=operadora de gruas, roadside=asistencia vial '
  'multiservicio, mechanic=taller, locksmith=cerrajeria, fuel=combustible, '
  'other=otro. NO es la lista de servicios que presta — eso es provider_services.';

-- El default 'tow' es correcto para las filas que ya existen: hasta hoy todo
-- proveedor cargado era una operadora de gruas (era lo unico que el modelo
-- permitia representar).

-- ---------------------------------------------------------------
-- tow_type_supported deja de ser obligatorio
-- ---------------------------------------------------------------
-- NULL = esta empresa no remolca. El CHECK de valores permitidos se mantiene
-- para cuando si tiene valor; un CHECK que ademas cruzara business_type seria
-- una trampa (una operadora de gruas podria tercerizar el remolque y seguir
-- siendo 'tow'), asi que la regla se queda en "si remolca, declara que tipo".
ALTER TABLE public.providers
  ALTER COLUMN tow_type_supported DROP NOT NULL;

COMMENT ON COLUMN public.providers.tow_type_supported IS
  'Tipo de grua que puede operar, o NULL si la empresa no remolca. '
  'Obligatorio solo de hecho: quien ofrece el servicio tow deberia tenerlo.';

CREATE INDEX IF NOT EXISTS providers_business_type_idx
  ON public.providers (business_type)
  WHERE is_active;
