const { google } = require('googleapis');
const auth = require('./auth'); // import the auth client we just set up

// create a calendar client using the auth client
const calendar = google.calendar({ version: 'v3', auth });

const getEvents = async () => {
    const response = await calendar.events.list({
        calendarId: 'primary', // 'primary' means the main calendar of the logged in account
        timeMin: new Date().toISOString(), // only get events from now onwards
        maxResults: 10, // just grab 10 events for now to test
        singleEvents: true, // expand recurring events into individual instances
        orderBy: 'startTime', // sort by start time
    });

    const events = response.data.items;
    console.log('Events found:', events.length);
    events.forEach(event => {
        console.log(event.summary, event.start.dateTime);
    });
}

getEvents();