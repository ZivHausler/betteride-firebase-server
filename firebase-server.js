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
const IP_ADDRESS = "10.0.0.8"; // Daniel -> 10.100.102.233 // ZIV-> 10.0.0.8
const demoSpeed = 5 ; // how fast the car will rerender to the map

const vehicleThreads = {};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://betteride-default-rtdb.europe-west1.firebasedatabase.app",
});

const db = admin.database();
app.use(cors({ origin: true }));

app.listen(3000, async () => {
  console.log("Waiting for a request...");
});

app.get('/', (req,res) => {
  res.send('Current demo speed is: ' + demoSpeed.toString());
  })

// POST CALLS
app.post("/pushRouteToVehicle", jsonParser, async (req, res) => {
  const { plateNumber, route, type } = req.body;
  route['eta'] = new Date(new Date().getTime() + route.duration.value * 1000).toLocaleString('en-US', { hour12: false });
  route['index'] = 0;
  db.ref("vehicles").child(plateNumber).child("route").set(route);
  db.ref("vehicles").child(plateNumber).child("state").set({ type, assigned: route.user_id });
  res.sendStatus(200);
});

app.post("/loginUser", jsonParser, async (req, res) => {
  const { user } = req.body;
  db.ref("users").child(user.id).once("value", (snapshot) => {
    if (snapshot.val()) {
      // user exists!
      // updating token 
      if (!user.token) return;
      db.ref("users").child(user.id).child('token').set(user.token)
      // // updating profile picture
      // db.ref('users').child(user.id).child('photoUrl').set(user.photoUrl);
      res.send(JSON.stringify(snapshot.val())).status(200);
    }
    else {
      // new user has been logged!
      userObj = { givenName: user.givenName, familyName: user.familyName, token: user.token, photoUrl: user.photoUrl, email: user.email, token: user.token }
      db.ref("users").child(user.id).set(userObj)
      res.send(JSON.stringify(userObj)).status(200);
    }
  })
});
app.put("/finishTrip", async (req, res) => {
  const { plateNumber, userID, canceled } = req.query;
  const isCanceled = canceled == 'true' ? true : false;
  if (isCanceled) {
    vehicleRef.child(plateNumber).child('route').child('canceled').set(true);
    res.send("OK").status(200);
  }
  else {
    const response = await finishTrip(plateNumber, userID, isCanceled);
    if (response) res.send("OK").status(200);
    else res.send("UPDATE FAILED").status(400);
  }
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

    return true;
  }
  catch (e) {
    console.log("error", e)
    return false;
  }
}


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
    res.send("UPDATE FAILED").status(400)
  }
});

app.post("/pushTripLocationsToUser", jsonParser, async (req, res) => {
  const { userID, userOrigin, userDestination, vehiclePlateNumber } = req.body;
  db.ref("users").child(userID).child("trip").set({ userOrigin, userDestination, state: { type: "WAITING_FOR_VEHICLE", assigned: vehiclePlateNumber } });
  res.sendStatus(200);
});

// PUT CALLS
app.put("/reassignVehiclesToUsers", jsonParser, async (req, res) => {
  const newAssignments = req.body;
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
  let tempVehiclesArray = [];
  db.ref("vehicles").once("value", (snapshot) => {
    for (const [key, value] of Object.entries(snapshot.val())) {
      if (value?.route && value?.state?.type === "TOWARDS_USER")
        tempVehiclesArray.push(value);
    }
    res.send(JSON.stringify(tempVehiclesArray));
  });
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
      if (value?.route && value?.state.type === "TOWARDS_USER")
        sum += value.route.duration.value;
    }
    res.send(JSON.stringify(sum))
  });
});

const getDirections = async (from, to) => {
  return await axios
    .get(
      `https://maps.googleapis.com/maps/api/directions/json?origin=${from.lat}%2C${from.lng}&destination=${to.lat}%2C${to.lng}&key=${googleMapsKey}`
    )
    .then((response) => response)
    .catch((error) => console.log("error"));
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
  if(vehicleThreads[vehicle.plateNumber] == true){
  console.log(vehicle.plateNumber + " has already thread running, exit demoVehicle function");
    return
  }
    
  else
    vehicleThreads[vehicle.plateNumber] = true;
  
  // checks if the vehicle has no trips -> marks it staticly on map
  if (!vehicle.route?.steps){
    console.log(vehicle.plateNumber + " has no route, exiting demoVehicle function");
    vehicleThreads[vehicle.plateNumber] = false;
    return;
  }

  // continue from last point (index)
  let i = 0;
  if (vehicle.route.index) i = vehicle.route.index.step;
  if (i < vehicle.route?.steps?.length) {
    if (vehicle?.route?.canceled == true) {
      console.log("canceling trip for vehicle plate number " + vehicle.plateNumber);
      await finishTrip(vehicle.plateNumber, vehicle.state.assigned, true);
      vehicleThreads[vehicle.plateNumber] = false;
      return;
    }
    console.log("vehicle plate number " + vehicle.plateNumber + " inside demoVehicle " + "with index " + i);
    // creating delay
    await delay(vehicle.route.steps[i].duration.value * 1000 / demoSpeed);
    // moving the vehicle to the next step
    await vehicleRef.child(vehicle.plateNumber).child('currentLocation').child('location').set({ lat: vehicle.route.steps[i].start_location.lat, lng: vehicle.route.steps[i].start_location.lng });
    let newVehicleAddress = await translateCordsToAddress({ lat: vehicle.route.steps[i].start_location.lat, lng: vehicle.route.steps[i].start_location.lng });
    
    const { kmLeft, timeLeft } = await calcETAAndKMLeft(vehicle.plateNumber, i);
    await vehicleRef.child(vehicle.plateNumber).child('route').child('km_left').set(kmLeft);
    await vehicleRef.child(vehicle.plateNumber).child('route').child('time_left').set(timeLeft);
    await vehicleRef.child(vehicle.plateNumber).child('currentLocation').child('address').set(newVehicleAddress);
     console.log(vehicle.plateNumber + " finsihed demoVehicle iteration, with index = " + i);
  vehicleThreads[vehicle.plateNumber] = false;
    await vehicleRef.child(vehicle.plateNumber).child('route').child('index').set({ step: ++i });
  }
  //vehice has arrived to his destination
  else {
    // now we need to update his address and location to the trip end point
    await vehicleRef.child(vehicle.plateNumber).child('currentLocation').set({ address: vehicle.route.end_address, location: { lat: vehicle.route.end_location.lat, lng: vehicle.route.end_location.lng } });

    await sendMessageToUser(vehicle.plateNumber, vehicle.state.assigned, vehicle.state.type);

    if (vehicle.state.type === 'TOWARDS_USER') {
      await usersRef.child(vehicle.state.assigned).child('trip').child('state').child("type").set('TOWARDS_VEHICLE');
      await vehicleRef.child(vehicle.plateNumber).child('route').set(null);
      await vehicleRef.child(vehicle.plateNumber).child('state').child('type').set('WAITING_FOR_USER');
    }
    else if (vehicle.state.type === 'WITH_USER') {
      // implement data saving to history
      await usersRef.child(vehicle.state.assigned).child('trip').child('state').child("type").set('WAIT_TO_EXIT');
      await vehicleRef.child(vehicle.plateNumber).child('state').child('type').set('WAIT_USER_EXIT');
      
    }
    console.log(vehicle.plateNumber + " finsihed demoVehicle iteration, with index = " + i);
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

const removeRoute = (vehicle) => {

}

const translateCordsToAddress = async (coords) => {
  let address = await axios.get(`https://betteride-main-server-3mmcqmln7a-ew.a.run.app/api/translateCordsToAddress?lat=${coords.lat}&lng=${coords.lng}`, {
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
    });
}
