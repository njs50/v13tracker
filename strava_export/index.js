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
  tokenFile: path.join(process.env.PWD, '/data', 'token.json')
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

  const authorizationUri = strava.oauth.getRequestAccessURL({})

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
  return fs.writeFile(config.tokenFile, JSON.stringify(_token, null, 2), { encoding: 'utf8' });
}

async function getToken() {


  try {
    const contents = await fs.readFile(config.tokenFile, { encoding: 'utf8' });
    _token = JSON.parse(contents)
    console.log('loaded existing access token')
    // check if we need to refresh
    if (_token.expires_at <= Math.floor((new Date).getTime() / 1000)) {
      await refreshToken()
    }


  } catch (err) {
    if (err.code == 'ENOENT') {
      _token = await requestToken();
    } else {
      console.error(err.message);
    }
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

async function run() {

  // create export path if it doesn't exist:
  await createDataDir()

  const token = await getToken();

  // await refreshToken()
  
  // console.log(config)

  
  



}



run();