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
const { Buffer } = require('buffer');
const {ref, getDownloadURL} = require("@firebase/storage");
const qs = require('qs');
const {fileTypeFromBuffer} = require("file-type");
const { v4: uuidv4 } = require('uuid');

// formData parser
const Busboy = require('busboy');

// firestore
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "mygamelist-3c79d.firebasestorage.app",
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
    // if (req.user.isAnonymous || !req.user.emailVerified) {
    if (req.user.isAnonymous) {
        return res.status(401).send({ error: "Custom avatar is only accessible for email verified accounts." });
    }

    const busboy = Busboy({ headers: req.headers });
    const filepath = `avatar/${req.user.uid}`;

    console.log(req.user.uid);

    let uploadData = null;

    busboy.on('file', (fieldName, file, info) => {
        const { filename, encoding, mimetype } = info;
        const chunks = [];

        file.on('data', chunk => {
            chunks.push(chunk);
        });

        file.on('end', () => {
            uploadData = {
                fileBuffer: Buffer.concat(chunks),
                mimetype: mimetype,
                filename: filepath
            };
        });
    });

    busboy.on('finish', async () => {
        try {
            if (!uploadData || !uploadData.fileBuffer) {
                return res.status(400).send({ error: "No file data received or processed." });
            }

            if (uploadData.fileBuffer.length === 0) {
                return res.status(400).send({ error: "Received an empty file." });
            }

            const detectedFileType = await fileTypeFromBuffer(uploadData.fileBuffer);
            if (detectedFileType?.mime === "image/jpeg" || detectedFileType?.mime === "image/png") {
                if (uploadData.fileBuffer.length > 2 * 1024 * 1024) {
                    return res.status(400).json({ error: "File size larger than 2MB" });
                }

                // upload to fireback storage with uid as filename
                const token = uuidv4();
                const image = bucket.file(filepath);
                await image.save(uploadData.fileBuffer, {
                    contentType: detectedFileType.mime,
                    metadata: {
                        metadata: {
                            firebaseStorageDownloadTokens: token
                        }
                    }
                });
                console.log("/uploadAvatarByUID uploaded to fire storage");

                // update firebase auth with new photoURL
                const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filepath)}?alt=media&token=${token}`;
                await admin.auth().updateUser(req.user.uid, {
                    photoURL: url
                })
                console.log("Check uploaded url", url)

                return res.status(200).send({ url: url });
            }
            else {
                return res.status(400).json({ error: "Invalid file type" });
            }
        }
        catch (error) {
            console.error(`/uploadAvatarByUID:`, error);
            return res.status(500).send({ error: "Failed to upload avatar." });
        }
    });

    busboy.end(req.rawBody);
})

exports.api = functions.https.onRequest(app);

