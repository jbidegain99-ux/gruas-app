// Muestra una dirección. Si el valor guardado es un par de coordenadas
// ("13.69, -89.21") — lo que ocurre con solicitudes creadas antes del geocoding
// o cuando este falló — lo resuelve a una dirección legible al vuelo (Nominatim,
// con caché). Mientras resuelve, muestra las coordenadas para no dejar vacío.
import React, { useState, useEffect } from 'react';
import { Text, StyleProp, TextStyle } from 'react-native';
import { resolveDisplayAddress, looksLikeCoords } from '@/lib/geocoding';

interface AddressTextProps {
  address: string | null | undefined;
  lat?: number | null;
  lng?: number | null;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

export function AddressText({ address, lat, lng, style, numberOfLines }: AddressTextProps) {
  const [display, setDisplay] = useState<string>(address ?? '');

  useEffect(() => {
    let cancelled = false;
    if (address && looksLikeCoords(address)) {
      resolveDisplayAddress(address, lat, lng).then((a) => {
        if (!cancelled) setDisplay(a);
      });
    } else {
      setDisplay(address ?? '');
    }
    return () => {
      cancelled = true;
    };
  }, [address, lat, lng]);

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {display}
    </Text>
  );
}
