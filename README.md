# Clocks Estudio Barbería — App de Reservas

## Setup rápido

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
Crea un archivo `.env` en la raíz:
```
VITE_SUPABASE_URL=https://vnteegsddpwdalhsiqzl.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key-de-supabase
```

### 3. Desarrollo local
```bash
npm run dev
```

### 4. Desplegar en Vercel
1. Sube este proyecto a un repositorio en GitHub
2. Ve a [vercel.com](https://vercel.com) y conecta tu cuenta de GitHub
3. Importa el repositorio
4. En "Environment Variables" añade:
   - `VITE_SUPABASE_URL` → tu URL de Supabase
   - `VITE_SUPABASE_ANON_KEY` → tu anon key
5. Deploy

Vercel te dará una URL tipo `clocks-booking.vercel.app`. 
Esa es la URL que pones en los botones "Reservar" de la landing HTML.

## Email de confirmación de cita

La función serverless `api/send-confirmation.js` envía un email de confirmación
al cliente al reservar, usando el SMTP de Gmail (vía `nodemailer`). No requiere
dominio propio: los correos salen desde la cuenta de Gmail del negocio. Requiere
estas variables de entorno **en Vercel** (server-side, no llevan el prefijo
`VITE_`):

- `GMAIL_USER` — dirección Gmail del negocio (ej. `clocks.studioapp@gmail.com`).
- `GMAIL_APP_PASSWORD` — "Contraseña de aplicación" de 16 caracteres generada en
  la cuenta Google (requiere verificación en 2 pasos activada). NO es la
  contraseña normal de la cuenta. Se genera en
  https://myaccount.google.com/apppasswords
- `SUPABASE_URL` — URL del proyecto Supabase.
- `SUPABASE_SERVICE_KEY` — service role key de Supabase. **Nunca** se expone al
  cliente; solo la usa la función serverless.

Límite de envío de Gmail: ~500 correos/día (suficiente para este uso).
