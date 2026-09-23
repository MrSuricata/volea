// Placa VOLEA para fotos que no cargan. Compartido por la tienda y el panel admin.

import type React from 'react';
import { errorImagen } from '../utils/imagenes';

export const FALLBACK_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%23001F3F'/%3E%3Ccircle cx='200' cy='180' r='60' fill='none' stroke='%23ccff00' stroke-width='3'/%3E%3Ccircle cx='175' cy='160' r='8' fill='%23ccff00'/%3E%3Ccircle cx='210' cy='155' r='8' fill='%23ccff00'/%3E%3Ccircle cx='230' cy='180' r='8' fill='%23ccff00'/%3E%3Ccircle cx='210' cy='205' r='8' fill='%23ccff00'/%3E%3Ccircle cx='175' cy='200' r='8' fill='%23ccff00'/%3E%3Ccircle cx='160' cy='180' r='8' fill='%23ccff00'/%3E%3Ctext x='200' y='280' text-anchor='middle' fill='%23ccff00' font-family='sans-serif' font-weight='700' font-size='28'%3EVOLEA%3C/text%3E%3C/svg%3E";

export const handleImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.src = FALLBACK_IMG;
};

// Para fotos servidas achicadas (utils/imagenes): si la versión optimizada falla,
// primero la original y recién después la placa VOLEA.
export const errorFoto = (original?: string) => (e: React.SyntheticEvent<HTMLImageElement>) =>
  errorImagen(e.currentTarget, original, FALLBACK_IMG);
