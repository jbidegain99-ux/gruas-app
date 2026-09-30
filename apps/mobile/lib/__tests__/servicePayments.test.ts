import { describe, expect, it } from 'vitest';
import { balanceLabel, parseServicePayment, receiptText } from '../servicePayments';

const raw = {
  request_id: 'r1', folio: 'BUDI-000300', service_type: 'tow', completed_at: '2026-09-29T20:00:00Z',
  operator_name: 'Socio Uno', user_name: 'Ana', payer: 'insurer', total_price: '80.00', covered: '60.00',
  amount_due: '20.00', status: 'paid', method: 'cash', paid_at: '2026-09-29T20:05:00Z',
  receipt_number: 'RC-000012', card_available: false,
};

describe('servicePayments', () => {
  it('convierte montos a número y conserva el estado', () => {
    const p = parseServicePayment(raw)!;
    expect(p.amount_due).toBe(20);
    expect(p.covered).toBe(60);
    expect(p.status).toBe('paid');
    expect(parseServicePayment(null)).toBeNull();
  });

  it('el comprobante para compartir muestra lo pagado y lo cubierto, sin comisión, y aclara que no es factura', () => {
    const t = receiptText(parseServicePayment(raw)!, 'Grúa', '29 sept 2026');
    expect(t).toContain('RC-000012');
    expect(t).toContain('Cubrió tu seguro: $60.00');
    expect(t).toContain('Pagaste: $20.00 (Efectivo)');
    expect(t).toContain('no es una factura');
    expect(t.toLowerCase()).not.toContain('comisi');
  });

  it('con las aseguradoras apagadas (00153) el comprobante no menciona el seguro', () => {
    const t = receiptText(parseServicePayment(raw)!, 'Grúa', '29 sept 2026', false);
    expect(t.toLowerCase()).not.toContain('seguro');
    expect(t).toContain('Pagaste: $20.00 (Efectivo)');
  });

  it('un saldo negativo es comisión que el socio le debe a Budi', () => {
    expect(balanceLabel(-15)).toEqual({ label: 'Le debes a Budi (comisión del efectivo)', amount: 15, owes: true });
    expect(balanceLabel(40).owes).toBe(false);
  });
});
