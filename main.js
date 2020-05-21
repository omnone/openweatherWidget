//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const electron = require("electron");
const url = require("url");
const path = require("path");
const axios = require("axios");
const { app, BrowserWindow } = electron;

require("dotenv").config({ path: path.resolve(__dirname, "./.env") });

let mainWindow;
let city = "Patras";

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function createMainWindow() {
  mainWindow = new BrowserWindow({
    vibrancy: "ultra-dark",
    frame: false,
    width: 400,
    height: 210,
    x: 1500,
    y: 70,
    resizable: false,
    fullscreenable: false,
    transparent: true,
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

  mainWindow.webContents.send("weather-data", response.data);

  console.log(response.data);
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

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
