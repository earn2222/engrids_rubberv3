const express = require('express');
const app = express();
const ee = require('@google/earthengine');
const { GoogleAuth } = require('google-auth-library');
var privateKey = require('./gee-key.json');

var geeData = {};
async function getEEdata() {
    try {
        console.log('🔄 Fetching Earth Engine data...');

        // Base geometry and image collection
        var geometry = ee.FeatureCollection('USDOS/LSIB_SIMPLE/2017')
            .filter(ee.Filter.eq('country_na', 'Thailand'));
        // print the geometry bounds
        if (geometry.size().getInfo() === 0) {
            throw new Error('No geometry found for the specified country.');
        }
        // console.log('✅ Geometry bounds:', );

        const images = ee.ImageCollection("COPERNICUS/S2_HARMONIZED")
            .filterDate('2023-12-01', '2024-04-30')
            .filterBounds(geometry)
            .median()
            .multiply(0.0001) // Scale factor for Sentinel-2
            .clip(geometry);

        // Sentinel-2 bands: B4 (Red), B3 (Green), B2 (Blue), B8 (NIR), B11 (SWIR)
        const ndvi = images.normalizedDifference(['B8', 'B4']).rename('NDVI');
        const ndwi = images.normalizedDifference(['B3', 'B11']).rename('NDWI');
        const ndbi = images.normalizedDifference(['B11', 'B8']).rename('NDBI');

        // Combine all indices into a single image
        const dataset = images.addBands([ndvi, ndwi, ndbi]);

        // Visualization parameters
        const visTrueColor = {
            bands: ['B4', 'B3', 'B2'],
            min: 0,
            max: 0.3,
            gamma: [0.9, 0.9, 0.9],
        };

        function getMinMax(image, bandName) {
            return image.select(bandName).reduceRegion({
                reducer: ee.Reducer.minMax(),
                geometry: geometry,
                scale: 100,
                maxPixels: 1e9
            });
        }
        // Calculate min and max for NDVI, NDWI, NDBI
        const ndviMinMax = getMinMax(ndvi, 'NDVI');
        const ndwiMinMax = getMinMax(ndwi, 'NDWI');
        const ndbiMinMax = getMinMax(ndbi, 'NDBI');

        const visNDVI = { min: -0.2, max: 0.75, palette: ['d7191c', 'ffffbf', '1a9641'] };
        const visNDWI = { min: ndwiMinMax.NDVI_min, max: ndwiMinMax.NDVI_max, palette: ['purple', 'white', 'cyan'] };
        const visNDBI = { min: ndbiMinMax.NDVI_min, max: ndbiMinMax.NDVI_max, palette: ['brown', 'white', 'blue'] };

        // Helper to convert getMap to Promise
        function getMapPromise(image, visParams) {
            return new Promise((resolve, reject) => {
                image.visualize(visParams).getMap({}, (mapInfo, error) => {
                    if (error) reject(error);
                    else resolve(mapInfo);
                });
            });
        }

        // Get tile info for all layers
        const [truecolor, ndviMap, ndwiMap, ndbiMap] = await Promise.all([
            getMapPromise(dataset, visTrueColor),
            getMapPromise(ndvi, visNDVI),
            getMapPromise(ndwi, visNDWI),
            getMapPromise(ndbi, visNDBI),
        ]);

        // Send result
        return {
            truecolor,
            ndvi: ndviMap,
            ndwi: ndwiMap,
            ndbi: ndbiMap,
            geometry: geometry.first().geometry().bounds().getInfo()
        };

    } catch (error) {
        console.error('❌ Error fetching Earth Engine data:', error);
        throw error;
    }
}

async function initializeEarthEngine() {
    try {
        const auth = new GoogleAuth({
            credentials: privateKey,
            scopes: ['https://www.googleapis.com/auth/earthengine.readonly'],
        });

        const client = await auth.getClient();

        await new Promise((resolve, reject) => {
            ee.data.authenticateViaPrivateKey(privateKey, resolve, reject);
        });

        ee.initialize(null, null, () => {
            console.log('✅ Earth Engine initialized');
            geeData = getEEdata()
        });
    } catch (error) {
        console.error('❌ EE initialization failed:', error);
    }
}
initializeEarthEngine();

app.get('/api/gee', async (req, res) => {
    try {
        console.log('🔄 Fetching Earth Engine data...');

        // Ensure Earth Engine is initialized
        if (!ee.data) {
            console.error('❌ Earth Engine is not initialized.');
            res.status(500).send('Earth Engine not initialized');
            return;
        }

        // Fetch the data
        const data = await geeData;

        // Send result
        res.json(data);

    } catch (error) {
        console.error('❌ Error fetching Earth Engine data:', error);
        res.status(500).send('Error fetching Earth Engine data');
    }
});

module.exports = app