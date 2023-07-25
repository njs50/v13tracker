import open from 'open';
import express from 'express';

import strava from 'strava-v3';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const config = {
  client: {
    id: process.env.STRAVA_CLIENT_ID,
    secret: process.env.STRAVA_CLIENT_SECRET,
    redirect_uri: 'http://localhost:3000/oauth',
    scope: 'read,read_all,profile:read_all,activity:read,activity:read_all',
  },
  exportPath: path.join(process.env.PWD, '/data'),
};

let _token


async function requestToken() {

  // need to get a new token
  const app = express();

  let resolve;

  const p = new Promise((_resolve) => {
    resolve = _resolve;
  });

  app.get('/oauth', function(req, res) {
    resolve(req.query.code);
    res.end('Authenticated with Strava, you can now close this window');
  });
  const server = await app.listen(3000);

  // const authorizationUri = `${config.auth.tokenHost}/oauth/authorize?state=&response_type=code&client_id=${config.client.id}&scope=${config.client.scope}&redirect_uri=${config.client.redirect_uri}`;

  strava.config({
    "client_id"     : config.client.id,
    "client_secret" : config.client.secret,
    "redirect_uri"  : config.client.redirect_uri,
  }); 

  const authorizationUri = strava.oauth.getRequestAccessURL({scope: config.client.scope})

  console.log('the code uri is: ', authorizationUri)

  open(authorizationUri);

  // Wait for the first auth code
  const code = await p;

  // console.log('the code is: ', code)

  await server.close();  

  // exchange code for a token
  _token = await strava.oauth.getToken(code)

  console.log('recieved new access token')

  // write to disk
  await writeToken()

  return _token

}

function writeToken() {
  return writeFile('token.json', _token)   
}

function writeFile(fn, data) {
  return fs.writeFile(path.join(config.exportPath, fn), JSON.stringify(data, null, 2), { encoding: 'utf8' });
}

async function readFile(fn) {
  try {
    const contents = await fs.readFile(path.join(config.exportPath, fn), { encoding: 'utf8' });
    return JSON.parse(contents);
  } catch (err) {
    if (err.code == 'ENOENT') {
      return null
    } else {
      console.error(err.message);
    }
  }  
}

async function getToken() {

  _token = await readFile('token.json')

  if (_token == null) {
    _token = await requestToken();
  } else {
    console.log('loaded existing access token');
  }
  // check if we need to refresh
  if (_token.expires_at <= Math.floor((new Date).getTime() / 1000)) {
    await refreshToken()
  }

  // set the access token for the client to use
  strava.client(_token.access_token)  

  

  return _token;

}


async function refreshToken() {

  const payload = await strava.oauth.refreshToken(_token.refresh_token)
  
  for (const key in payload) {
    _token[key] = payload[key]
  }

  strava.client(_token.access_token)

  console.log('refreshed existing access token')

  // write updated token to disk
  await writeToken()  

}

async function createDataDir() {

  try {
    const createDir = await fs.mkdir(config.exportPath);
  } catch (err) {
    if (err.code != 'EEXIST') {
      console.error(err.message);
    }    
  }

}


async function getActivities() {

  let params  = {
    // before: getEpoch(new Date('2015-10-21')),
    per_page: 30,
    page: 1      
  }

  let results = await readFile('activities.json') || [];

  // if this is the first run load 200 items at a time
  if (results.length == 0) {
    params.per_page = 200
  }

  let payload;

  let loadedOldRecords = false

  try {

    do {

      payload = await strava.athlete.listActivities(params)
      
      // remove any existing activites from the payload
      for (const activity of results) {
        const idx = payload.findIndex(newActivity => newActivity.id == activity.id)
        if (idx > -1) {          
          payload.splice(idx,1)
        }
      }

      results = results.concat(payload)

      params.page = params.page + 1
      console.log('records loaded: ' + payload.length + ', results total: ' + results.length)

    } while (payload.length == params.per_page)    

    await writeFile('activities.json', results)

    return results

  } catch (err) {
    console.error(err.message);
  }


}

function getEpoch(date) {
  return Math.ceil(date.getTime() / 1000)
}

async function run() {

  // create export path if it doesn't exist:
  await createDataDir()

  // get us logged in
  const token = await getToken();

  const activities = await getActivities()

  // console.log(activities)

  console.log(strava.rateLimiting.fractionReached());

}



run();