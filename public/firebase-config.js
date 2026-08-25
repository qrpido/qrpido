// Importamos la versión 10.8.0 exacta para que no choque con tu core-db.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Tu NUEVA configuración de Geokatu:
const firebaseConfig = {
  apiKey: "AIzaSyA3Vc1ra_2LTuayxGAmh28s8uKKUpHnlwc",
  authDomain: "geo-katu.firebaseapp.com",
  databaseURL: "https://geo-katu-default-rtdb.firebaseio.com",
  projectId: "geo-katu",
  storageBucket: "geo-katu.firebasestorage.app",
  messagingSenderId: "637616445634",
  appId: "1:637616445634:web:43c9b87e159acfb39ac35b",
  measurementId: "G-QPJRQYXJVE"
};

// Inicializamos el motor
const app = initializeApp(firebaseConfig);

// Exportamos la base de datos (db) para que core-db.js pueda absorberla
export const db = getFirestore(app);
export { app };