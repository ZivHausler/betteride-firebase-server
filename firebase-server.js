const express = require("express");
const app = express();
const cors = require("cors");
const axios = require("axios");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const serviceAccount = require("./permissions.json");
const jsonParser = bodyParser.json({ limit: '10mb', extended: true });
const googleMapsKey = "AIzaSyB9mAs9XA7wtN9RdKMKRig7wlHBfUtjt1g";
const { faker } = require('@faker-js/faker');
const { Expo } = require('expo-server-sdk')
const firebaseBackup = require('./usecase-herzliya-haifa.json')

// local vars
const IP_ADDRESS = "localhost"; // Daniel -> 10.100.102.233 // ZIV-> 10.0.0.8 // Ruppin ->  10.80.31.88
const demoSpeed = 50; // how fast the car will rerender to the map
const debugMode = true; // if true -> ignore user confirmations
let isPushingLogs = false;
let logsArray = [];
let tempLogsArray = [];
const vehicleThreads = {};

const fakerData = (distance, duration, price) => {
  return [
    {
      key: faker.datatype.uuid(),
      title: 'Trip information:',
      info: [
        {
          title: 'Trip length:  ',
          text: distance,
        },
        {
          title: 'Trip time:  ',
          text: duration,
        },
        {
          title: 'Price:  ',
          text: price + ' ₪',
        },
        {
          title: 'Battery used:  ',
          text: faker.datatype.number() + ' mA',
        },
      ]
    },
    {
      key: faker.datatype.uuid(),
      title: 'Vehicle information:',
      info: [
        {
          title: 'Name:  ',
          text: faker.vehicle.vehicle(),
        },
        {
          title: 'Manufecturer:  ',
          text: faker.vehicle.manufacturer(),
        },
        {
          title: 'Model:  ',
          text: faker.vehicle.model(),
        },
        {
          title: 'Color:  ',
          text: faker.vehicle.color(),
        },
      ]
    },
    {
      key: faker.datatype.uuid(),
      title: 'General information:',
      info: [
        {
          title: 'Arrived in time?  ',
          text: faker.datatype.boolean() ? 'Yes' : 'No',
        },
      ]
    },
  ]
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://betteride-default-rtdb.europe-west1.firebasedatabase.app",
});

const db = admin.database();
app.use(cors({ origin: true }));

app.listen(3001, async () => {
  console.log("Waiting for a request...");
  if (debugMode)
    sendLog('Firebase-sever is up and running with DEBUGMODE', 'WARNING');
  else
    sendLog('Firebase-sever is up and running with speed demo of ' + demoSpeed.toString(), 'WARNING');
});

app.get('/', (req, res) => {
  res.send('Current demo speed is: ' + demoSpeed.toString());
})

// POST CALLS
app.post("/pushRouteToVehicle", jsonParser, async (req, res) => {
  const { plateNumber, route, type } = req.body;
  try {
    route['eta'] = new Date(new Date().getTime() + route.duration.value * 1000).toLocaleString('en-US', { hour12: false });
    route['index'] = 0;
    await db.ref("vehicles").child(plateNumber).child("route").set(route);
    await db.ref("vehicles").child(plateNumber).child("state").set({ type, assigned: route.user_id });
    sendLog('Pushed a new route to vehicle ' + plateNumber, 'OK');
    res.sendStatus(200);
  } catch (e) {
    sendLog(`Couldn't create a route for this vehicle`, 'ERROR');
    res.sendStatus(400);
  }
});

app.post("/loginUser", jsonParser, async (req, res) => {
  const { user } = req.body;
  db.ref("users").child(user.id).once("value", (snapshot) => {
    try {
      if (snapshot.val()) {
        try {
          // user exists!
          // updating token 
          if (!user.token) return;
          db.ref("users").child(user.id).child('token').set(user.token)
          // // updating profile picture
          // db.ref('users').child(user.id).child('photoUrl').set(user.photoUrl);
          sendLog(`The user ${user.id} has logged to the app`, 'WARNING');
          res.send(JSON.stringify(snapshot.val())).status(200);
        } catch (e) {
          sendLog(`Couldn't update user's information with the ID: ${user.id}`, 'ERROR');
          res.sendStatus(400);
        }
      }
      else {
        try {
          // new user has been logged!
          userObj = { givenName: user.givenName, familyName: user.familyName, token: user.token, photoUrl: user.photoUrl, email: user.email, token: user.token }
          db.ref("users").child(user.id).set(userObj)
          sendLog(`A new user has been created with the ID: ${user.id}`, 'WARNING');
          res.send(JSON.stringify(userObj)).status(200);
        } catch (e) {
          sendLog(`Couldn't create user with the ID: ${user.id}`, 'ERROR');
          res.sendStatus(400);
        }
      }
    } catch (e) {
      sendLog(`Couldn't create or update user with the ID: ${user.id}`, 'ERROR');
      res.sendStatus(400);
    }
  })
});

const finishTrip = async (plateNumber, userID, canceled) => {
  try {
    //save trip to history
    await vehicleRef.child(plateNumber).child('route').once("value", (vehicleSnapshot) => {
      usersRef.child(userID).child('travelHistory').once("value", (userSnapshot) => {
        let tempArray = [];
        if (userSnapshot.val()) tempArray = [...userSnapshot.val()];
        let tempTrip = vehicleSnapshot.val();
        if (tempTrip?.user_id != undefined) tempTrip.user_id = null;
        tempTrip['plateNumber'] = plateNumber;
        tempTrip['fakerData'] = fakerData(vehicleSnapshot.val().distance.text, vehicleSnapshot.val().duration.text, vehicleSnapshot.val().duration.value * 1.5 / 300);
        tempTrip['date'] = new Date().toUTCString();
        tempTrip['canceled'] = canceled ? true : null;
        tempTrip['time_left'] = null;
        tempTrip['km_left'] = null;
        tempTrip['index'] = null;
        tempTrip['steps'] = null;
        tempArray.push(tempTrip);
        usersRef.child(userID).child('travelHistory').set(tempArray);
      })
    })
    // reseting the states
    await usersRef.child(userID).child('trip').set(null);
    await vehicleRef.child(plateNumber).child('route').set(null);
    await vehicleRef.child(plateNumber).child('state').set(null);

    // for automation use only!
    axios.put(`http://${IP_ADDRESS}:3002/api/updateFinishedUsersAutomation?userID=${userID}`)
      .catch(e => console.log(e))

    sendLog(`Vehicle ${plateNumber} has finished the trip of user ID ${userID}`, 'OK');
    return true;
  }
  catch (e) {
    console.log("error", e)
    sendLog(`Couldn't remove vehicle's ${plateNumber} trip for the user ID ${userID}`, 'ERROR');
    return false;
  }
}

app.post("/pushTripLocationsToUser", jsonParser, async (req, res) => {
  const { userID, userOrigin, userDestination, vehiclePlateNumber } = req.body;
  try {
    db.ref("users").child(userID).child("trip").set({ userOrigin, userDestination, state: { type: "WAITING_FOR_VEHICLE", assigned: vehiclePlateNumber } });
    sendLog(`A new trip was added to the user ${userID}. It's allocated vehicle is ${vehiclePlateNumber}`, 'OK');
    res.sendStatus(200);
  } catch (e) {
    sendLog(`pushTripLocationsToUser: Couldn't push a trip for the user ${userID} with the vehicle ${vehiclePlateNumber}`, 'ERROR');
    res.sendStatus(400);
  }
});

// post a log to the firebase
app.post("/postLog", jsonParser, async (req, res) => {
  const { text, type, server } = req.body;
  await sendLog(text, type, server);
  res.sendStatus(200);
});



// PUT CALLS
app.put("/reassignVehiclesToUsers", jsonParser, async (req, res) => {
  const newAssignments = req.body;
  try {
    db.ref("vehicles").once("value", (snapshot) => {
      const vehicles = snapshot.val();
      newAssignments.forEach(assign => {
        // check if the new route is different than the old one
        if (assign[1] != vehicles[assign[0]].route.end_location.lat + ',' + vehicles[assign[0]].route.end_location.lng) {
          console.log('new route is different then the old route');
        }
      })
    });
    res.sendStatus(200);
  } catch (e) {
    sendLog(`reassignVehiclesToUsers: Couldn't find the vehicles in your database`, 'ERROR');
    res.sendStatus(400);
  }
});

app.put("/resetDatabase", jsonParser, async (req, res) => {
  try {
    console.log("Reseting DB")
    db.ref('/').set(firebaseBackup)
    res.sendStatus(200);
  } catch (e) {
    console.log(e)
    sendLog(`error reseting the database`, 'ERROR');
    res.sendStatus(400);
  }
});

app.put("/finishTrip", async (req, res) => {
  const { plateNumber, userID, canceled } = req.query;
  const isCanceled = canceled == 'true' ? true : false;
  try {
    if (isCanceled) {
      vehicleRef.child(plateNumber).child('route').child('canceled').set(true);
      res.send("OK").status(200);
    }
    else {
      const response = await finishTrip(plateNumber, userID, isCanceled);

      if (response) res.send("OK").status(200);
      else res.send("UPDATE FAILED").status(400);
    }
  } catch (e) {
    sendLog(`finishTrip: Couldn't find the vehicles in your database`, 'ERROR');
  }
});

app.put("/updateUserVehicleState", jsonParser, async (req, res) => {
  const { plateNumber, userID, state } = req.body;
  try {
    if (state === "TOGETHER") {
      db.ref("vehicles").child(plateNumber).child("state").child("type").set("WITH_USER");
      db.ref("users").child(userID).child('trip').child("state").child("type").set('TOWARDS_DESTINATION');
    }
    res.send("OK").status(200)
  }
  catch (e) {
    console.log("error", e)
    sendLog(`updateUserVehicleState: Couldn't update the vehicle's ${plateNumber} state`, 'ERROR');
    res.send("UPDATE FAILED").status(400)
  }
});

app.put("/rematchVehiclesAndUsers", jsonParser, async (req, res) => {
  const { vehicleID, userID } = req.body;
  try {
    db.ref("vehicles").child(vehicleID).child("state").child("assigned").set(userID);
    db.ref("users").child(userID).child('trip').child("state").child("assigned").set(vehicleID);
    res.send("OK").status(200)
  }
  catch (e) {
    console.log("error", e)
    sendLog(`updateUserVehicleState: Couldn't update the vehicle's ${vehicleID} state`, 'ERROR');
    res.send("UPDATE FAILED").status(400)
  }
});

app.put("/updateUserInfo", jsonParser, async (req, res) => {
  const { tempUser } = req.body;
  try {
    db.ref("users").child(tempUser.id).child('firstName').set(tempUser.firstName);
    db.ref("users").child(tempUser.id).child('lastName').set(tempUser.lastName);
    res.send("OK").status(200)
  }
  catch (e) {
    console.log("error", e)
    sendLog(`updateUserInfo: Couldn't update the user's ${tempUser.id} information`, 'ERROR');
    res.send("UPDATE FAILED").status(400)
  }
});

// GET CALLS
app.get("/getVehicles", async (req, res) => {
  db.ref("vehicles").once("value", (snapshot) => {
    res.send(snapshot.val());
  });
});

app.get('/getUserDirections', async (req, res) => {
  db.ref('users').child(req.query.userID).child('trip').once('value', snapshot => {
    res.send(snapshot.val());
  })
})

app.get("/getVehiclesTowardsUsers", async (req, res) => {
  try {
    let tempVehiclesArray = [];
    await db.ref("vehicles").once("value", (snapshot) => {
      for (const [key, value] of Object.entries(snapshot.val())) {
        if ((value?.route && value?.state?.type === "TOWARDS_USER") || value?.state?.type == null)
          tempVehiclesArray.push({ "id": key, "currentLocation": value?.currentLocation?.address, "state": value?.state?.type });
      }
    });
    res.send(JSON.stringify(tempVehiclesArray));
  } catch (e) {
    console.log("getVehiclesTowardsUsers error", e)
    res.send("ERROR").status(400);
  }
});

app.get("/api/getRoute", async (req, res) => {
  let { fromLat, fromLng, toLat, toLng } = req.query;
  // let results = await getDirections({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng });
  // res.status(200).send(results);

  getDirections({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng })
    .then((response) => res.status(200).send(response.data))
    .catch((err) => console.log(err));
});

app.get('/getUserHistory', async (req, res) => {
  db.ref('users').child(req.query.userID).child('travelHistory').once('value', snapshot => {
    res.status(200).send(JSON.stringify(snapshot.val()));
  });
})

app.get('/getVehicleCurrentRoute', async (req, res) => {
  db.ref('vehicles').child(req.query.plateNumber).child('route').once('value', snapshot => {
    const object = {
      destination: {
        description: snapshot.val().end_address,
        location: snapshot.val().end_location,
      },
      origin: {
        description: snapshot.val().start_address,
        location: snapshot.val().start_location,
      }
    }
    res.status(200).send(JSON.stringify(object));
  });
})

app.get("/getTotalDrivingTimeToUser", async (req, res) => {
  let sum = 0;
  db.ref("vehicles").once("value", (snapshot) => {
    for (const [key, value] of Object.entries(snapshot.val())) {
      if (value?.route && value?.state?.type === "TOWARDS_USER")
        sum += value.route.duration.value;
    }
    res.send(JSON.stringify(sum))
  });
});

app.get('/getAllUsersWaitingForARide', async (req, res) => {
  let users = [];
  await db.ref("users").once("value", (snapshot) => {
    Object.entries(snapshot.val()).map(entry => {
      if (entry[1]?.trip?.state?.type === 'WAITING_FOR_VEHICLE')
        users.push({ id: entry[0], currentLocation: entry[1]?.trip?.userOrigin });
    })
  })
  res.send(JSON.stringify(users))
})

const getDirections = async (from, to) => {
  return await axios
    .get(
      `https://maps.googleapis.com/maps/api/directions/json?origin=${from.lat}%2C${from.lng}&destination=${to.lat}%2C${to.lng}&key=${googleMapsKey}`
    )
    .then((response) => response)
    .catch((error) => {
      console.log("error");
      sendLog(`getDirections: Couldn't get directions to a location from google servers.`, 'ERROR');
    });
};
// demo vehicle 
const vehicleRef = db.ref("vehicles");
const usersRef = db.ref('users');

const addDemoVehicleListener = (vehicle) => {
  vehicleRef.child(vehicle.plateNumber).child('route').child('index').on('value', function (dataSnapshot) {
    if (dataSnapshot.val() == null) return;
    vehicleRef.child(vehicle.plateNumber).once("value", snapshot => {
      try {
        demoVehicle(snapshot.val())
      }
      catch (e) { console.log('error', e) }
    })
  });
}

const initDemo = () => {
  vehicleRef.once("value", snapshot => {
    Object.values(snapshot.val()).forEach(vehicle => {
      addDemoVehicleListener(vehicle);
    })
  })
}

initDemo();

const demoVehicle = async (vehicle) => {
  if (vehicleThreads[vehicle.plateNumber] == true) {
    console.log(vehicle.plateNumber + " has already thread running, exit demoVehicle function");
    return
  }
  else {
    vehicleThreads[vehicle.plateNumber] = true;
  }

  // checks if the vehicle has no trips -> marks it staticly on map
  if (!vehicle.route?.steps) {
    console.log(vehicle.plateNumber + " has no route, exiting demoVehicle function");
    vehicleThreads[vehicle.plateNumber] = false;
    return;
  }

  // check if vehicle has made progress already
  let i = 0;
  if (vehicle.route.index) i = vehicle.route.index.step;

  const currentVehicleRef = vehicleRef.child(vehicle.plateNumber);

  if (i < vehicle.route?.steps?.length) {
    if (i == 0) sendLog(`Vehicle ${vehicle.plateNumber} has started its trip.`, 'OK');
    if (vehicle?.route?.canceled == true) {
      console.log("canceling trip for vehicle plate number " + vehicle.plateNumber);
      await finishTrip(vehicle.plateNumber, vehicle.state.assigned, true);
      vehicleThreads[vehicle.plateNumber] = false;
      return;
    }

    // creating delay
    // if (!debugMode)
    await delay(vehicle.route.steps[i].duration.value * 1000 / demoSpeed);

    // moving the vehicle to the next step
    await currentVehicleRef.child('currentLocation').child('location').set({ lat: vehicle.route.steps[i].start_location.lat, lng: vehicle.route.steps[i].start_location.lng });

    // api call general server, got get the coords of the upcoming address
    let newVehicleAddress = await translateCordsToAddress({ lat: vehicle.route.steps[i].start_location.lat, lng: vehicle.route.steps[i].start_location.lng });
    await currentVehicleRef.child('currentLocation').child('address').set(newVehicleAddress);

    // updating kmleft and timeleft
    const { kmLeft, timeLeft } = await calcETAAndKMLeft(vehicle.plateNumber, i);
    await currentVehicleRef.child('route').child('km_left').set(kmLeft);
    await currentVehicleRef.child('route').child('time_left').set(timeLeft);

    console.log(vehicle.plateNumber + " finsihed demoVehicle iteration, with index = " + i);

    vehicleThreads[vehicle.plateNumber] = false;

    await currentVehicleRef.child('route').child('index').set({ step: ++i })
  }
  //vehice has arrived to his destination
  else {
    // now we need to update his address and location to the trip end point
    console.log("setting vehicle address to", vehicle.route.end_address)
    await currentVehicleRef.child('currentLocation').set({ address: vehicle.route.end_address, location: { lat: vehicle.route.end_location.lat, lng: vehicle.route.end_location.lng } });
    // await sendMessageToUser(vehicle.plateNumber, vehicle.state.assigned, vehicle.state.type);
    if (vehicle.state.type === 'TOWARDS_USER') {
      if (debugMode) {
        console.log("debug mode active! pushing route to vehicle")
        vehicleThreads[vehicle.plateNumber] = false;
        await axios.put(`http://${IP_ADDRESS}:3002/api/generateRouteToVehicle?userID=${vehicle.state.assigned}`, {
          method: "PUT",
        })
        await usersRef.child(vehicle.state.assigned).child('trip').child('state').child("type").set('TOWARDS_DESTINATION');
        await currentVehicleRef.child('state').child('type').set('WITH_USER');
      }
      else {
        await usersRef.child(vehicle.state.assigned).child('trip').child('state').child("type").set('TOWARDS_VEHICLE');
        await currentVehicleRef.child('route').set(null);
        await currentVehicleRef.child('state').child('type').set('WAITING_FOR_USER');
      }
    }
    else if (vehicle.state.type === 'WITH_USER') {
      // implement data saving to history
      if (debugMode) {
        await finishTrip(vehicle.plateNumber, vehicle.state.assigned, false)
      }
      else {
        await usersRef.child(vehicle.state.assigned).child('trip').child('state').child("type").set('WAIT_TO_EXIT');
        await currentVehicleRef.child('state').child('type').set('WAIT_USER_EXIT');
      }
      console.log(vehicle.plateNumber + " finished!");
    }
    vehicleThreads[vehicle.plateNumber] = false;
  }
}

const calcETAAndKMLeft = async (plateNumber, index) => {
  // get the last time - current index time
  let timeLeft = 0;
  let kmLeft = 0;
  await vehicleRef.child(plateNumber).child('route').child('steps').once('value', snapshot => {
    if (snapshot.val()?.length != undefined && snapshot.val()?.length > 0)
      for (let i = index; i < snapshot.val()?.length; i++) {
        timeLeft += snapshot.val()[i].duration.value;
        kmLeft += snapshot.val()[i].distance.value;
      }
  });
  return { timeLeft, kmLeft };
}

const translateCordsToAddress = async (coords) => {
  // let address = await axios.get(`https://betteride-main-server-3mmcqmln7a-ew.a.run.app/api/translateCordsToAddress?lat=${coords.lat}&lng=${coords.lng}`, {
  let address = await axios.get(`http://${IP_ADDRESS}:3002/api/translateCordsToAddress?lat=${coords.lat}&lng=${coords.lng}`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  })
    .then(response => response.data)
    .catch((error) => {
      console.log('error at firebase - translateCordsToAddress', error);
    })
  return address
}
const sendMessageToUser = async (plateNumber, userID, type) => {
  try {
    // create the message to send to the user that the vehicle has arrived and will be waiting for him.
    let message;

    usersRef.child(userID).once('value', userSnapshot => {
      message = {
        to: userSnapshot.val().token,
        sound: 'default',
        title: type === 'TOWARDS_USER' ? `${userSnapshot.val().givenName}, Your vehicle has arrived` : `${userSnapshot.val().givenName}, You have arrived to your destination!`,
        body: type === 'TOWARDS_USER' ? `It's plate number is ${plateNumber}` : `Please step out from the vehicle`,
        data: { type },
      }
      sendPushNotification(message)
    })
  } catch (e) {
    sendLog(`Couldn't send a message to the user ${userID}`, 'ERROR');
  }

}
const delay = ms => new Promise(res => setTimeout(res, ms))
// // EXPO
// ~~ Send push notifications to user ~~
async function sendPushNotification(message) {
  await axios.post('https://exp.host/--/api/v2/push/send', message)
    .then(function (response) {
    })
    .catch(function (error) {
      console.log('message has not been sent');
      sendLog(`Couldn't send a message to the user ${userID}`, 'ERROR');
    });
}

const sendLog = async (text = null, type, server = 'firebase') => {
  // create the log
  let oldLogs = [];
  const currentdate = new Date();
  const date = currentdate.getDate() + "-" + (currentdate.getMonth() + 1) + "-" + currentdate.getFullYear();
  const time = (currentdate.getHours() < 10 ? "0" + currentdate.getHours() : currentdate.getHours()) + ":" + (currentdate.getMinutes() < 10 ? "0" + currentdate.getMinutes() : currentdate.getMinutes()) + ":" + (currentdate.getSeconds() < 10 ? "0" + currentdate.getSeconds() : currentdate.getSeconds());

  if (!isPushingLogs) {
    // no threads trying to push logs
    // set the mutex to true and hold it until finished
    isPushingLogs = true;

    // copy the logs array + new log
    let newLogs = [...logsArray];
    if (text)
      newLogs.push({ text, time, server, type });

    // clear the logs array
    logsArray = []
    // console.log("cleared the logs array!",logsArray)

    // copy the current logs array from firebase (if there are any...)
    await db.ref("logs").child(date).once("value", (snapshot) => {
      if (snapshot.val())
        oldLogs = [...snapshot.val()]
    })

    // set the firebase logs to the old + new logs array
    await db.ref("logs").child(date).set(oldLogs.concat(newLogs));

    // free mutex
    // console.log("\nbefore free mutex, the waitingformutex array =>", tempLogsArray)
    // console.log("this should be empty!!!!!", logsArray)
    // console.log("this should be empty!!!!!", logsArray)
    // console.log("calling back to the sendLog function\n");
    logsArray = logsArray.concat(tempLogsArray)
    isPushingLogs = false;
    tempLogsArray = []
    if (logsArray.length > 0)
      sendLog()
  }
  else {
    // other threads trying to push logs
    // create new log and store it in temp array
    tempLogsArray.push({ text, time, server, type })
    // console.log("mutex taken")
    // console.log(tempLogsArray)
  }
}