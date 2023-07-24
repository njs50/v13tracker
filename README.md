
# v13 mission tracker

One day this might be able to track a multiday bikepacking mission. 


## Status

Currently implementing a node.js cli to extract data from Strava.

- Implemented OAuth auth w/Strava to gain access to Strava api.



## Setup

needs the following env variables setup:
```bash
STRAVA_CLIENT_ID=xxx
STRAVA_CLIENT_SECRET=xxx
```

## Usage

```bash
pnpm install
pnpm run strava
```
this should open a browser and prompt for authentication. auth token is currently stored in ./data/token.json, to prevent rate-limiting during development. 

**Do not share this file as it will provide API access to your account**.

