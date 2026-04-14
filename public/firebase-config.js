// Importamos la versión 10.8.0 exacta para que no choque con tu core-db.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Tu configuración real:
const firebaseConfig = {
  apiKey: "AIzaSyAhliftxY_cRkdij4zyjhIqJxQ1pddHPd4",
  authDomain: "qrpido-oficial.firebaseapp.com",
  projectId: "qrpido-oficial",
  storageBucket: "qrpido-oficial.firebasestorage.app",
  messagingSenderId: "136820849349",
  appId: "1:136820849349:web:8f1531f245bf14a6caceac"
};

// Inicializamos el motor
const app = initializeApp(firebaseConfig);

// Exportamos la base de datos (db) para que core-db.js pueda absorberla
export const db = getFirestore(app);
export { app };
