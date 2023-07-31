import open from 'open';
import express from 'express';

import strava from 'strava-v3';

import * as fsNonPromise from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as https from 'node:https';

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
  refreshToken()

  // set the access token for the client to use
  strava.client(_token.access_token)  

  

  return _token;

}


async function refreshToken() {

  // refresh if token expires in the next minute
  if (_token.expires_at - 60 <= Math.floor((new Date).getTime() / 1000)) {
      
    const payload = await strava.oauth.refreshToken(_token.refresh_token)
    
    for (const key in payload) {
      _token[key] = payload[key]
    }

    strava.client(_token.access_token)

    console.log('refreshed existing access token')

    // write updated token to disk
    await writeToken()  

  }

}

async function createDir(dir) {
  try {
    const createDir = await fs.mkdir(dir);
  } catch (err) {
    if (err.code != 'EEXIST') {
      console.error(err.message);
    }    
  }  
}


async function createDataDir() {
  createDir(config.exportPath);
  createDir(path.join(config.exportPath, '/activities')); 
}

function loadActivities() {
  return readFile('activities.json') || [];
}

async function getActivities() {

  let params  = {
    // before: getEpoch(new Date('2015-10-21')),
    per_page: 30,
    page: 1      
  }

  let results = await loadActivities();

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

function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
} 

function getEpoch(date) {
  return Math.ceil(date.getTime() / 1000)
}


async function getActivity(id) {

  if (strava.rateLimiting.fractionReached() > 0.95) {
    console.log(`waiting 15 minutes to prevent API throttling`);
    await delay(15 * 60 * 1000); // 15 minute delay
  }

  const fn = `activities/${id}/activity.json`

  let data = await readFile(fn)
  
  if (data !== null) {
    console.log(`loaded activity ${id} from cache`);
    return data
  } else {
    console.log(`loaded activity ${id} from strava`);
    data = await strava.activities.get({id: id, include_all_efforts: true})
    await createDir(path.join(config.exportPath, '/activities', id.toString())); 
    await writeFile(fn, data) 
  }

  return data

}

async function getActivitiesData() {

  const activities = await getActivities()

  for (let activity of activities) {    
    // check if we need to refresh the access token
    refreshToken()    
    const data = await getActivity(activity.id);

    if (data.total_photo_count > 0) {
      await getActivityPhotos(data.id);
    }   

  }

}

async function getActivitiesPhotos() {

  const activities = await getActivities()

  for (let activity of activities) {
    // check if we need to refresh the access token
    refreshToken()    
    if (activity.total_photo_count > 0) {
      await getActivityPhotos(activity.id);
    }
  }

}

async function download(url, fn) {

  let resolve;

  const p = new Promise((_resolve) => {
    resolve = _resolve;
  });

  https.get(url, (res) => {   
    
    const writeStream = fsNonPromise.createWriteStream(path.join(config.exportPath,fn));    
    res.pipe(writeStream);
  
    writeStream.on("finish", () => {
      writeStream.close();
      console.log(`downloaded: ${url}`);
      resolve()
    });

  });

  return p;
}

async function getActivityPhotos(id) {

  if (strava.rateLimiting.fractionReached() > 0.95) {
    console.log(`waiting 15 minutes to prevent API throttling`);
    await delay(15 * 60 * 1000); // 15 minute delay
  }

  const fn = `activities/${id}/photos.json`
  const dir = path.join(config.exportPath,`activities/${id}`)

  let data = await readFile(fn)
  
  if (data !== null) {
    console.log(`loaded activity ${id} photos from cache`);
  } else {
    data = await strava.activities.listPhotos({id: id, size: 2048})
    await writeFile(fn, data)
    console.log(`loaded activity ${id} photos from strava`);
  }

  const files = await fs.readdir(dir);

  // download image files
  for (const photo of data) {    
    const url = photo.urls['2048']
    if (url && !url.match(/placeholder-photo/)) {
      const ext = path.extname(url.replace(/\?.*$/,''))
      const fn = `${photo.unique_id}${ext}`
      const fp = `activities/${id}/${fn}`
      if (files.indexOf(fn) == -1) {
        await download(url, fp);
        await delay(2000 + (Math.random() * 3000)) // 2-5 sec delay to help prevent us getting rate limited
      }
    } else {
      console.error(`Missing photo in activity: ${id}`)
    }
  }


  return data

}

async function run() {

  // create export path if it doesn't exist:
  await createDataDir()

  // get us logged in
  const token = await getToken();

  // check if token needs to be refreshed
  await refreshToken()
  
  await getActivitiesData()

  // const activities = await getActivities()
  // const photoActivity = activities.find(activity => activity.total_photo_count > 0 && activity.type == "Ride" && !activity.trainer)

  // console.log(await getActivityPhotos(9434568102)) //  

  // console.log(await getActivityPhotos(6764901674)) 

  // await (getActivitiesPhotos())

  console.log('done');


}



run();