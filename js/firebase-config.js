/**
 * WC2026 — Firebase Configuration
 *
 * INSTRUCCIONES:
 * 1. Ir a https://console.firebase.google.com/
 * 2. Crear un nuevo proyecto (ej: "wc2026-fixture")
 * 3. Agregar app web → copiar la configuración
 * 4. Habilitar Firestore Database (modo de prueba o producción)
 * 5. Pegar la configuración abajo
 * 6. Cambiar FIREBASE_ENABLED a true
 *
 * Plan gratuito: 50k lecturas/día, 20k escrituras/día
 * Mas que suficiente para un Mundial!
 */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCEFRiPpwe5iylULMPaCBQR6SPJ3JO0F0o",
  authDomain: "wc2026-b5078.firebaseapp.com",
  projectId: "wc2026-b5078",
  storageBucket: "wc2026-b5078.firebasestorage.app",
  messagingSenderId: "120662227375",
  appId: "1:120662227375:web:73a9985773e47548b2575a"
};

// Cambiar a true una vez configurado
const FIREBASE_ENABLED = true;
