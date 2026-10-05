import { describe, expect, it } from 'vitest';
import { leerConfig, leerMensajeDeLogin } from './dupr';

const LOGIN = 'https://uat.dupr.gg/login-external-app/Y2s=';

describe('leerConfig', () => {
  it('prendido solo con la respuesta completa del servidor', () => {
    expect(leerConfig({ habilitado: true, entorno: 'uat', login: LOGIN, conClub: true })).toEqual({ habilitado: true, entorno: 'uat', login: LOGIN, conClub: true });
    expect(leerConfig({ habilitado: true, entorno: 'prod', login: 'https://dashboard.dupr.com/login-external-app/x' })).toMatchObject({ entorno: 'prod', conClub: false });
  });

  it('cualquier otra cosa deja la web como antes', () => {
    for (const raro of [null, '<!doctype html>', {}, { habilitado: false }, { habilitado: true }, { habilitado: true, login: 'javascript:alert(1)' }]) {
      expect(leerConfig(raro)).toEqual({ habilitado: false });
    }
  });
});

describe('leerMensajeDeLogin', () => {
  const datos = { userToken: 'tok', refreshToken: 'ref', id: 1, duprId: 'AAA111', stats: {} };

  it('toma los tokens que manda la página de DUPR', () => {
    expect(leerMensajeDeLogin({ origin: 'https://uat.dupr.gg', data: datos }, LOGIN)).toEqual({ userToken: 'tok', refreshToken: 'ref' });
    expect(leerMensajeDeLogin({ origin: 'https://uat.dupr.gg', data: JSON.stringify(datos) }, LOGIN)).toEqual({ userToken: 'tok', refreshToken: 'ref' });
    expect(leerMensajeDeLogin({ origin: 'https://uat.dupr.gg', data: { accessToken: 'tok2' } }, LOGIN)).toEqual({ userToken: 'tok2', refreshToken: null });
  });

  it('ignora mensajes de cualquier otra ventana', () => {
    expect(leerMensajeDeLogin({ origin: 'https://sitio-trucho.com', data: datos }, LOGIN)).toBeNull();
    expect(leerMensajeDeLogin({ origin: 'https://uat.dupr.gg.sitio-trucho.com', data: datos }, LOGIN)).toBeNull();
    expect(leerMensajeDeLogin({ origin: 'http://uat.dupr.gg', data: datos }, LOGIN)).toBeNull();
  });

  it('ignora mensajes de DUPR que no traen sesión', () => {
    for (const raro of [null, 'hola', 42, {}, { userToken: '' }, { userToken: 7 }, '{roto']) {
      expect(leerMensajeDeLogin({ origin: 'https://uat.dupr.gg', data: raro }, LOGIN)).toBeNull();
    }
    expect(leerMensajeDeLogin({ origin: 'https://uat.dupr.gg', data: datos }, 'no es una url')).toBeNull();
  });
});
