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
