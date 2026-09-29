import { describe, expect, it } from 'vitest';
import { scrubBreadcrumbData, scrubEvent, scrubUrl } from './sentry-scrub';

describe('sentry-scrub', () => {
  it('tapa el token de invitación, la sesión del hash y el code de PKCE', () => {
    expect(scrubUrl('https://budi.sv/invitacion?token=abc123')).toBe('https://budi.sv/invitacion?token=[oculto]');
    expect(scrubUrl('https://budi.sv/invitacion#access_token=eyJ.x.y&refresh_token=r1&type=invite')).toBe(
      'https://budi.sv/invitacion#access_token=[oculto]&refresh_token=[oculto]&type=invite'
    );
    expect(scrubUrl('/auth/callback?code=xyz&next=/admin')).toBe('/auth/callback?code=[oculto]&next=/admin');
  });

  it('no toca URLs sin secretos', () => {
    expect(scrubUrl('/admin/requests?status=initiated')).toBe('/admin/requests?status=initiated');
  });

  it('limpia el evento: url, query, cabeceras y migas', () => {
    const e = scrubEvent({
      request: {
        url: 'https://budi.sv/invitacion?token=t',
        query_string: 'token=t&x=1',
        headers: { Authorization: 'Bearer s', 'User-Agent': 'ua' },
        cookies: { sb: 'x' },
      },
      breadcrumbs: [{ data: { from: '/invitacion?token=t', to: '/portal' } }],
    });
    expect(e.request?.url).toBe('https://budi.sv/invitacion?token=[oculto]');
    expect(e.request?.query_string).toBe('token=[oculto]&x=1');
    expect(e.request?.headers).toEqual({ Authorization: '[oculto]', 'User-Agent': 'ua' });
    expect(e.request?.cookies).toBe('[oculto]');
    expect(e.breadcrumbs?.[0].data).toEqual({ from: '/invitacion?token=[oculto]', to: '/portal' });
  });

  it('las migas sueltas también', () => {
    const d: Record<string, unknown> = { url: 'http://x/rest?access_token=a', method: 'GET' };
    scrubBreadcrumbData(d);
    expect(d.url).toBe('http://x/rest?access_token=[oculto]');
  });
});
