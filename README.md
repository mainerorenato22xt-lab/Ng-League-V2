# NG League 2.0

Plataforma oficial de NG League: competición, clubes, jugadores, plantillas, mercado e historia.

- Interfaz: React, TypeScript y Vite, publicada en GitHub Pages.
- Datos, acceso y permisos: Supabase (PostgreSQL, Auth, RLS y Storage).
- Migraciones: `supabase/migrations`.

## Desarrollo

```bash
npm ci
npm run dev
npm run build
```

Las variables están en `.env.example`. El frontend solo usa la URL del proyecto y la clave publicable.
La clave secreta de Supabase nunca debe agregarse al repositorio ni a una variable `VITE_`.
