/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const logger = require("firebase-functions/logger");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

const functions = require('firebase-functions');
const express = require('express');
const app = express();
const axios = require('axios');
const apicache = require('apicache');
const cache = apicache.middleware;
const {ref, getDownloadURL} = require("@firebase/storage");

// firestore
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount);
    storageBucket: "gs://mygamelist-3c79d.firebasestorage.app";
});
const db = admin.firestore();
const bucket = admin.storage().bucket();

const { defineString } = require('firebase-functions/params');
const IGDB_CLIENT_ID = defineString('IGDB_CLIENT_ID');
const IGDB_CLIENT_SECRET = defineString('IGDB_CLIENT_SECRET');
let IGDB_AUTHORIZATION = null;
let IGDB_HEADERS = null;

const buildIGDBHeaders = async (isUpdate = false) => {
    try {
        if (isUpdate || !IGDB_HEADERS) {
            const response = await db.collection('oauth').doc('igdb').get();
            IGDB_AUTHORIZATION = response.data()?.IGDB_AUTHORIZATION ?? null;

            IGDB_HEADERS = {
                'Client-ID': IGDB_CLIENT_ID.value(),
                'Authorization': IGDB_AUTHORIZATION,
                'Accept': 'application/json',
                'Content-Type': 'text/plain'
            };

            return IGDB_HEADERS;
        }
        else { return IGDB_HEADERS; }
    }
    catch (error) {
        console.log("Failed to build headers", error);
    }
}

const qs = require('qs');

const api = axios.create({
    timeout: 5000,
    retryLimit: 3,
    retryDelayMax: 5000
});

api.interceptors.response.use(null, async error => {
    const reqConfig = error.config;
    reqConfig.retryCount = (reqConfig.retryCount ?? 0);
    reqConfig.retryDelay = (reqConfig.retryDelay ?? 1000);

    // check if error is status 401, if yes, refresh OAuth tokens
    if (error.response?.status === 401) {
        try {
            const OAuthRefreshResponse = await axios.post(
                'https://id.twitch.tv/oauth2/token',
                qs.stringify({
                    client_id: IGDB_CLIENT_ID.value(),
                    client_secret: IGDB_CLIENT_SECRET.value(),
                    grant_type: 'client_credentials'
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            )
            console.log('Updating OAuth')

            // update IGDB_AUTHORIZATION in firestore
            const newOAuth = OAuthRefreshResponse.data.token_type + ' ' + OAuthRefreshResponse.data.access_token;
            await db.collection('oauth').doc('igdb').set({
                'IGDB_AUTHORIZATION': newOAuth
            })
            await buildIGDBHeaders();
        }
        catch (OAuthRefreshError) {
            console.log('Updating OAuth Failed:', OAuthRefreshError);
            return Promise.reject(error);
        }
    }
    console.log('failed POST request:', reqConfig.url)

    if (reqConfig.retryCount < (reqConfig.retryLimit ?? 0)) {
        // exponential delay
        await new Promise(resolve => setTimeout(resolve, reqConfig.retryDelay))

        // retry req if failed
        console.log('retrying failed POST request:', reqConfig.url)
        reqConfig.retryCount++;
        reqConfig.retryDelay = Math.min(reqConfig.retryDelay * 2, reqConfig.retryDelayMax ?? 5000);
        return api(reqConfig);
    }

    // retryLimit exceeded
    return Promise.reject(error);
})

app.use(async (req, res, next) => {
    // check format and extract idToken
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith('Bearer ')
        ? authHeader.split(" ")[1]
        : null;

    if (!idToken) {
        return res.status(401).send('Not authorized: Missing token');
    }

    try {
        req.user = await admin.auth().verifyIdToken(idToken);
        next();
    } catch (error) {
        return res.status(401).send('Not authorized: Invalid token');
    }
})

app.get('/hello', async (req, res) => {
    res.send('Hello from Firebase!');
});

// get top 10 trending games
app.post('/getTrendingGames', cache('3 hours'), async (req, res) => {
    console.log("/getTrendingGames: Fetching data from IGDB");

    const igdb_headers = await buildIGDBHeaders();
    const query1 = `
      fields game_id, value, popularity_type;
        where popularity_type = 5;
        sort value desc;
        limit 10;`

    api.post(
        'https://api.igdb.com/v4/popularity_primitives/',
        query1,
        { headers: igdb_headers }
    )
    .then(response  => {
        const gameID = response.data.map(g => g.game_id);
        const query2 = `
          fields name, cover.url, total_rating, total_rating_count;
          where id = (${gameID.join(',')});`

        return api.post(
            'https://api.igdb.com/v4/games/',
            query2,
            { headers: igdb_headers }
        )
    })
    .then(response  => {
        res.send(response.data);
    })
    .catch(error => {
        console.error("/getTrendingGames:", error.message);
        return res.json({error: error.message});
    })
})

// get top 10 rated games of all time
app.post('/getTopGames', cache('3 hours'), async (req, res) => {
    console.log("/getTopGames: Fetching data from IGDB");

    const igdb_headers = await buildIGDBHeaders();
    const query = `
      fields name, cover.url, total_rating, total_rating_count;
      where total_rating_count > 500;
      sort total_rating desc;
      limit 10;`

    api.post(
        'https://api.igdb.com/v4/games/',
        query,
        { headers: igdb_headers }
    )
    .then(response  => {
        return res.json(response.data);
    })
    .catch(error => {
        console.error("/getTopGames:", error.message);
        return res.json({error: error.message});
    })
})

// get top 10 rated new games (released no more than 6 months ago, 1 month = 30 days)
app.post('/getTopNewGames', cache('3 hours'), async (req, res) => {
    console.log("/getTopNewGames: Fetching data from IGDB");

    const igdb_headers = await buildIGDBHeaders();
    const newThreshold = new Date().setHours(0, 0, 0, 0) - (6*30*24*60*60*1000);
    const newThresholdUnix = Math.floor(newThreshold / 1000);
    const query = `
      fields name, cover.url, total_rating, total_rating_count;
      where first_release_date >= ${newThresholdUnix} & total_rating_count > 50;
      sort total_rating desc;
      limit 10;`

    api.post(
        'https://api.igdb.com/v4/games/',
        query,
        { headers: igdb_headers }
    )
    .then(response  => {
        console.log("TOP NEW GAMES", response.data)
        return res.json(response.data);
    })
    .catch(error => {
        console.error("/getTopNewGames:", error.message);
        return res.json({error: error.message});
    })
})

// search games by name
app.post('/getGamesByName', async (req, res) => {
    const { searchTerm, searchOffset } = req.body;
    console.log("/getGamesByName: Fetching data from IGDB");

    const igdb_headers = await buildIGDBHeaders();

    // short queries (1-2 char), only return titles starting with the search term
    // long queries (>2 char), returns any title with search term substring
    const query = searchTerm.length < 3 ? `
      fields name, cover.url, total_rating, total_rating_count;
      where name ~ "${searchTerm}"*;
      sort total_rating_count desc;
      limit 10;
      offset ${searchOffset};` : `   
      fields name, cover.url, total_rating, total_rating_count;
      where name ~ *"${searchTerm}"*;
      sort total_rating_count desc;
      limit 10;
      offset ${searchOffset};`

    api.post(
        'https://api.igdb.com/v4/games/',
        query,
        { headers: igdb_headers }
    )
    .then(response  => {
        return res.json(response.data);
    })
    .catch(error => {
        console.error("/getTopNewGames:", error.message);
        return res.json({error: error.message});
    })
})

// get game info by id
app.post('/getGameById', async (req, res) => {
    const { gameID } = req.body;

    if (!gameID) {
        res.json({error: 'Missing gameID'});
    }

    const igdb_headers = await buildIGDBHeaders();
    const query = `
      fields name, cover.url, first_release_date, genres.name, involved_companies.company.name, involved_companies.developer, platforms.name, storyline, summary, total_rating, total_rating_count, game_type.type;
      where id = ${gameID};`

    api.post(
        'https://api.igdb.com/v4/games/',
        query,
        { headers: igdb_headers }
    )
    .then(response  => {
        // only return developer companies in involved_companies
        let games = response.data[0];
        games.involved_companies = games.involved_companies?.filter(c => c.developer);

        return res.json(games);
    })
    .catch(error => {
        console.error("/getGameById:", error.message);
        return res.json({error: error.message});
    })
})

app.post('/user/uploadAvatarByUID', async (req, res) => {
    const { uid } = req.body;
    const filename = uid ? `avatar/${uid}.png` : 'avatar/default_profile';

    try {
        const [url] = await bucket
            .file(filename)
        return res.json(url);
    }
    catch (error) {
        console.error("/getUserAvatarByUID:", error.message);
        return res.json({error: error.message});
    }
})

exports.api = functions.https.onRequest(app);

