//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const electron = require("electron");
const { Notification } = require("electron");
const envfile = require("envfile");
const url = require("url");
const path = require("path");
const axios = require("axios");
const { app, BrowserWindow, ipcMain } = electron;
const fs = require("fs");
const { google } = require("googleapis");
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

const TOKEN_PATH = "token.json";

require("dotenv").config({
  path: path.resolve(__dirname, "./.env"),
});

let mainWindow;
let events = [];
let authUrl;
let city = process.env.CITY;
let minutesBeforeNotification = process.env.NOTIFICATION_INTERVAL;
let isDev = process.env.ENV === "dev" ? true : false;
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function createMainWindow() {
  mainWindow = new BrowserWindow({
    frame: isDev ? true : false,
    width: 360,
    height: isDev ? 510 : 467,
    x: 1180,
    y: 0,
    resizable: isDev ? true : false,
    fullscreenable: isDev ? true : false,
    opacity: 0.8,
    skipTaskbar: isDev ? false : true,
    movable: true,
    webPreferences: {
      nodeIntegration: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "mainWindow.html"),
      protocol: "file:",
      slashes: true,
    })
  );

  mainWindow.on("closed", function () {
    mainWindow = null;
    app.quit();
  });
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function fetchWeather() {
  let response = await axios
    .get(
      `https://api.openweathermap.org/data/2.5/weather?q=${city}&APPID=${process.env.OPENWEATHER_API_KEY}&units=metric`
    )
    .catch((err) => {
      mainWindow.webContents.send("error-occured", err.response.data.message);
      console.log(err.response.data.message);
    });


  mainWindow.webContents.send("weather-data", response.data);
}

function fetchDatetime() {
  let options = {
      weekday: "long",
      timeZone: `Europe/Athens`,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    },
    formatter = new Intl.DateTimeFormat([], options);

  let datetime = formatter.format(new Date());
  mainWindow.webContents.send("datetime", datetime);
}

function eventNotify() {
  for (let event of events) {
    if (event.notified) return;

    let dateEvent = new Date(event.datetime);
    let hour12 = dateEvent.getHours() % 12;
    if (!hour12) hour12 += 12;
    let minute = dateEvent.getMinutes();

    let dateNow = new Date();
    let hour12Now = dateNow.getHours() % 12;
    if (!hour12Now) hour12Now += 12;
    let minuteNow = dateNow.getMinutes() + parseInt(minutesBeforeNotification);

    if (parseInt(minuteNow) >= 59) {
      minuteNow -= 59;
      hour12Now += 1;
    }

    if (hour12 === hour12Now && minute <= minuteNow) {
      new Notification({
        title: "Upcoming Event",
        body: `${event.datetime} - ${event.descr}`,
      }).show();
      event.notified = !event.notified;
    }
  }
}

async function authAndGetEvents() {
  await fs.readFile("credentials.json", (err, content) => {
    if (err) {
      mainWindow.webContents.send("error-occured", err);
      return console.log("Error loading credentials.json file:", err);
    }
    // Authorize a client with credentials, then call the Google Calendar API.
    authorize(JSON.parse(content), listEvents);
  });
}

setInterval(function () {
  fetchWeather();
}, 60000);

setInterval(function () {
  fetchDatetime();
}, 1000);

setInterval(function () {
  eventNotify();
}, 20000);

setInterval(function () {
  authAndGetEvents();
}, 600000);

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
app.on("ready", function () {
  createMainWindow();

  mainWindow.webContents.on("did-finish-load", function () {
    fetchWeather();
    fetchDatetime();
    authAndGetEvents().then(eventNotify());
  });
});

// Quit when all windows are closed.
app.on("window-all-closed", function () {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) createMainWindow();
});

ipcMain.on("get-events", (event) => {
  authAndGetEvents();
});

ipcMain.on("settings-changed", (event, data) => {

  const sourcePath = ".env";

  let parsedFile = envfile.parse(sourcePath);

  parsedFile.CITY = data.city ? data.city : process.env.CITY;
  parsedFile.OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
  parsedFile.TIMEZONE = process.env.TIMEZONE;
  parsedFile.ENV = process.env.ENV;
  parsedFile.WORK_CALENDAR = process.env.WORK_CALENDAR;
  parsedFile.NOTIFICATION_INTERVAL = data.minutes
    ? data.minutes
    : process.env.NOTIFICATION_INTERVAL;

  fs.writeFileSync("./.env", envfile.stringify(parsedFile));

  city = data.city ? data.city : process.env.CITY;
  minutesBeforeNotification = data.minutes
    ? data.minutes
    : process.env.NOTIFICATION_INTERVAL;
  fetchWeather();
  eventNotify();
});

ipcMain.on("sign-in-google", () => {
  electron.shell.openExternal(authUrl);
});

ipcMain.on("google-code", (event, code) => {
  process.env.GOOGLE_CAL_KEY = code;
  authAndGetEvents();
});

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//Google Calendar API stuff

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) {
      return getAccessToken(oAuth2Client, callback);
    }
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
  authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  code = process.env.GOOGLE_CAL_KEY;

  if (!code) {
    mainWindow.webContents.send("events-mess", {
      mess:
        "<button class='button is-primary' id='signInGoogle'>Sign in to Google <i class='fa fa-sign-in' aria-hidden='true'></i></button>",
    });

    return;
  }

  oAuth2Client.getToken(code, (err, token) => {
    if (err) {
      mainWindow.webContents.send("error-occured", err);
      return console.error("Error retrieving access token", err);
    }
    oAuth2Client.setCredentials(token);
    // Store the token to disk for later program executions
    fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
      if (err) {
        mainWindow.webContents.send("error-occured", err);
        return console.error(err);
      }
      console.log("Token stored to", TOKEN_PATH);
    });
    callback(oAuth2Client);
  });
}

/**
 * Lists the next 10 events on the user's primary calendar.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listEvents(auth) {
  const calendar = google.calendar({
    version: "v3",
    auth,
  });

  const cals = [process.env.WORK_CALENDAR, "primary"];

  let today = new Date();
  let dd = String(today.getDate()).padStart(2, "0");
  let mm = String(today.getMonth() + 1).padStart(2, "0"); //January is 0!
  let yyyy = today.getFullYear();

  today = yyyy + "-" + mm + "-" + dd;

  for (let cal of cals) {
    let eventsData = [];

    calendar.events.list(
      {
        calendarId: cal,
        timeMin: new Date().toISOString(),
        timeMax: `${today}T23:59:00Z`,
        maxResults: 10,
        singleEvents: true,
        orderBy: "startTime",
      },
      (err, res) => {
        if (err) {
          mainWindow.webContents.send("error-occured", err);
          return console.log("The API returned an error: " + err);
        }

        const events = res.data.items;

        if (events.length) {
          let datetime;

          events.map((event, i) => {
            const start = event.start.dateTime || event.start.date;

            if (new Date() > new Date(start)) return;

            let options = {
                weekday: "long",
                timeZone: process.env.TIMEZONE,
                year: "numeric",
                month: "numeric",
                day: "numeric",
                hour: "numeric",
                minute: "numeric",
              },
              formatter = new Intl.DateTimeFormat([], options);

            datetime = formatter.format(new Date(start));

            eventsData.push({
              datetime: datetime,
              descr: event.summary,
              notified: false,
            });
          });
          return saveEvents(eventsData);
        } else {
          mainWindow.webContents.send("events-data", []);
        }
      }
    );
  }

  function saveEvents(tmp) {
    let newEvents = [];

    for (let newEvent of tmp) {
      let eventFound = events.find((event) => {
        return newEvent.descr === event.descr;
      });

      if (eventFound) {
        eventFound.notified =
          eventFound.datetime !== newEvent.datetime
            ? false
            : eventFound.notified;
        eventFound.datetime = newEvent.datetime;
      } else {
        newEvents.push(newEvent);
      }
    }

    events.push(...newEvents);

    mainWindow.webContents.send("events-data", tmp);
  }
}
