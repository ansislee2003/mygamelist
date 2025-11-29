// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import AsyncStorage from '@react-native-async-storage/async-storage';
import {getStorage} from "@firebase/storage";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCEqE9kULaPJaK8oP0NfO2AvQn82dhKyX0",
    authDomain: "mygamelist-3c79d.firebaseapp.com",
    projectId: "mygamelist-3c79d",
    storageBucket: "mygamelist-3c79d.firebasestorage.app",
    messagingSenderId: "996800517153",
    appId: "1:996800517153:web:6b0c2cdbed020c74c73f60"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage)
});
export const db = getFirestore(app);
export const storage = getStorage(app, "gs://mygamelist-3c79d.firebasestorage.app");
