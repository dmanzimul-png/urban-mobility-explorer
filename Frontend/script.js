// Sample taxi trip data for testing
const trips = [
    {
        borough:"Manhattan",
        fare: 15.50,
        distance: 2.5
    },
    {
        borough: "Brooklyn",
        fare: 22.00,
        distance: 4.8
    },
    {
         borough: "Manhattan",
         fare: 12.00,
         distance: 1.8
    },
    {
        borough: "Queens",
        fare: 18.75,
        distance: 3.2
    },
    {
        borough: "Bronx",
        fare: 9.50,
        distance: 1.2
    }
];

//Display the total number of trips 
const totaltripsElement = document.getElementById("total-trips");
totaltripsElement.textContent = trips.length;

// Calculate the average fare 
const totalFare = trips.reduce(function(sum, trip){
    return sum + trip.fare;
}, 0);

const averageFare = totalFare / trips.length;

//Display the average fare 
const averageFareElement = document.getElementById("average-fare");

averageFareElement.textContent = "$" + averageFare.toFixed(2);

//Calculate the average trip distance
const totalDistance = trips.reduce(function(sum, trip){
    return sum + trip.distance;
}, 0);
const averageDistance = totalDistance / trips.length;

//Display the average distance 
const averageDistanceElement = document.getElementById("average-distance");

averageDistanceElement.textContent = averageDistance.toFixed(1) + "miles";


// Check that javascript is connected to our dashboard
console.log("JavaScript is connected to the dashboard!");

//Get the boroigh dropdown and reset button
const boroughFilter = document.getElementById("borough");
const resetButton = document.getElementById("reset-filters");

// Reset the borough filter when the button is clicked
resetButton.addEventListener("click",function(){
    boroughFilter.value = "all";

    const resultsMessage = document.getElementById("results-message");
    resultsMessage.textContent = "Showing trips from all boroughs.";
});

//Listen for changes to the borough dropdown
boroughFilter.addEventListener("change", function() {
    const selectedBorough = boroughFilter.value;
    const resultsMessage = document.getElementById("results-message");

    if (selectedBorough === "all"){
        resultsMessage.textContent = "Showing trips from all boroughs.";
    } else {
        resultsMessage.textContent = "Showing trips for " + selectedBorough + ".";
    
    }
});