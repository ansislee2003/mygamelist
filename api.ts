import axios from 'axios';
import { auth } from "@/FirebaseConfig";
import {id} from "ci-info";

const api = axios.create({
    baseURL: "https://api-idspf7h7kq-uc.a.run.app", // replace with your backend
    timeout: 10000,
});

api.interceptors.request.use(async (config) => {
    const user = auth.currentUser;

    if (user) {
        const idToken = await user.getIdToken();
        config.headers.Authorization = `Bearer ${idToken}`;
    }

    return config;
});

export default api;