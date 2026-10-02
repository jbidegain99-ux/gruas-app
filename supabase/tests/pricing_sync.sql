-- =====================================================
-- El "Desde $" de la grúa sigue a la tarifa activa (migr. 00160)
--
-- Correr contra la base LOCAL:  pnpm db:test
-- Todo corre en una transacción que se revierte.
--
--   A. Activar otra tarifa cambia el "Desde" de la grúa en el catálogo.
--   B. Editar el cargo base de la tarifa activa también.
--   C. Editar el precio de la grúa en el catálogo no la desalinea; los demás
--      servicios sí se editan normal.
--   D. Lo que se cobra (calculate_price) y el "Desde" dicen lo mismo.
-- =====================================================
\set ON_ERROR_STOP 1
BEGIN;

-- Dos tarifas propias para no depender del seed.
UPDATE pricing_rules SET is_active = false;
INSERT INTO pricing_rules (id, name, base_exit_fee, included_km, price_per_km_light, price_per_km_heavy, currency, is_active)
VALUES ('c1c1c1c1-0000-4000-8000-000000000001', 'Prueba diurna',   61.00, 25, 2.50, 4.00, 'USD', true),
       ('c1c1c1c1-0000-4000-8000-000000000002', 'Prueba nocturna', 77.00, 20, 3.00, 5.00, 'USD', false);

DO $$
BEGIN
  ASSERT (SELECT base_price FROM services WHERE slug = 'tow') = 61.00,
    'A0: el catálogo no tomó la tarifa activa: ' || (SELECT base_price FROM services WHERE slug = 'tow');
  -- En dos pasos, como set_active_pricing_rule (hay un índice único de activa).
  UPDATE pricing_rules SET is_active = false WHERE is_active;
  UPDATE pricing_rules SET is_active = true WHERE id = 'c1c1c1c1-0000-4000-8000-000000000002';
  ASSERT (SELECT base_price FROM services WHERE slug = 'tow') = 77.00,
    'A: activar la nocturna no cambió el "Desde": ' || (SELECT base_price FROM services WHERE slug = 'tow');
  RAISE NOTICE 'A. activar otra tarifa mueve el "Desde" de la grúa: OK';

  UPDATE pricing_rules SET base_exit_fee = 80.00 WHERE id = 'c1c1c1c1-0000-4000-8000-000000000002';
  ASSERT (SELECT base_price FROM services WHERE slug = 'tow') = 80.00, 'B: editar el cargo base no se reflejó';
  RAISE NOTICE 'B. editar el cargo base de la activa se refleja: OK';

  UPDATE services SET base_price = 10.00 WHERE slug = 'tow';
  ASSERT (SELECT base_price FROM services WHERE slug = 'tow') = 80.00, 'C: el catálogo dejó desalinear la grúa';
  UPDATE services SET base_price = 33.00 WHERE slug = 'battery';
  ASSERT (SELECT base_price FROM services WHERE slug = 'battery') = 33.00, 'C: se rompió la edición de otro servicio';
  RAISE NOTICE 'C. la grúa no se desalinea desde el catálogo; los demás se editan: OK';

  ASSERT (calculate_price(5, 'light')->>'total')::numeric = (SELECT base_price FROM services WHERE slug = 'tow'),
    'D: lo cobrado en un viaje corto no coincide con el "Desde"';
  RAISE NOTICE 'D. cobro mínimo = "Desde": OK';
END $$;

ROLLBACK;
