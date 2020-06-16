//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const electron = require("electron");
const url = require("url");
const path = require("path");
const axios = require("axios");
const { app, BrowserWindow, ipcMain } = electron;
const fs = require("fs");
const { google } = require("googleapis");
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

const TOKEN_PATH = "token.json";

let mainWindow;

require("dotenv").config({ path: path.resolve(__dirname, "./.env") });

let city = process.env.CITY;
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function createMainWindow() {
  mainWindow = new BrowserWindow({
    frame: false,
    width: 350,
    height: 470,
    x: 1560,
    y: 0,
    resizable: true,
    fullscreenable: false,
    opacity: 0.8,
    skipTaskbar: true,
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
      `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`
    )
    .catch((err) => console.log(err));

  console.log(response.data);

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

setInterval(function () {
  fetchWeather();
}, 60000);

setInterval(function () {
  fetchDatetime();
}, 1000);

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
app.on("ready", function () {
  createMainWindow();

  mainWindow.webContents.on("did-finish-load", function () {
    fetchWeather();
    fetchDatetime();
    // Load client secrets from a local file.
    fs.readFile("credentials.json", (err, content) => {
      if (err) return console.log("Error loading client secret file:", err);
      // Authorize a client with credentials, then call the Google Calendar API.
      authorize(JSON.parse(content), listEvents);
    });
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
  // Load client secrets from a local file.
  fs.readFile("credentials.json", (err, content) => {
    if (err) return console.log("Error loading client secret file:", err);
    // Authorize a client with credentials, then call the Google Calendar API.
    authorize(JSON.parse(content), listEvents);
  });
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
    if (err) return getAccessToken(oAuth2Client, callback);
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
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  code = process.env.GOOGLE_CAL_KEY;

  if (!code) {
    mainWindow.webContents.send("events-mess", {
      mess: "Authorize this app by visiting this url: " + authUrl,
    });
    return;
  }

  oAuth2Client.getToken(code, (err, token) => {
    if (err) return console.error("Error retrieving access token", err);
    oAuth2Client.setCredentials(token);
    // Store the token to disk for later program executions
    fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
      if (err) return console.error(err);
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
  const calendar = google.calendar({ version: "v3", auth });
  calendar.events.list(
    {
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
    },
    (err, res) => {
      if (err) return console.log("The API returned an error: " + err);
      const events = res.data.items;
      console.log(res.data);
      if (events.length) {
        let eventsData = [];

        console.log("Upcoming 10 events:");
        events.map((event, i) => {
          const start = event.start.dateTime || event.start.date;

          let options = {
              weekday: "long",
              timeZone: `Europe/Athens`,
              year: "numeric",
              month: "numeric",
              day: "numeric",
              hour: "numeric",
              minute: "numeric",
            },
            formatter = new Intl.DateTimeFormat([], options);

          let datetime = formatter.format(new Date(start));

          eventsData.push({ datetime: datetime, descr: event.summary });
        });

        console.log(eventsData);
        mainWindow.webContents.send("events-data", eventsData);
      } else {
        console.log("No upcoming events found.");
        mainWindow.webContents.send("events-data", []);
      }
    }
  );
}
