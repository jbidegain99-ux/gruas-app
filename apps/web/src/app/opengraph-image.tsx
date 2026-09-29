import { ImageResponse } from 'next/og';

// Imagen Open Graph de la landing (LAN-10). Se genera en build, sin assets.
export const alt = 'Budi · Grúas y asistencia vial en El Salvador';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 80,
          background: '#2D5F8B',
          color: 'white',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 24,
              background: 'white',
              color: '#2D5F8B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 56,
              fontWeight: 800,
            }}
          >
            B
          </div>
          <div style={{ fontSize: 64, fontWeight: 800 }}>Budi</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.1 }}>Grúas y asistencia vial en El Salvador</div>
          <div style={{ fontSize: 34, color: '#F5A25B' }}>Pide ayuda, síguela en vivo y confirma con tu PIN.</div>
        </div>
      </div>
    ),
    size,
  );
}
