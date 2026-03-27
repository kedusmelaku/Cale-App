const { google } = require('googleapis');
const fs = require('fs');

// load the credentials from the file google gave you
const credentials = JSON.parse(fs.readFileSync('credentials.json'));

// pull out the three things we need from the credentials file
const { client_id, client_secret, redirect_uris } = credentials.installed;

// create the auth client
const auth = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
);

// check if we already have a saved token from a previous login
if (fs.existsSync('token.json')) {
    // if we do, load it and skip the whole login process
    const tokens = JSON.parse(fs.readFileSync('token.json'));
    auth.setCredentials(tokens);
    console.log('Loaded existing token');
} else {
    // if we dont, generate the url for the employer to approve access
    const authUrl = auth.generateAuthUrl({
        access_type: 'offline',
        scope: 'https://www.googleapis.com/auth/calendar.readonly'
    });
    console.log('Go to this URL to authorize access:', authUrl);
}

module.exports = auth; // export the auth client so other files can use it