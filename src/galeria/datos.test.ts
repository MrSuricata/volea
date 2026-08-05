import { describe, expect, it } from 'vitest';
import { esLinkAlbumValido } from './datos';

describe('esLinkAlbumValido', () => {
  it('acepta un link de Google Photos https://', () => {
    expect(esLinkAlbumValido('https://photos.app.goo.gl/test')).toBe(true);
  });

  it('acepta un link de Google Drive https://', () => {
    expect(esLinkAlbumValido('https://drive.google.com/drive/folders/abc123')).toBe(true);
  });

  it('rechaza http:// (sin cifrar)', () => {
    expect(esLinkAlbumValido('http://photos.app.goo.gl/test')).toBe(false);
  });

  it('rechaza texto sin protocolo', () => {
    expect(esLinkAlbumValido('photos.app.goo.gl/test')).toBe(false);
  });

  it('rechaza vacío', () => {
    expect(esLinkAlbumValido('')).toBe(false);
  });

  it('rechaza una URL malformada aunque empiece con https://', () => {
    expect(esLinkAlbumValido('https:// esto no es una url')).toBe(false);
  });

  it('rechaza otro protocolo (ftp, javascript, etc.)', () => {
    expect(esLinkAlbumValido('javascript:alert(1)')).toBe(false);
    expect(esLinkAlbumValido('ftp://ejemplo.com/x')).toBe(false);
  });
});
