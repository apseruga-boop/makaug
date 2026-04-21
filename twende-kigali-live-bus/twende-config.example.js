window.TWENDE_CONFIG = {
  useLiveApi: true,
  baseUrl: "https://api.twende.example",
  mapProvider: "leaflet-openstreetmap",
  googleMapsApiKey: "RESTRICTED_BROWSER_KEY_IF_USING_GOOGLE_MAPS",
  mapboxAccessToken: "PUBLIC_MAPBOX_TOKEN_IF_USING_MAPBOX",
  paymentProviders: {
    mtnMomo: {
      enabled: true,
      collectionsBaseUrl: "https://sandbox.momodeveloper.mtn.com/collection"
    },
    airtelMoney: {
      enabled: true,
      baseUrl: "https://YOUR_AIRTEL_MONEY_PROVIDER_BASE_URL"
    },
    cardProcessor: {
      enabled: true,
      publicKey: "PUBLIC_CARD_PROCESSOR_KEY"
    }
  },
  transitFeeds: {
    gtfsStaticUrl: "https://YOUR_TRANSIT_FEED/gtfs.zip",
    gtfsRealtimeVehiclePositionsUrl: "https://YOUR_TRANSIT_FEED/vehicle-positions.pb",
    gtfsRealtimeTripUpdatesUrl: "https://YOUR_TRANSIT_FEED/trip-updates.pb",
    gtfsRealtimeAlertsUrl: "https://YOUR_TRANSIT_FEED/service-alerts.pb"
  },
  tapGo: {
    partnerBaseUrl: "https://YOUR_TAP_GO_PARTNER_API",
    partnerId: "TWENDE"
  }
};
