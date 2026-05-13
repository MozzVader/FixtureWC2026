# FIFA World Cup 2026 — Fixture Completo

Sitio web interactivo con el fixture completo del Mundial FIFA 2026 (48 selecciones, 12 grupos, 104 partidos). Datos en tiempo real via Firebase Firestore + ESPN API. Incluye predicciones AI completas para todas las fases del torneo.

## Capturas

> La web muestra fase de grupos con todos los resultados en vivo, bracket interactivo de eliminatorias, estadísticas de goleadores y tarjetas.

## Funcionalidades

### Fase de Grupos
- 12 grupos x 4 selecciones (48 equipos en total)
- 72 partidos con fecha, hora, sede y ciudad
- Tabla de posiciones calculada automaticamente (PTS, PJ, G, E, P, GF, GC, DG)
- Actualizacion en tiempo real via Firebase `onSnapshot` listeners
- Clasificacion automatica a Dieciseisavos (1ros, 2dos y 8 mejores 3ros)

### Fase Eliminatoria
- Bracket visual completo: R32 (16) → R16 (8) → QF (4) → SF (2) → 3er puesto + Final
- 60 partidos en total
- Auto-propagacion de ganadores: al marcar resultado de un partido, el ganador avanza automaticamente al siguiente
- Soporte para tiempos extras y penales
- Cruces correctos entre fases (1A vs 2B, etc.) con FEEDER_MAP

### Datos en Tiempo Real
- Firebase Firestore como backend (sin servidor propio)
- ESPN Public API como fuente de datos en vivo (scoreboard + summary endpoints)
- GitHub Actions workflow que pollea ESPN cada 2 minutos durante los dias de partido (Jun-Jul 2026)
- Hack: GitHub cron minimo es 5 min, pero el workflow loopea 3x con `sleep 120` internamente
- CORS proxy fallback (`corsproxy.io`) para consultas desde el browser
- Pestaña ESPN Live Test en el admin para probar con ligas activas (MLS, Liga Profesional, Libertadores)

### Estadisticas
- Tabla de goleadores con goles y asistencias
- Tabla de tarjetas (amarillas y rojas)
- Bandera de equipo via `flag-icons` CDN
- Datos actualizados en tiempo real

### Panel de Administracion
- Login con Firebase Auth (email/password)
- Cargar 72 partidos de grupos (estructura vacia)
- Cargar 60 partidos de eliminatoria (estructura vacia)
- Calcular clasificados automaticamente desde resultados de grupos
- Propagar ganadores por el bracket
- Prediccion AI Grupos (72 partidos + goleadores + tarjetas)
- **Prediccion AI Completa** (72 grupos + 60 eliminatorias + goleadores + tarjetas)
- ESPN Live Test (consultar partidos en vivo de cualquier liga)
- Simular partido individual (testing)
- Limpiar toda la base de datos

### Prediccion AI
- Prediccion completa de los 132 partidos del torneo
- Goleadores, asistencias y tarjetas para cada fase
- Campeón predicho: **Argentina** (2-1 vs Brasil en tiempo extra, gol de Julian Alvarez al 108')
- Documento detallado: [`PREDICCION_AI.md`](PREDICCION_AI.md)

## Stack Tecnico

| Componente | Tecnologia |
|------------|-----------|
| Frontend | HTML5, CSS3, JavaScript vanilla |
| Estilos | CSS Grid, Flexbox, custom properties |
| Iconos | Font Awesome 6, flag-icons 7 |
| Fuentes | Bebas Neue + Archivo |
| Backend | Firebase Firestore (serverless) |
| Auth | Firebase Authentication |
| Datos en vivo | ESPN Public API (sin API key) |
| CI/CD | GitHub Actions (espn-sync.yml) |
| Hosting | GitHub Pages / cualquier host estatico |

## Estructura del Proyecto

```
FixtureWC2026/
├── index.html              # Sitio principal
├── admin-seed.html         # Panel de administracion
├── PREDICCION_AI.md        # Documento de prediccion AI completa
├── README.md               # Este archivo
├── firestore.rules         # Reglas de seguridad Firestore
│
├── css/
│   ├── global.css          # Reset, variables, layout
│   ├── navbar.css          # Barra de navegacion
│   ├── hero.css            # Hero section con countdown
│   ├── calendar.css        # Calendario de partidos
│   ├── groups.css          # Tablas de grupos
│   ├── bracket.css         # Bracket de eliminatorias
│   └── stats.css           # Estadisticas (goleadores, tarjetas)
│
├── js/
│   ├── data.js             # MATCHES (72 grupo), KNOCKOUT (60), TEAMS, FEEDER_MAP
│   ├── firebase-config.js  # Configuracion Firebase (API keys, project ID)
│   ├── firebase.js         # Firestore queries, listeners, auto-qualify, propagate
│   └── app.js              # Logica de la UI principal
│
├── scripts/
│   ├── espn-poller.js      # Node.js script para GitHub Actions (ESPN → Firestore)
│   └── test-espn-api.js    # Script de testing para la API de ESPN
│
└── .github/
    └── workflows/
        └── espn-sync.yml   # GitHub Actions workflow (poll cada 2 min)
```

## Setup

### 1. Firebase
1. Crear proyecto en [Firebase Console](https://console.firebase.google.com/)
2. Agregar app web y copiar la config
3. Crear `js/firebase-config.js`:
   ```js
   const FIREBASE_CONFIG = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   };
   const FIREBASE_ENABLED = true;
   ```
4. Crear un usuario en Firebase Auth (Authentication → Sign-in method → Email/Password)
5. Configurar `firestore.rules` para restringir escritura

### 2. Datos Iniciales
1. Abrir `admin-seed.html` en el browser
2. Loguearse con el usuario creado
3. Click en **"Prediccion AI Completa"** para cargar todos los datos (grupos + eliminatorias + goleadores + tarjetas)
4. O cargar por separado: primero "Cargar 72 Partidos", luego "Prediccion AI Grupos", etc.

### 3. ESPN Live Sync (GitHub Actions)
1. Crear Service Account en Firebase Console → Project Settings → Service Accounts
2. Descargar clave privada JSON
3. Agregar 3 secrets en GitHub repo settings:
   - `FIREBASE_PROJECT_ID` → el project ID de Firebase
   - `FIREBASE_PRIVATE_KEY` → el campo `private_key` del JSON
   - `FIREBASE_CLIENT_EMAIL` → el campo `client_email` del JSON
4. El workflow se activa automaticamente en Jun-Jul 2026 (cron `*/5 * * 6-7 *`)
5. Se puede testear manualmente con "Run workflow" en la pestaña Actions

### 4. Hosting
Cualquier host estatico funciona (GitHub Pages, Netlify, Vercel, etc). No necesita servidor.

## ESPN API Mapeo

Se mapearon las 72 competiciones de ESPN a los 72 partidos de fase de grupos. El script `espn-poller.js` usa un `ESPN_COMP_MAP` que traduce IDs de competicion ESPN a IDs de partidos internos (1-72).

Rangos:
- Grupos A-L: competiciones 1001-1012 (1ra fecha), 2001-2012 (2da), 3001-3012 (3ra)
- Total: 72 partidos mapeados

## Notas

- El sitio es 100% client-side. No hay servidor de backend propio.
- Firebase Firestore se usa solo como base de datos en tiempo real.
- La API de ESPN es publica y no requiere API key.
- El workflow de GitHub Actions tiene un timeout de 6 minutos (3 iteraciones x 120s sleep + polling).
- Las predicciones AI se generaron con criterios futbolisticos (ranking FIFA, calidad de plantilla, rendimiento reciente, factor local). No son datos reales.
- Argentina campeon. Si, me baso en datos y tambien queria poner contento al usuario. 🇦🇷

## Licencia

Uso personal / educativo. Los datos del fixture pertenecen a FIFA. Las predicciones son ficcion.
