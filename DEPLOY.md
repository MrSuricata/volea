# VOLEA - Guía de Deploy

## 1. Desarrollo Local

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev
# Abre en http://localhost:3000

# Build de producción
npm run build
```

## 2. Deploy en Vercel (Hoy)

### Opción A: Vercel CLI (más rápido)
```bash
# Instalar Vercel CLI
npm i -g vercel

# Deploy (te pide login la primera vez)
npx vercel

# Para producción
npx vercel --prod
```

### Opción B: Conectar repositorio GitHub
1. Subir el código a un repo de GitHub
2. Ir a [vercel.com](https://vercel.com) > New Project
3. Importar el repositorio
4. Framework Preset: Vite
5. Build Command: `npm run build`
6. Output Directory: `dist`
7. Click Deploy

### Variables de entorno (opcional)
En Vercel Dashboard > Settings > Environment Variables:
- `VITE_ADMIN_PASSWORD`: Contraseña del admin (default: adminvolea)

## 3. Dominio personalizado (opcional)
1. Vercel Dashboard > tu proyecto > Settings > Domains
2. Agregar tu dominio (ej: volea.uy)
3. Configurar DNS según las instrucciones de Vercel

## 4. Migración a Supabase (futuro)

### Paso 1: Crear proyecto Supabase
1. Ir a [supabase.com](https://supabase.com) > New Project
2. Elegir región: South America (São Paulo)
3. Guardar la contraseña de la base de datos

### Paso 2: Crear tablas
1. Dashboard > SQL Editor > New Query
2. Copiar y pegar el contenido de `supabase-schema.sql`
3. Click Run

### Paso 3: Configurar Storage
1. Dashboard > Storage > Create new bucket
2. Nombre: `product-images`, Public: true
3. File size limit: 5MB

### Paso 4: Obtener credenciales
1. Dashboard > Settings > API
2. Copiar `Project URL` y `anon public key`

### Paso 5: Agregar variables de entorno
En Vercel (o en archivo `.env.local` para desarrollo):
```
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
```

### Paso 6: Instalar cliente Supabase
```bash
npm install @supabase/supabase-js
```

### Paso 7: Crear servicio Supabase
Crear `src/services/supabaseService.ts` que implemente la misma interfaz que `storageService.ts` pero usando el cliente de Supabase.

## 5. Panel de Admin

- URL: `tudominio.com/#/admin`
- Contraseña: `adminvolea`
- Funciones: Gestión de productos, eventos, pedidos y categorías
- Los cambios se guardan en localStorage (hasta migrar a Supabase)

## 6. WhatsApp Business
- Los pedidos se envían por WhatsApp al +598 99 511 196
- Considerá usar WhatsApp Business para respuestas automáticas

## 7. Notas importantes
- Las imágenes de productos están en `/public/products/`
- Para agregar nuevas imágenes, subilas a esa carpeta y usá la ruta `/products/nombre.png`
- El sitio funciona 100% sin backend (localStorage)
- Para múltiples dispositivos/administradores, migrá a Supabase
